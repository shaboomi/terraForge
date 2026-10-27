import { ipcRenderer } from "electron";
import { validatePluginResult } from "../types/pluginValidation";

declare const __TERRAFORGE_PLUGIN_WORKER__: string;

const report = (message: unknown) => ipcRenderer.send("plugins:host-event", message);

// No application API is exposed to the plugin's worker or the page.
function startPluginWorker(payload: unknown): void {
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
          : { type: "result", result: validatePluginResult(message.result) });
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
  worker.postMessage(payload);
}

ipcRenderer.once("plugins:host-start", (_event, payload: unknown) => {
  try {
    startPluginWorker(payload);
  } catch (error) {
    report({ type: "error", error: String(error).slice(0, 2000) });
  }
});
