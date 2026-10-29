import { app, BrowserWindow, ipcMain, session } from "electron";
import { join } from "node:path";
import type { PluginManifest, PluginResult, PluginRunRequest } from "../../types";
import { pluginExecutionLimits, validatePluginParameters, validatePluginResult, validatePluginRunRequest } from "../../types/pluginValidation";
import type { TaskManager } from "../../tasks/taskManager";
import type { PluginRegistry } from "./registry";
import { configurePluginProtocol } from "./protocol";

interface ActiveRun {
  done: boolean;
  manifest?: PluginManifest;
  host?: BrowserWindow;
  finish: (error?: string, result?: PluginResult, cancelled?: boolean) => void;
}


export class PluginRuntime {
  private readonly active = new Map<string, ActiveRun>();
  private readonly timeoutMs: number | undefined;
  private readonly pluginSession: Electron.Session;
  private readonly hostProtocol: { createHostUrl: () => string };

  constructor(private readonly registry: PluginRegistry, private readonly tasks: TaskManager) {
    const override = !app.isPackaged ? Number(process.env.TERRAFORGE_PLUGIN_TIMEOUT_MS) : NaN;
    this.timeoutMs = Number.isFinite(override) && override >= 100 && override <= 180_000 ? override : undefined;
    this.pluginSession = session.fromPartition("terraforge-plugin-host");
    this.pluginSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    this.pluginSession.setPermissionCheckHandler(() => false);
    this.pluginSession.setDevicePermissionHandler(() => false);
    this.hostProtocol = configurePluginProtocol(this.pluginSession);
    this.pluginSession.on("will-download", (event) => event.preventDefault());
  }

  run(request: PluginRunRequest): Promise<PluginResult> {
    try { request = validatePluginRunRequest(request); }
    catch (error) { return Promise.reject(error); }
    if (this.active.size > 0) return Promise.reject(new Error("Another plugin is already running."));
    if (this.tasks.get(request.runId)) return Promise.reject(new Error("This plugin run ID has already been used."));
    if (app.commandLine.hasSwitch("no-sandbox") || app.commandLine.hasSwitch("disable-web-security")) {
      return Promise.reject(new Error("Plugins require TerraForge to run with its security protections enabled."));
    }
    return new Promise<PluginResult>((resolve, reject) => {
      this.tasks.create(request.runId, "plugin-run", "Starting plugin…");
      const run: ActiveRun = { done: false, finish: () => {} };
      let deadline: ReturnType<typeof setTimeout>;
      const onMessage = (event: Electron.IpcMainEvent, payload: unknown) => {
        if (run.done || !run.host || event.sender !== run.host.webContents ||
            event.senderFrame !== run.host.webContents.mainFrame || !payload || typeof payload !== "object") return;
        const message = payload as Record<string, unknown>;
        if (message.type === "progress") {
          const progress = message.progress;
          if (progress === null || (typeof progress === "number" && Number.isFinite(progress) && progress >= 0 && progress <= 100)) {
            this.tasks.update(request.runId, { progress });
          }
        } else if (message.type === "error") {
          run.finish(typeof message.error === "string" ? message.error.slice(0, 2000) : "Plugin failed.");
        } else if (message.type === "result") {
          try {
            if (!run.manifest) throw new Error("Plugin runner is not ready.");
            run.finish(undefined, validatePluginResult(message.result, request, run.manifest));
          }
          catch (error) { run.finish(String(error)); }
        }
      };
      run.finish = (error, result, cancelled = false) => {
        if (run.done) return;
        run.done = true;
        clearTimeout(deadline);
        this.active.delete(request.runId);
        ipcMain.off("plugins:host-event", onMessage);
        this.tasks.clearCancelHandler(request.runId);
        if (run.host && !run.host.isDestroyed()) run.host.destroy();
        if (cancelled) {
          if (this.tasks.get(request.runId)?.status === "running") this.tasks.cancel(request.runId);
          reject(new Error(error ?? "Plugin cancelled."));
        } else if (error || !result) {
          this.tasks.fail(request.runId, error ?? "Plugin returned no artwork.");
          reject(new Error(error ?? "Plugin returned no artwork."));
        } else {
          this.tasks.complete(request.runId);
          resolve(result);
        }
      };
      this.active.set(request.runId, run);
      this.tasks.registerCancelHandler(request.runId, () => run.finish("Plugin cancelled.", undefined, true));
      ipcMain.on("plugins:host-event", onMessage);
      deadline = setTimeout(() => run.finish("Plugin exceeded its time limit."), Math.min(this.timeoutMs ?? Infinity, pluginExecutionLimits(request.detailBudget).executionMs));
      void this.prepare(request, run).catch((error: unknown) => run.finish(String(error)));
    });
  }

  cancel(runId: string): void {
    this.active.get(runId)?.finish("Plugin cancelled.", undefined, true);
  }

  cancelAll(): void {
    for (const run of [...this.active.values()]) run.finish("Plugin cancelled because the canvas closed.", undefined, true);
  }

  private async prepare(request: PluginRunRequest, run: ActiveRun): Promise<void> {
    const { manifest, source } = await this.registry.getExecutable(request.pluginId);
    if (run.done) return;
    if (manifest.input !== request.input.kind) throw new Error(`This plugin requires ${manifest.input === "none" ? "no selected input" : `one selected ${manifest.input}`}.`);
    run.manifest = manifest;
    const parameters = validatePluginParameters(manifest, request.parameters);
    for (const control of manifest.controls ?? []) {
      if (control.type === "pen" && !(request.input.palette ?? []).some(pen => pen.id === parameters[control.key])) {
        throw new Error(`Choose an available ${control.label} from your configured pens.`);
      }
    }
    const task = this.tasks.get(request.runId);
    if (task) task.label = manifest.name;
    const host = new BrowserWindow({
      width: 1, height: 1, show: false, skipTaskbar: true,
      webPreferences: {
        preload: join(__dirname, "../preload/plugin-host.js"),
        sandbox: true, contextIsolation: true, nodeIntegration: false,
        nodeIntegrationInWorker: false, webSecurity: true,
        allowRunningInsecureContent: false, webviewTag: false,
        devTools: false, backgroundThrottling: false,
        session: this.pluginSession,
      },
    });
    run.host = host;
    host.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    host.webContents.on("will-navigate", (event) => event.preventDefault());
    host.webContents.on("will-attach-webview", (event) => event.preventDefault());
    host.webContents.on("render-process-gone", () => run.finish("Plugin runner stopped unexpectedly."));
    host.on("closed", () => run.finish("Plugin runner closed unexpectedly."));
    await host.loadURL(this.hostProtocol.createHostUrl());
    if (!run.done) host.webContents.send("plugins:host-start", {
      source, request: { ...request, parameters }, manifest,
    });
  }
}
