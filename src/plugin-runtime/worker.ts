import type { PluginInput, PluginParameters, PluginRunRequest } from "../types";

// This module is transpiled into the dedicated preload; it never runs in Node.
type WorkerMessage = { source: string; request: PluginRunRequest };
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
      signal: controller.signal,
      seed: 1,
      progress: (percent: number | null) => send({ type: "progress", progress: percent }),
    });
    const input = Object.freeze({
      ...data.request.input,
      page: Object.freeze({ ...data.request.input.page }),
    });
    const result = await plugin.default(input, Object.freeze({ ...data.request.parameters }), context);
    send({ type: "result", result });
  } catch (error) {
    send({ type: "error", error: String(error).slice(0, 2000) });
  } finally {
    if (moduleUrl) URL.revokeObjectURL(moduleUrl);
  }
};
