import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const mocks = vi.hoisted(() => ({
  handlers:new Map<string,(event:unknown,...args:unknown[]) => unknown>(),
  dialog:vi.fn(),list:vi.fn(),save:vi.fn(),remove:vi.fn(),read:vi.fn(),workers:[] as { emit:(name:string,value:unknown) => void; terminate:ReturnType<typeof vi.fn> }[],
}));
vi.mock("electron",() => ({app:{getPath:() => "font-test-library"},dialog:{showOpenDialog:mocks.dialog},ipcMain:{handle:(name:string,handler:(event:unknown,...args:unknown[]) => unknown) => mocks.handlers.set(name,handler)}}));
vi.mock("node:worker_threads",() => { const Worker = class {
  callbacks = new Map<string,(value:unknown) => void>();
  terminate = vi.fn().mockResolvedValue(0);
  constructor() { mocks.workers.push(this); }
  once(name:string,callback:(value:unknown) => void) { this.callbacks.set(name,callback); return this; }
  emit(name:string,value:unknown) { this.callbacks.get(name)?.(value); }
};return {Worker,default:{Worker}};});
vi.mock("../../src/main/fonts/library",async (importOriginal) => {
  const original = await importOriginal<typeof import("../../src/main/fonts/library")>();
  return {...original,createFontLibrary:() => ({list:mocks.list,save:mocks.save,remove:mocks.remove})};
});
vi.mock("../../src/main/files/boundedFile",() => ({readBoundedFile:mocks.read}));
import { registerFontHandlers, runFontWorker } from "../../src/main/fonts";

const main = {webContents:{mainFrame:{}}};
const event = {sender:main.webContents,senderFrame:main.webContents.mainFrame};
const font = {version:1,id:"font-test",name:"Test",sourceName:"Test.ttf",createdAt:"2026-10-29T00:00:00.000Z",unitsPerEm:1000,ascender:800,descender:-200,lineGap:0,glyphs:{},kerning:{},warnings:[]};
const invoke = (name:string,...args:unknown[]) => Promise.resolve().then(() => mocks.handlers.get(name)!(...args as [unknown,...unknown[]]));

beforeEach(() => {
  vi.clearAllMocks();mocks.handlers.clear();mocks.workers.length=0;
  mocks.list.mockResolvedValue([]);mocks.save.mockResolvedValue(undefined);mocks.remove.mockResolvedValue(undefined);
  mocks.dialog.mockResolvedValue({canceled:true,filePaths:[]});mocks.read.mockResolvedValue(new Uint8Array(100));
  registerFontHandlers(() => main as unknown as BrowserWindow);
});

describe("font IPC and worker boundaries",() => {
  it("denies library access from child frames or unrelated windows",async () => {
    await expect(invoke("fonts:list",{sender:main.webContents,senderFrame:{}})).rejects.toThrow(/unavailable/);
    await expect(invoke("fonts:remove",{sender:{},senderFrame:main.webContents.mainFrame},"font-test")).rejects.toThrow(/unavailable/);
    expect(mocks.list).not.toHaveBeenCalled();expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("validates requested characters before opening the file picker",async () => {
    await expect(invoke("fonts:import",event,"a".repeat(4097))).rejects.toThrow(/4096/);
    await expect(invoke("fonts:import",event,{})).rejects.toThrow(/4096/);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(await invoke("fonts:import",event,"Ω")).toBeNull();
  });
  it("keeps at most one font import active",async () => {
    let finish!: (value:unknown) => void;
    mocks.dialog.mockReturnValue(new Promise((resolve) => {finish=resolve;}));
    const first = invoke("fonts:import",event);
    await Promise.resolve();await Promise.resolve();
    await expect(invoke("fonts:import",event)).rejects.toThrow(/already/);
    finish({canceled:true,filePaths:[]});
    await expect(first).resolves.toBeNull();
  });
  it("validates worker results and terminates the processor after success",async () => {
    const result = runFontWorker(new Uint8Array(100),{id:"font-test",sourceName:"Test.ttf"});
    mocks.workers[0].emit("message",{font});
    await expect(result).resolves.toEqual(font);
    expect(mocks.workers[0].terminate).toHaveBeenCalled();
  });
  it("rejects premature worker exit without leaving the operation pending",async () => {
    const result = runFontWorker(new Uint8Array(100),{id:"font-test",sourceName:"Test.ttf"});
    mocks.workers[0].emit("exit",0);
    await expect(result).rejects.toThrow(/before returning/);
  });
});
