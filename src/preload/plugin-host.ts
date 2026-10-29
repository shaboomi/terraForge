import { ipcRenderer } from "electron";
import { pluginExecutionLimits, validatePluginResult } from "../types/pluginValidation";
import type { PluginManifest, PluginRunRequest } from "../types";

declare const __TERRAFORGE_PLUGIN_WORKER__: string;

const report = (message: unknown) => ipcRenderer.send("plugins:host-event", message);

// No application API is exposed to the plugin's worker or the page.
function startPluginWorker(payload: unknown): void {
  if (!payload || typeof payload !== "object") throw new Error("Invalid plugin startup message.");
  // Startup data comes exclusively from the main process's validated execution request.
  const { request, manifest } = payload as { request: PluginRunRequest; manifest: PluginManifest };
  let requestForValidation = request;
  const workerUrl = URL.createObjectURL(
    new Blob([__TERRAFORGE_PLUGIN_WORKER__], { type: "text/javascript" }),
  );
  const worker = new Worker(workerUrl, { type: "module" });
  URL.revokeObjectURL(workerUrl);
  let terminal = false;
  let lastProgress = 0;

  worker.onmessage = ({ data }: MessageEvent<unknown>) => {
    if (terminal || !data || typeof data !== "object") return;
    const message = data as Record<string, unknown>;
    if (message.type === "progress") {
      if (message.progress !== null && (
        typeof message.progress !== "number" || !Number.isFinite(message.progress) ||
        message.progress < 0 || message.progress > 100
      )) return;
      const now = Date.now();
      if (now - lastProgress < 50) return;
      lastProgress = now;
      report({ type: "progress", progress: message.progress });
    } else if (message.type === "result" || message.type === "error") {
      terminal = true;
      try {
        // Copy and bound untrusted output before it crosses into the main process.
        report(message.type === "error"
          ? { type: "error", error: String(message.error).slice(0, 2000) }
          : { type: "result", result: validatePluginResult(message.result, requestForValidation, manifest) });
      } catch (error) {
        report({ type: "error", error: String(error).slice(0, 2000) });
      }
      worker.terminate();
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    if (terminal) return;
    terminal = true;
    report({
      type: "error",
      error: String(event.message || "Plugin worker crashed.").slice(0, 2000),
    });
    worker.terminate();
  };
  // The worker owns this one-run snapshot. Transfer pixel arrays rather than cloning a second
  // full image inside the isolated host. The renderer/main validation copies remain deliberate.
  const transfers: ArrayBuffer[] = [];
  if (request.input.kind === "bitmap") {
    transfers.push(request.input.data.buffer as ArrayBuffer);
    if (request.input.prepared) {
      transfers.push(request.input.prepared.tones.buffer as ArrayBuffer,
        ...request.input.prepared.channels.map(channel => channel.data.buffer as ArrayBuffer));
    }
  }
  const validationRequest = request.input.kind === "bitmap"
    ? { ...request, input: { ...request.input, data: new Uint8Array(0), prepared: undefined } }
    : request;
  // Result validation uses frame/palette/parameters only; never retain detached pixel buffers.
  requestForValidation = validationRequest;
  worker.postMessage({ ...payload, limits: pluginExecutionLimits(request.detailBudget) }, transfers);
}

ipcRenderer.once("plugins:host-start", (_event, payload: unknown) => {
  try {
    startPluginWorker(payload);
  } catch (error) {
    report({ type: "error", error: String(error).slice(0, 2000) });
  }
});
