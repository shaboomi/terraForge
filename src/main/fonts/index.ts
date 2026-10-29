import { app, dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { ProcessedFont } from "../../types/fonts";
import { FONT_PROCESSING_LIMITS, type FontIdentity } from "../../fonts/processor";
import { readBoundedFile } from "../files/boundedFile";
import { createFontLibrary, validateProcessedFont } from "./library";

export function runFontWorker(bytes: Uint8Array, identity: FontIdentity): Promise<ProcessedFont> {
  return new Promise((resolve,reject) => {
    let finished = false;
    const worker = new Worker(join(__dirname,"font-worker.js"),{ workerData:{ bytes,identity },resourceLimits:{ maxOldGenerationSizeMb:256 } });
    const deadline = setTimeout(() => { finished = true; void worker.terminate(); reject(new Error("Font processing exceeded two minutes. Choose a simpler font.")); },120_000);
    worker.once("message",(message: { font?: unknown; error?: string }) => {
      finished = true;
      clearTimeout(deadline); void worker.terminate();
      if (message.error) reject(new Error(message.error));
      else {
        try { resolve(validateProcessedFont(message.font)); }
        catch (error) { reject(error); }
      }
    });
    worker.once("error",(error) => { finished = true; clearTimeout(deadline); reject(error); });
    worker.once("exit",(code) => { clearTimeout(deadline); if (!finished) reject(new Error(`Font processor stopped before returning a font (${code}).`)); });
  });
}

export function registerFontHandlers(getMainWindow: () => BrowserWindow | null): void {
  const library = createFontLibrary(join(app.getPath("userData"),"font-library"));
  let importing = false;
  const assertSender = (event: IpcMainInvokeEvent) => {
    const window = getMainWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Font library access is unavailable.");
  };
  ipcMain.handle("fonts:list",async (event) => { assertSender(event); return library.list(); });
  ipcMain.handle("fonts:remove",async (event,id: unknown) => { assertSender(event); return library.remove(id); });
  ipcMain.handle("fonts:import",async (event,characters: unknown) => {
    assertSender(event);
    if (characters !== undefined && (typeof characters !== "string" || characters.length > 4096)) throw new Error("Font character selection must contain at most 4096 characters.");
    if (importing) throw new Error("A font is already being processed.");
    importing = true;
    try {
      const result = await dialog.showOpenDialog(getMainWindow()!,{ title:"Process font to centrelines",filters:[{ name:"TrueType and OpenType fonts",extensions:["ttf","otf"] }],properties:["openFile"] });
      if (result.canceled || !result.filePaths[0]) return null;
      const file = result.filePaths[0];
      if (![".ttf",".otf"].includes(extname(file).toLowerCase())) throw new Error("Choose a TTF or OTF font.");
      const bytes = await readBoundedFile(file,FONT_PROCESSING_LIMITS.fileBytes,"Font");
      const font = await runFontWorker(bytes,{ id:randomUUID(),sourceName:basename(file),characters:characters as string | undefined });
      await library.save(font);
      return font;
    } finally { importing = false; }
  });
}
