import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import type { TaskManager } from "../../../src/tasks/taskManager";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  initialise: vi.fn(), list: vi.fn(), installExample: vi.fn(), setEnabled: vi.fn(),
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
});