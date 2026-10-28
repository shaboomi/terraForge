import type { PluginExecutionLimits, PluginInput, PluginParameters, PluginRunRequest } from "../types";

// This module is transpiled into the dedicated preload; it never runs in Node.
type WorkerMessage = { source: string; request: PluginRunRequest; limits: PluginExecutionLimits };
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null;
  postMessage: (message: unknown) => void;
};
const send = scope.postMessage.bind(scope);
scope.onmessage = async ({ data }) => {
  let moduleUrl: string | undefined;
  try {
    moduleUrl = URL.createObjectURL(new Blob([data.source], { type: "text/javascript" }));
    const plugin = await import(/* @vite-ignore */ moduleUrl) as {
      default?: (input: PluginInput, parameters: PluginParameters, context: unknown) => unknown;
    };
    if (typeof plugin.default !== "function") throw new Error("Plugin must export a default run function.");
    const controller = new AbortController();
    const context = Object.freeze({
      runId: data.request.runId,
      limits: Object.freeze(data.limits),
      signal: controller.signal,
      seed: data.request.seed ?? 1,
      progress: (percent: number | null) => send({ type: "progress", progress: percent }),
    });
    // All data is a private structured clone; freeze object/geometry metadata too.
    // Typed pixel arrays cannot be frozen, but mutations affect only this run's copy.
    const freezeSnapshot = (value: unknown): void => {
      if (!value || typeof value !== "object" || ArrayBuffer.isView(value)) return;
      for (const child of Object.values(value)) freezeSnapshot(child);
      Object.freeze(value);
    };
    const input = data.request.input;
    freezeSnapshot(input);
    const result = await plugin.default(input, Object.freeze({ ...data.request.parameters }), context);
    send({ type: "result", result });
  } catch (error) {
    send({ type: "error", error: String(error).slice(0, 2000) });
  } finally {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl);
  }
};
