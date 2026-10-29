import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";

const mocks = vi.hoisted(() => ({
  handlers:new Map<string,(event:unknown,...args:unknown[]) => unknown>(),
  dialog:vi.fn(),list:vi.fn(),save:vi.fn(),remove:vi.fn(),read:vi.fn(),workers:[] as { emit:(name:string,value:unknown) => void; terminate:ReturnType<typeof vi.fn>; workerData:unknown }[],
}));
vi.mock("electron",() => ({app:{getPath:() => "font-test-library"},dialog:{showOpenDialog:mocks.dialog},ipcMain:{handle:(name:string,handler:(event:unknown,...args:unknown[]) => unknown) => mocks.handlers.set(name,handler)}}));
vi.mock("node:worker_threads",() => { const Worker = class {
  callbacks = new Map<string,(value:unknown) => void>();
  terminate = vi.fn().mockResolvedValue(0);
  workerData:unknown;
  constructor(_path:unknown,options:{workerData:unknown}) { this.workerData=options.workerData; mocks.workers.push(this); }
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
  it("checks the mode before opening the picker and passes outline imports to the worker",async () => {
    await expect(invoke("fonts:import",event,"O","bad-mode")).rejects.toThrow(/font mode/);
    expect(mocks.dialog).not.toHaveBeenCalled();
    mocks.dialog.mockResolvedValue({canceled:false,filePaths:["C:/font-test/Test.otf"]});
    const result = invoke("fonts:import",event,"O","outline");
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    expect(mocks.workers[0].workerData).toMatchObject({identity:{characters:"O",mode:"outline"}});
    expect(mocks.dialog.mock.calls[0][1].title).toBe("Import standard outline font");
    const outline = {...font,mode:"outline"}; mocks.workers[0].emit("message",{font:outline});
    await expect(result).resolves.toEqual(outline);
    expect(mocks.save).toHaveBeenCalledWith(outline);
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
  it("denies saved-font conversion from child frames or unrelated windows",async () => {
    await expect(invoke("fonts:convertToCenterline",{sender:main.webContents,senderFrame:{}},"source-font")).rejects.toThrow(/unavailable/);
    await expect(invoke("fonts:convertToCenterline",{sender:{},senderFrame:main.webContents.mainFrame},"source-font")).rejects.toThrow(/unavailable/);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.workers).toHaveLength(0);
  });
  it("converts a saved native font off-thread under a separate library identity without reopening the source file",async () => {
    const source = {...font,id:"source-font",mode:"outline"};
    mocks.list.mockResolvedValue([source]);
    const conversion = invoke("fonts:convertToCenterline",event,source.id);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    const workerData = mocks.workers[0].workerData as {font:unknown;identity:{id:string}};
    expect(workerData.font).toEqual(source);
    expect(workerData.identity.id).not.toBe(source.id);
    const derived = {...font,id:workerData.identity.id,mode:"centerline",sourceFontId:source.id};
    mocks.workers[0].emit("message",{font:derived});
    await expect(conversion).resolves.toEqual(derived);
    expect(mocks.save).toHaveBeenCalledWith(derived);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.workers[0].terminate).toHaveBeenCalled();
    expect(source).toMatchObject({id:"source-font",mode:"outline"});
  });
  it("reuses a linked derived centreline font instead of processing it again",async () => {
    const source = {...font,id:"source-font",mode:"outline"};
    const derived = {...font,id:"derived-font",mode:"centerline",processingVersion:2,sourceFontId:source.id};
    mocks.list.mockResolvedValue([source,derived]);
    await expect(invoke("fonts:convertToCenterline",event,source.id)).resolves.toEqual(derived);
    expect(mocks.workers).toHaveLength(0);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects missing and non-outline saved fonts before creating a worker",async () => {
    await expect(invoke("fonts:convertToCenterline",event,"missing-font")).rejects.toThrow(/missing|not found|no longer/i);
    mocks.list.mockResolvedValue([font]);
    await expect(invoke("fonts:convertToCenterline",event,font.id)).rejects.toThrow(/outline|standard/i);
    expect(mocks.workers).toHaveLength(0);
  });
  it("shares the import lock with saved-font conversion and releases it after worker failure",async () => {
    const source = {...font,id:"source-font",mode:"outline"};
    mocks.list.mockResolvedValue([source]);
    const conversion = invoke("fonts:convertToCenterline",event,source.id);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    await expect(invoke("fonts:import",event)).rejects.toThrow(/already/);
    await expect(invoke("fonts:convertToCenterline",event,source.id)).rejects.toThrow(/already/);
    mocks.workers[0].emit("message",{error:"Glyph conversion failed."});
    await expect(conversion).rejects.toThrow("Glyph conversion failed.");
    expect(mocks.save).not.toHaveBeenCalled();
    await expect(invoke("fonts:import",event)).resolves.toBeNull();
  });
  it("validates saved-font identifiers before reading the library",async () => {
    for (const id of [undefined,{},"../outside-font",""]) {
      await expect(invoke("fonts:convertToCenterline",event,id)).rejects.toThrow(/identifier/);
    }
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.workers).toHaveLength(0);
  });
  it("rejects a worker result linked to another font before persisting it",async () => {
    const source = {...font,id:"source-font",mode:"outline"};
    mocks.list.mockResolvedValue([source]);
    const conversion = invoke("fonts:convertToCenterline",event,source.id);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    const workerData = mocks.workers[0].workerData as {identity:{id:string}};
    mocks.workers[0].emit("message",{font:{...font,id:workerData.identity.id,mode:"centerline",sourceFontId:"different-source"}});
    await expect(conversion).rejects.toThrow(/invalid centreline version/);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("regenerates a cached legacy conversion under its existing identity", async () => {
    const source = { ...font, id: "outline", mode: "outline" };
    const legacy = { ...font, id: "legacy-derived", mode: "centerline", sourceFontId: source.id };
    mocks.list.mockResolvedValue([source, legacy]);
    const result = invoke("fonts:convertToCenterline", event, source.id);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    expect(mocks.workers[0].workerData).toMatchObject({ font: source, identity: { id: legacy.id } });
    const updated = { ...legacy, processingVersion: 2 };
    mocks.workers[0].emit("message", { font: updated });
    await expect(result).resolves.toEqual(updated);
    expect(mocks.save).toHaveBeenCalledWith(updated);
  });
  it("smooths a saved centreline font without reopening its original file", async () => {
    mocks.list.mockResolvedValue([font]);
    const result = invoke("fonts:smoothCentrelines", event, font.id);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    expect(mocks.workers[0].workerData).toMatchObject({ font, smooth: true, identity: { id: font.id } });
    const updated = { ...font, mode: "centerline", processingVersion: 2 };
    mocks.workers[0].emit("message", { font: updated });
    await expect(result).resolves.toEqual(updated);
    expect(mocks.save).toHaveBeenCalledWith(updated);
    expect(mocks.dialog).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("regenerates smooth curves from the linked native outline when it is available", async () => {
    const source = { ...font, id: "outline", mode: "outline" };
    const selected = { ...font, sourceFontId: source.id };
    mocks.list.mockResolvedValue([selected, source]);
    const result = invoke("fonts:smoothCentrelines", event, selected.id);
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1));
    expect(mocks.workers[0].workerData).toMatchObject({ font: source, smooth: false, identity: { id: selected.id } });
    const updated = { ...selected, mode: "centerline", processingVersion: 2 };
    mocks.workers[0].emit("message", { font: updated });
    await expect(result).resolves.toEqual(updated);
  });
});
