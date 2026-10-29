import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { TaskManager } from "../../../src/tasks/taskManager";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  initialise: vi.fn(), list: vi.fn(), rescan: vi.fn(), installExample: vi.fn(), setEnabled: vi.fn(),
  run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn(), openPath: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "C:/terraforge-test-user-data" },
  ipcMain: { handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => mocks.handlers.set(channel, handler) },
  shell: { openPath: mocks.openPath },
}));
vi.mock("../../../src/main/plugins/registry", () => ({
  PluginRegistry: class {
    initialise = mocks.initialise;
    list = mocks.list;
    rescan = mocks.rescan;
    installExample = mocks.installExample;
    setEnabled = mocks.setEnabled;
  },
}));
vi.mock("../../../src/main/plugins/runtime", () => ({
  PluginRuntime: class {
    run = mocks.run;
    cancel = mocks.cancel;
    cancelAll = mocks.cancelAll;
  },
}));
import { registerPluginHandlers } from "../../../src/main/plugins";

const request = { runId: "run-1", pluginId: "test.generator", input: { kind: "none", page: { widthMM: 100, heightMM: 100 } }, parameters: {} };
const result = { width: 10, height: 10, paths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] };

describe("plugin IPC lifecycle", () => {
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  let main: { webContents: { mainFrame: object }; isDestroyed: () => boolean } | null;
  let event: { sender: object; senderFrame: object };
  let controller: { cancelAll: () => void };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.initialise.mockReturnValue(new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; }));
    mocks.run.mockResolvedValue(result);
    mocks.list.mockReturnValue([]);
    mocks.rescan.mockResolvedValue(undefined);
    mocks.openPath.mockResolvedValue("");
    main = { webContents: { mainFrame: {} }, isDestroyed: () => false };
    event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
    controller = registerPluginHandlers({ getMainWindow: () => main as unknown as BrowserWindow | null, taskManager: {} as TaskManager });
  });
  const invoke = (channel: string, event: unknown, ...args: unknown[]): Promise<unknown> => Promise.resolve(mocks.handlers.get(channel)!(event, ...args));

  it("remembers cancellation while startup discovery is still pending", async () => {
    const run = invoke("plugins:run", event, request);
    await invoke("plugins:cancel", event, request.runId);
    resolveReady();
    await expect(run).rejects.toThrow(/cancelled before/);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("cancels pending requests when the document closes even if the window remains", async () => {
    const run = invoke("plugins:run", event, request);
    controller.cancelAll();
    resolveReady();
    await expect(run).rejects.toThrow(/cancelled before/);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rechecks that the original main window still exists after discovery", async () => {
    const run = invoke("plugins:run", event, request);
    main = null;
    resolveReady();
    await expect(run).rejects.toThrow(/denied/);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects requests from a replaced main window and from child frames", async () => {
    const run = invoke("plugins:run", event, request);
    main = { webContents: { mainFrame: {} }, isDestroyed: () => false };
    resolveReady();
    await expect(run).rejects.toThrow(/denied/);
    const childEvent = { sender: main.webContents, senderFrame: {} };
    await expect(invoke("plugins:run", childEvent, request)).rejects.toThrow(/denied/);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rejects duplicate pending IDs without replacing their cancellation record", async () => {
    const first = invoke("plugins:run", event, request);
    await expect(invoke("plugins:run", event, request)).rejects.toThrow(/already pending/);
    await invoke("plugins:cancel", event, request.runId);
    resolveReady();
    await expect(first).rejects.toThrow(/cancelled before/);
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("hands an uncancelled request to the runtime and routes subsequent cancellation", async () => {
    const run = invoke("plugins:run", event, request);
    resolveReady();
    await expect(run).resolves.toEqual(result);
    expect(mocks.run).toHaveBeenCalledWith(request);
    await invoke("plugins:cancel", event, request.runId);
    expect(mocks.cancel).toHaveBeenCalledWith(request.runId);
    controller.cancelAll();
    expect(mocks.cancelAll).toHaveBeenCalledOnce();
  });

  it("clears pending state after startup failure without running code", async () => {
    const first = invoke("plugins:run", event, request);
    rejectReady(new Error("Discovery failed"));
    await expect(first).rejects.toThrow("Discovery failed");
    await expect(invoke("plugins:run", event, request)).rejects.toThrow("Discovery failed");
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("does not install files or open folders after the requesting window closes", async () => {
    const install = invoke("plugins:installExample", event);
    const open = invoke("plugins:openFolder", event);
    main = null;
    resolveReady();
    await expect(install).rejects.toThrow(/denied/);
    await expect(open).rejects.toThrow(/denied/);
    expect(mocks.installExample).not.toHaveBeenCalled();
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it("rescanning cancels pending startup work and returns metadata without running code", async () => {
    const run = invoke("plugins:run", event, request);
    const entries = [{ filename: "new.tf-plugin.js", enabled: true }];
    mocks.list.mockReturnValue(entries);
    const scan = invoke("plugins:rescan", event);
    resolveReady();
    await expect(run).rejects.toThrow(/cancelled before/);
    await expect(scan).resolves.toEqual(entries);
    expect(mocks.rescan).toHaveBeenCalledOnce();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("rescanning cancels active runtime work and refuses runs until the scan finishes", async () => {
    resolveReady();
    await invoke("plugins:run", event, request);
    let finishScan: () => void;
    mocks.rescan.mockReturnValue(new Promise<void>(resolve => { finishScan = resolve; }));
    const scan = invoke("plugins:rescan", event);
    expect(mocks.cancelAll).toHaveBeenCalledOnce();
    await expect(invoke("plugins:run", event, { ...request, runId: "during-scan" })).rejects.toThrow(/rescan is in progress/);
    await vi.waitFor(() => expect(mocks.rescan).toHaveBeenCalledOnce());
    finishScan!();
    await scan;
    await expect(invoke("plugins:run", event, { ...request, runId: "after-scan" })).resolves.toEqual(result);
  });

  it("rejects rescan from child frames and releases the scan gate after failures", async () => {
    resolveReady();
    await expect(invoke("plugins:rescan", { sender: event.sender, senderFrame: {} })).rejects.toThrow(/denied/);
    expect(mocks.rescan).not.toHaveBeenCalled();
    mocks.rescan.mockRejectedValue(new Error("Plugin folder unavailable"));
    await expect(invoke("plugins:rescan", event)).rejects.toThrow(/unavailable/);
    await expect(invoke("plugins:run", event, request)).resolves.toEqual(result);
  });
});
