import { app, ipcMain, shell, type BrowserWindow } from "electron";
import { isAbsolute, join } from "node:path";
import { validatePluginRunRequest } from "../../types/pluginValidation";
import type { TaskManager } from "../../tasks/taskManager";
import { PluginRegistry } from "./registry";
import { PluginRuntime } from "./runtime";

export function registerPluginHandlers(options: {
  getMainWindow: () => BrowserWindow | null;
  taskManager: TaskManager;
}): { cancelAll: () => void } {
  const override = !app.isPackaged ? process.env.TERRAFORGE_PLUGIN_DIR : undefined;
  if (override && !isAbsolute(override)) throw new Error("TERRAFORGE_PLUGIN_DIR must be absolute.");
  const directory = override ?? join(app.getPath("userData"), app.isPackaged ? "plugins" : "plugins-dev");
  const registry = new PluginRegistry(directory);
  const ready = registry.initialise();
  // Preserve the rejected promise for requests, while avoiding an unhandled startup rejection.
  void ready.catch(() => {});
  let runtime: PluginRuntime | undefined;
  let documentGeneration = 0;
  const pendingRuns = new Map<string, { cancelled: boolean; generation: number }>();
  const assertSender = (event: Electron.IpcMainInvokeEvent) => {
    const main = options.getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents ||
        event.senderFrame !== main.webContents.mainFrame) throw new Error("Plugin request denied.");
  };
  ipcMain.handle("plugins:list", async (event) => {
    assertSender(event);
    await ready;
    assertSender(event);
    return registry.list();
  });
  ipcMain.handle("plugins:openFolder", async (event) => {
    assertSender(event);
    await ready;
    assertSender(event);
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  ipcMain.handle("plugins:installExample", async (event) => {
    assertSender(event);
    await ready;
    assertSender(event);
    await registry.installExample();
  });
  ipcMain.handle("plugins:setEnabled", async (event, pluginId: unknown, enabled: unknown) => {
    assertSender(event);
    if (typeof pluginId !== "string" || typeof enabled !== "boolean") throw new Error("Invalid plugin setting.");
    await ready;
    assertSender(event);
    await registry.setEnabled(pluginId, enabled);
  });
  ipcMain.handle("plugins:run", async (event, value: unknown) => {
    assertSender(event);
    const request = validatePluginRunRequest(value);
    if (pendingRuns.has(request.runId)) throw new Error("This plugin run ID is already pending.");
    const pending = { cancelled: false, generation: documentGeneration };
    pendingRuns.set(request.runId, pending);
    try {
      await ready;
      assertSender(event);
      if (pending.cancelled || pending.generation !== documentGeneration) throw new Error("Plugin cancelled before it started.");
      runtime ??= new PluginRuntime(registry, options.taskManager);
      // Runtime.run synchronously claims ownership before this pending entry is removed.
      return runtime.run(request);
    } finally {
      pendingRuns.delete(request.runId);
    }
  });
  ipcMain.handle("plugins:cancel", (event, runId: unknown) => {
    assertSender(event);
    if (typeof runId !== "string" || runId.length > 128) throw new Error("Invalid plugin run ID.");
    const pending = pendingRuns.get(runId);
    if (pending) pending.cancelled = true;
    runtime?.cancel(runId);
  });
  return {
    cancelAll: () => {
      documentGeneration++;
      for (const pending of pendingRuns.values()) pending.cancelled = true;
      runtime?.cancelAll();
    },
  };
}