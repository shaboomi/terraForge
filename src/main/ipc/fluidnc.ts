import { ipcMain } from "electron";
import { join } from "path";
import { tmpdir } from "os";
import { readFile, writeFile, unlink } from "fs/promises";
import { FluidNCClient } from "../../machine/fluidnc";
import { SerialClient } from "../../machine/serial";
import { TaskManager } from "../../tasks/taskManager";
import { PlotCompletionController } from "../../machine/plotCompletion";
import type { PlotCompletionConfig, MachineStatus } from "../../types";

export interface FluidNCIpcOptions {
  fluidnc: FluidNCClient;
  serial: SerialClient;
  getConnectionType: () => "wifi" | "serial" | null;
  setConnectionType: (type: "wifi" | "serial" | null) => void;
  safeSend: (channel: string, ...args: unknown[]) => void;
  taskManager: TaskManager;
}

export function registerFluidncIpcHandlers(options: FluidNCIpcOptions): void {
  const {
    fluidnc,
    serial,
    getConnectionType,
    setConnectionType,
    safeSend,
    taskManager,
  } = options;

  const transferAbortControllers = new Map<string, AbortController>();
  const completion = new PlotCompletionController(async (command) => {
    const type = getConnectionType();
    if (type === null) throw new Error("Not connected");
    return type === "serial" ? serial.sendCommand(command) : fluidnc.sendCommandAndWait(command);
  }, (message) => safeSend("fluidnc:console", message));
  fluidnc.on?.("status", (status: MachineStatus) => { if (getConnectionType() === "wifi") completion.status(status); });
  serial.on?.("status", (status: MachineStatus) => { if (getConnectionType() === "serial") completion.status(status); });
  fluidnc.on?.("console", (message: string) => { if (getConnectionType() === "wifi") completion.message(message); });
  serial.on?.("data", (message: string) => { if (getConnectionType() === "serial") completion.message(message); });
  fluidnc.on?.("connection-lost", () => completion.cancel());
  serial.on?.("connection-lost", () => completion.cancel());

  const manualCommand = (command: string) => {
    if (command.trim() === "?") return;
    if (command.trim() === "!") completion.pause();
    else if (command.trim() === "~") completion.resume();
    else completion.cancel(); // Manual motion/modal changes supersede automatic return.
  };

  // All handlers transparently route to either the HTTP client (Wi-Fi) or the
  // serial command layer (USB) depending on which transport is active.

  ipcMain.handle("fluidnc:getStatus", () => {
    if (getConnectionType() === "serial") return serial.sendCommand("?");
    return fluidnc.getStatus();
  });

  ipcMain.handle("fluidnc:sendCommand", (_e, cmd: string) => {
    manualCommand(cmd);
    const connType = getConnectionType();
    if (connType === null) return Promise.reject(new Error("Not connected"));
    if (connType === "serial") return serial.sendCommand(cmd);
    return fluidnc.sendCommand(cmd);
  });

  ipcMain.handle("fluidnc:listFiles", (_e, path?: string) => {
    if (getConnectionType() === "serial") return serial.listFiles(path);
    return fluidnc.listFiles(path);
  });

  ipcMain.handle("fluidnc:listSDFiles", (_e, path?: string) => {
    if (getConnectionType() === "serial") return serial.listSDFiles(path);
    return fluidnc.listSDFiles(path);
  });

  ipcMain.handle(
    "fluidnc:fetchFileText",
    (_e, remotePath: string, filesystem?: "internal" | "sdcard") => {
      if (getConnectionType() === "serial")
        return serial.fetchFileText(remotePath, filesystem);
      return fluidnc.fetchFileText(remotePath, filesystem);
    },
  );

  ipcMain.handle(
    "fluidnc:deleteFile",
    (_e, remotePath: string, source?: "sd" | "fs") => {
      if (getConnectionType() === "serial")
        return serial.deleteFile(remotePath, source ?? "sd");
      return fluidnc.deleteFile(remotePath, source ?? "fs");
    },
  );

  ipcMain.handle(
    "fluidnc:runFile",
    async (_e, remotePath: string, filesystem: "sd" | "fs", config: PlotCompletionConfig) => {
      const type = getConnectionType();
      if (type === null) throw new Error("Not connected");
      const plot = completion.begin(remotePath, config);
      try {
        if (type === "serial") await serial.runFile(remotePath, filesystem ?? "sd");
        else await fluidnc.runFile(remotePath, filesystem);
        completion.accepted(plot);
      } catch (error) {
        completion.cancel();
        throw error;
      }
    },
  );

  ipcMain.handle("fluidnc:pauseJob", () => {
    completion.pause();
    if (getConnectionType() === "serial") {
      serial.sendRealtime("!");
      return;
    }
    return fluidnc.pauseJob();
  });

  ipcMain.handle("fluidnc:resumeJob", () => {
    completion.resume();
    if (getConnectionType() === "serial") {
      serial.sendRealtime("~");
      return;
    }
    return fluidnc.resumeJob();
  });

  ipcMain.handle("fluidnc:abortJob", () => {
    completion.cancel();
    if (getConnectionType() === "serial") {
      serial.sendRealtime("\x18");
      return;
    }
    return fluidnc.abortJob();
  });

  ipcMain.handle(
    "fluidnc:connectWebSocket",
    (_e, host: string, port: number, wsPort?: number) => {
      completion.cancel();
      setConnectionType("wifi");
      return fluidnc.connectWebSocket(host, port, wsPort);
    },
  );

  ipcMain.handle("fluidnc:disconnectWebSocket", () => {
    completion.cancel();
    setConnectionType(null);
    return fluidnc.disconnectWebSocket();
  });

  ipcMain.handle(
    "fluidnc:uploadGcode",
    async (_e, taskId: string, content: string, remotePath: string) => {
      // Use the desired remote filename for the temp file so the multipart
      // form carries the right name — FluidNC writes the multipart filename
      // to the SD card, not the local path.
      const remoteFilename = remotePath.split(/[\\/]/).pop()!;
      const tempPath = join(tmpdir(), `tf-${Date.now()}-${remoteFilename}`);
      const abortController = new AbortController();
      transferAbortControllers.set(taskId, abortController);
      taskManager.registerCancelHandler(taskId, () => abortController.abort());
      taskManager.create(taskId, "file-upload", `Uploading ${remoteFilename}`);
      try {
        await writeFile(tempPath, content, "utf-8");
        await fluidnc.uploadFile(
          tempPath,
          remotePath,
          (progress) => {
            taskManager.update(taskId, { progress });
            safeSend("task:update", taskManager.get(taskId));
          },
          remoteFilename, // ← override multipart filename so SD card gets the right name
          abortController.signal,
        );
        if (!taskManager.isCancelled(taskId)) {
          taskManager.complete(taskId);
        }
        safeSend("task:update", taskManager.get(taskId));
      } catch (err: unknown) {
        if (!taskManager.isCancelled(taskId)) {
          taskManager.fail(taskId, String(err));
          safeSend("task:update", taskManager.get(taskId));
          throw err;
        }
      } finally {
        taskManager.clearCancelHandler(taskId);
        transferAbortControllers.delete(taskId);
        await unlink(tempPath).catch(() => {});
      }
    },
  );

  ipcMain.handle(
    "fluidnc:uploadFile",
    async (_e, taskId: string, localPath: string, remotePath: string) => {
      const abortController = new AbortController();
      transferAbortControllers.set(taskId, abortController);
      taskManager.registerCancelHandler(taskId, () => abortController.abort());
      taskManager.create(taskId, "file-upload", `Uploading ${remotePath}`);
      try {
        await fluidnc.uploadFile(
          localPath,
          remotePath,
          (progress) => {
            taskManager.update(taskId, { progress });
            safeSend("task:update", taskManager.get(taskId));
          },
          undefined,
          abortController.signal,
        );
        if (!taskManager.isCancelled(taskId)) {
          taskManager.complete(taskId);
        }
      } catch (err: unknown) {
        if (!taskManager.isCancelled(taskId)) {
          taskManager.fail(taskId, String(err));
        }
      } finally {
        taskManager.clearCancelHandler(taskId);
        transferAbortControllers.delete(taskId);
      }
    },
  );

  ipcMain.handle(
    "fluidnc:downloadFile",
    async (
      _e,
      taskId: string,
      remotePath: string,
      localPath: string,
      filesystem?: "internal" | "sdcard",
    ) => {
      const abortController = new AbortController();
      transferAbortControllers.set(taskId, abortController);
      taskManager.registerCancelHandler(taskId, () => abortController.abort());
      taskManager.create(taskId, "file-download", `Downloading ${remotePath}`);
      try {
        await fluidnc.downloadFile(
          remotePath,
          localPath,
          filesystem,
          (progress) => {
            taskManager.update(taskId, { progress });
            safeSend("task:update", taskManager.get(taskId));
          },
          abortController.signal,
        );
        if (!taskManager.isCancelled(taskId)) {
          taskManager.complete(taskId);
        }
      } catch (err: unknown) {
        if (!taskManager.isCancelled(taskId)) {
          taskManager.fail(taskId, String(err));
        }
      } finally {
        taskManager.clearCancelHandler(taskId);
        transferAbortControllers.delete(taskId);
      }
    },
  );

  // ─── Serial handlers ───────────────────────────────────────────────────────
  // Status goes to the same channel as Wi-Fi status so the renderer doesn't
  // need to care which transport is active. Also emit a ping so the 15s watchdog
  // timer stays alive over serial.

  ipcMain.handle("serial:listPorts", () => serial.listPorts());

  ipcMain.handle(
    "serial:connect",
    async (_e, path: string, baudRate?: number) => {
      completion.cancel();
      await serial.connect(path, baudRate);
      setConnectionType("serial");
      // Start polling `?` for status reports (same cadence as WS $RI=500).
      serial.startStatusPolling(500);
      safeSend(
        "serial:data",
        `[terraForge] Serial connected to ${path} @ ${baudRate ?? 115200} baud`,
      );
    },
  );

  ipcMain.handle("serial:disconnect", async () => {
    completion.cancel();
    serial.stopStatusPolling();
    setConnectionType(null);
    await serial.disconnect();
  });

  ipcMain.handle("serial:send", (_e, data: string) => {
    manualCommand(data);
    return serial.send(data);
  });
}
