import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest, PluginRunRequest } from "../../../src/types";
import { DEFAULT_BITMAP_PREPARATION } from "../../../src/types/pluginBitmapPreparation";

const mocks = vi.hoisted(() => ({
  start: undefined as ((event: unknown, payload: unknown) => void) | undefined,
  send: vi.fn(),
}));
vi.mock("electron", () => ({ ipcRenderer: {
  once: (_channel: string, callback: (event: unknown, payload: unknown) => void) => { mocks.start = callback; },
  send: mocks.send,
} }));

class TransferWorker {
  static instances: TransferWorker[] = [];
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault: () => void; message: string }) => void;
  received?: { request: PluginRunRequest };
  transferred = 0;
  terminate = vi.fn();
  constructor() { TransferWorker.instances.push(this); }
  postMessage(payload: { request: PluginRunRequest }, transfers: ArrayBuffer[]) {
    // Real platform transfer semantics detach the source buffers, unlike a mock that only
    // records postMessage's arguments. This catches use-after-transfer validation mistakes.
    this.transferred = transfers.length;
    this.received = structuredClone(payload, { transfer: transfers });
  }
  emit(data: unknown) { this.onmessage?.({ data }); }
}
class WorkerURL extends URL {
  static createObjectURL = vi.fn(() => "blob:test-worker");
  static revokeObjectURL = vi.fn();
}

const pen = { id: "blue", name: "Blue", color: "#0000ff" };
const manifest: PluginManifest = { id: "test.host", name: "Host fixture", version: "1.0.0", apiVersion: 1,
  description: "Host transfer fixture", input: "bitmap", category: "bitmap-processor", outputs: ["vector", "bitmap"], bitmapPreparation: true };
const bitmapRequest = (prepared = true): PluginRunRequest => ({ runId: "host-run", pluginId: manifest.id, parameters: {}, input: {
  kind: "bitmap", sourceId: "image", width: 1, height: 1, widthPx: 1, heightPx: 1,
  data: new Uint8Array([10, 20, 30, 255]), page: { widthMM: 100, heightMM: 100 },
  placement: { x: 5, y: 10, scale: 2, rotation: 20 }, palette: [pen],
  ...(prepared ? { prepared: { version: 1 as const, widthPx: 1, heightPx: 1,
    settings: { ...DEFAULT_BITMAP_PREPARATION, palette: [], separation: "rgb" as const }, tones: new Uint8Array([20]),
    channels: ["#ff0000", "#00ff00", "#0000ff"].map((color, index) => ({ id: `rgb-${index}`, label: ["Red light", "Green light", "Blue light"][index],
      color, model: "light" as const, data: new Uint8Array([10 + index]) })) } } : {}),
} });
const vectorResult = { width: 1, height: 1, paths: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], penId: pen.id }] };
function start(request: PluginRunRequest, installed = manifest) {
  mocks.start!({}, { source: "export default () => null", request, manifest: installed });
  return TransferWorker.instances[0];
}

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); TransferWorker.instances = [];
  vi.stubGlobal("__TERRAFORGE_PLUGIN_WORKER__", "// bounded worker fixture");
  vi.stubGlobal("Worker", TransferWorker);
  vi.stubGlobal("URL", WorkerURL);
  await import("../../../src/preload/plugin-host");
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("isolated plugin host pixel transfers", () => {
  it("transfers original pixels, tones and channels once while retaining a usable validation frame", () => {
    const request = bitmapRequest();
    const worker = start(request);
    expect(worker.transferred).toBe(5);
    if (request.input.kind !== "bitmap" || worker.received?.request.input.kind !== "bitmap") throw new Error("Expected bitmap");
    expect(request.input.data.byteLength).toBe(0);
    expect(request.input.prepared!.tones.byteLength).toBe(0);
    expect(request.input.prepared!.channels.every(channel => channel.data.byteLength === 0)).toBe(true);
    expect([...worker.received.request.input.data]).toEqual([10, 20, 30, 255]);
    expect([...worker.received.request.input.prepared!.tones]).toEqual([20]);
    worker.emit({ type: "result", result: vectorResult });
    expect(mocks.send).toHaveBeenCalledWith("plugins:host-event", { type: "result", result: vectorResult });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([
    { ...vectorResult, width: 2 },
    { ...vectorResult, paths: [{ ...vectorResult.paths[0], penId: "unapproved-pen" }] },
  ])("still rejects invalid frames and pen references after pixel buffers are detached", result => {
    const worker = start(bitmapRequest());
    worker.emit({ type: "result", result });
    expect(mocks.send).toHaveBeenCalledWith("plugins:host-event", { type: "error", error: expect.any(String) });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("validates raster output against the preserved full frame after transferring input", () => {
    const worker = start(bitmapRequest());
    const result = { items: [{ kind: "bitmap", width: 1, height: 1, widthPx: 1, heightPx: 1, data: new Uint8Array([2, 4, 6, 255]) }] };
    worker.emit({ type: "result", result });
    expect(mocks.send).toHaveBeenCalledWith("plugins:host-event", { type: "result", result });
  });

  it("transfers only the original RGBA buffer for unchanged legacy bitmap plugins", () => {
    const legacy = { ...manifest }; delete legacy.bitmapPreparation;
    const worker = start(bitmapRequest(false), legacy);
    expect(worker.transferred).toBe(1);
    worker.emit({ type: "result", result: vectorResult });
    expect(mocks.send).toHaveBeenCalledWith("plugins:host-event", { type: "result", result: vectorResult });
  });

  it("ignores late results, errors and progress after reaching a terminal state", () => {
    const worker = start(bitmapRequest());
    worker.emit({ type: "error", error: "Cancelled worker" });
    worker.emit({ type: "result", result: vectorResult });
    worker.emit({ type: "progress", progress: 100 });
    worker.onerror?.({ preventDefault: vi.fn(), message: "late crash" });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(mocks.send).toHaveBeenCalledWith("plugins:host-event", { type: "error", error: "Cancelled worker" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
