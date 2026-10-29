import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest, PluginRunRequest } from "../../../src/types";
import type { PluginRegistry } from "../../../src/main/plugins/registry";
import type { TaskManager } from "../../../src/tasks/taskManager";
import { DEFAULT_BITMAP_PREPARATION, type PreparedPluginBitmap } from "../../../src/types/pluginBitmapPreparation";

const mocks = vi.hoisted(() => ({
  listeners: new Map<string, (event: unknown, payload: unknown) => void>(),
  hosts: [] as unknown[],
  getExecutable: vi.fn(), start: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false, commandLine: { hasSwitch: () => false } },
  session: { fromPartition: () => ({ setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(), on: vi.fn() }) },
  ipcMain: {
    on: (channel: string, callback: (event: unknown, payload: unknown) => void) => mocks.listeners.set(channel, callback),
    off: (channel: string) => mocks.listeners.delete(channel),
  },
  BrowserWindow: class {
    dead = false;
    webContents = {
      mainFrame: {}, setWindowOpenHandler: vi.fn(), on: vi.fn(),
      send: (channel: string, payload: unknown) => mocks.start(channel, payload),
    };
    constructor() { mocks.hosts.push(this); }
    on = vi.fn();
    loadURL = vi.fn().mockResolvedValue(undefined);
    isDestroyed = () => this.dead;
    destroy = () => { this.dead = true; };
  },
}));
vi.mock("../../../src/main/plugins/protocol", () => ({ configurePluginProtocol: () => ({ createHostUrl: () => "terraforge-plugin://host/test" }) }));
import { PluginRuntime } from "../../../src/main/plugins/runtime";

type Host = { dead: boolean; webContents: { mainFrame: object } };
const pen = { id: "blue", name: "Blue", color: "#123abc" };
const manifest: PluginManifest = { id: "test.processor", name: "Processor", version: "1.0.0", apiVersion: 1, description: "Process", category: "bitmap-processor", input: "bitmap", outputs: ["vector", "bitmap"] };
const request = (): PluginRunRequest => ({ runId: "run-1", pluginId: manifest.id, parameters: {}, seed: 42, input: { kind: "bitmap", sourceId: "source", width: 1, height: 1, widthPx: 1, heightPx: 1, data: new Uint8Array([1, 2, 3, 0]), page: { widthMM: 210, heightMM: 297 }, placement: { x: 10, y: 20, scale: 2, rotation: 30 }, palette: [pen] } });
const vector = { kind: "vector", width: 1, height: 1, paths: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], penId: pen.id }] };
const prepared = (): PreparedPluginBitmap => ({ version: 1, widthPx: 1, heightPx: 1,
  settings: { ...DEFAULT_BITMAP_PREPARATION, palette: [] }, tones: new Uint8Array([255]), channels: [] });
function preparedRequest(): PluginRunRequest {
  const value = request();
  if (value.input.kind !== "bitmap") throw new Error("Expected bitmap fixture");
  return { ...value, input: { ...value.input, prepared: prepared() } };
}

describe("plugin processor runtime boundary", () => {
  let runtime: PluginRuntime;
  const tasks = { get: vi.fn(), create: vi.fn(), update: vi.fn(), complete: vi.fn(), fail: vi.fn(), cancel: vi.fn(), registerCancelHandler: vi.fn(), clearCancelHandler: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks(); mocks.hosts.length = 0; mocks.listeners.clear();
    mocks.getExecutable.mockResolvedValue({ manifest, source: "export default () => null;" });
    runtime = new PluginRuntime({ getExecutable: mocks.getExecutable } as unknown as PluginRegistry, tasks as unknown as TaskManager);
  });
  const ready = async () => { await vi.waitFor(() => expect(mocks.start).toHaveBeenCalledOnce()); return mocks.hosts[0] as Host; };
  const emit = (host: Host, payload: unknown, frame: object = host.webContents.mainFrame) => mocks.listeners.get("plugins:host-event")!({ sender: host.webContents, senderFrame: frame }, payload);

  it("passes detached bitmap bytes, seed, palette and validated manifest to the isolated host", async () => {
    const supplied = request();
    const running = runtime.run(supplied);
    const host = await ready();
    const payload = mocks.start.mock.calls[0][1] as { request: PluginRunRequest; manifest: PluginManifest };
    expect(payload.manifest).toEqual(manifest);
    expect(payload.request).toEqual(supplied);
    if (payload.request.input.kind !== "bitmap" || supplied.input.kind !== "bitmap") throw new Error("Expected bitmap");
    expect(payload.request.input.data).not.toBe(supplied.input.data);
    emit(host, { type: "result", result: { items: [vector] } });
    await expect(running).resolves.toEqual({ items: [vector] });
    expect(host.dead).toBe(true);
    expect(tasks.complete).toHaveBeenCalledWith("run-1");
  });

  it("checks selected input against the actual installed manifest before starting a host", async () => {
    mocks.getExecutable.mockResolvedValue({ manifest: { ...manifest, input: "vector" }, source: "" });
    await expect(runtime.run(request())).rejects.toThrow(/selected vector/);
    expect(mocks.hosts).toHaveLength(0);
  });

  it("refuses shared preparation for a legacy plugin that has not explicitly opted in", async () => {
    await expect(runtime.run(preparedRequest())).rejects.toThrow(/explicit opt-in/);
    expect(mocks.hosts).toHaveLength(0);
    expect(tasks.complete).not.toHaveBeenCalled();
  });

  it("requires a prepared payload when the installed manifest opts in", async () => {
    mocks.getExecutable.mockResolvedValue({ manifest: { ...manifest, bitmapPreparation: true }, source: "" });
    await expect(runtime.run(request())).rejects.toThrow(/explicit opt-in/);
    expect(mocks.hosts).toHaveLength(0);
  });

  it("passes detached prepared tones alongside unchanged original RGBA only after explicit opt-in", async () => {
    mocks.getExecutable.mockResolvedValue({ manifest: { ...manifest, bitmapPreparation: true }, source: "" });
    const supplied = preparedRequest();
    const running = runtime.run(supplied);
    const host = await ready();
    const payload = mocks.start.mock.calls[0][1] as { request: PluginRunRequest };
    if (payload.request.input.kind !== "bitmap" || supplied.input.kind !== "bitmap") throw new Error("Expected bitmap");
    expect(payload.request.input.data).toEqual(new Uint8Array([1, 2, 3, 0]));
    expect(payload.request.input.data).not.toBe(supplied.input.data);
    expect(payload.request.input.prepared).toEqual(supplied.input.prepared);
    expect(payload.request.input.prepared?.tones).not.toBe(supplied.input.prepared?.tones);
    payload.request.input.prepared!.tones[0] = 0;
    expect(supplied.input.prepared?.tones[0]).toBe(255);
    emit(host, { type: "result", result: { items: [vector] } });
    await expect(running).resolves.toEqual({ items: [vector] });
  });

  it("rejects malformed prepared data before creating a task or host", async () => {
    const supplied = preparedRequest();
    if (supplied.input.kind !== "bitmap") throw new Error("Expected bitmap");
    supplied.input.prepared!.tones = new Uint8Array(2);
    await expect(runtime.run(supplied)).rejects.toThrow(/byte arrays/);
    expect(tasks.create).not.toHaveBeenCalled();
    expect(mocks.hosts).toHaveLength(0);
  });

  it("rejects a same-version source mismatch before starting a host", async () => {
    mocks.getExecutable.mockResolvedValue({ manifest, source: "", sourceFingerprint: "b".repeat(64) });
    await expect(runtime.run({ ...request(), sourceFingerprint: "a".repeat(64) })).rejects.toThrow(/source changed/);
    expect(mocks.hosts).toHaveLength(0);
    expect(tasks.complete).not.toHaveBeenCalled();
  });

  it("allows an explicitly pinned current source fingerprint", async () => {
    const fingerprint = "a".repeat(64);
    mocks.getExecutable.mockResolvedValue({ manifest, source: "", sourceFingerprint: fingerprint });
    const running = runtime.run({ ...request(), sourceFingerprint: fingerprint });
    const host = await ready();
    emit(host, { type: "result", result: { items: [vector] } });
    await expect(running).resolves.toEqual({ items: [vector] });
  });

  it("does not launch a host when cancelled while the executable is being read", async () => {
    let finishRead: (value: unknown) => void;
    mocks.getExecutable.mockReturnValue(new Promise(resolve => { finishRead = resolve; }));
    const running = runtime.run(request());
    runtime.cancelAll();
    await expect(running).rejects.toThrow(/cancelled/);
    finishRead!({ manifest, source: "" });
    await Promise.resolve();
    expect(mocks.hosts).toHaveLength(0);
  });

  it.each([
    { items: [{ ...vector, width: 2 }] },
    { items: [{ ...vector, paths: [{ ...vector.paths[0], penId: "missing" }] }] },
    { items: [{ kind: "bitmap", width: 1, height: 1, widthPx: 1, heightPx: 1, data: new Uint8Array(3) }] },
  ])("revalidates untrusted host results against the request %j", async (result) => {
    const running = runtime.run(request());
    const host = await ready();
    emit(host, { type: "result", result });
    await expect(running).rejects.toThrow();
    expect(host.dead).toBe(true);
    expect(tasks.complete).not.toHaveBeenCalled();
    expect(tasks.fail).toHaveBeenCalled();
  });

  it("rejects undeclared raster output even if the host sends valid pixel data", async () => {
    mocks.getExecutable.mockResolvedValue({ manifest: { ...manifest, outputs: ["vector"] }, source: "" });
    const running = runtime.run(request());
    const host = await ready();
    emit(host, { type: "result", result: { items: [{ kind: "bitmap", width: 1, height: 1, widthPx: 1, heightPx: 1, data: new Uint8Array(4) }] } });
    await expect(running).rejects.toThrow(/undeclared bitmap/);
  });

  it("ignores child-frame results and rejects cancelled runs without applying their late reply", async () => {
    const running = runtime.run(request());
    const host = await ready();
    emit(host, { type: "result", result: { items: [vector] } }, {});
    expect(tasks.complete).not.toHaveBeenCalled();
    const late = mocks.listeners.get("plugins:host-event")!;
    runtime.cancel("run-1");
    await expect(running).rejects.toThrow(/cancelled/);
    late({ sender: host.webContents, senderFrame: host.webContents.mainFrame }, { type: "result", result: { items: [vector] } });
    expect(tasks.complete).not.toHaveBeenCalled();
  });
  it.each(["standard","extended"] as const)("enforces the %s deadline",async detailBudget=>{
    vi.useFakeTimers();
    try{
      const outcome=runtime.run({...request(),detailBudget}).then(()=>"completed",error=>String(error));
      const deadline=detailBudget==="extended"?180000:30000;
      await vi.advanceTimersByTimeAsync(deadline-1);expect(tasks.fail).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);expect(await outcome).toMatch(/time limit/);
      expect(tasks.fail).toHaveBeenCalledOnce();
    }finally{vi.useRealTimers();}
  });

});
