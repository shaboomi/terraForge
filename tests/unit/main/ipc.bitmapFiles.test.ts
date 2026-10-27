import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import type { BrowserWindow } from "electron";
import { BITMAP_LIMITS } from "../../../src/types/bitmapValidation";

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, path: unknown) => Promise<unknown>>(),
}));
vi.mock("electron", () => ({
  ipcMain: { handle: (channel: string, callback: (event: unknown, path: unknown) => Promise<unknown>) => mocks.handlers.set(channel, callback) },
  dialog: {},
}));
import { registerFsIpcHandlers } from "../../../src/main/ipc/fs";

describe("bounded image and layout IPC", () => {
  let directory: string;
  let contents: { mainFrame: object };
  const invoke = (channel: string, event: unknown, path: unknown) => mocks.handlers.get(channel)!(event, path);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "terraforge-bitmap-ipc-"));
    contents = { mainFrame: {} };
    const main = { webContents: contents, isDestroyed: () => false } as unknown as BrowserWindow;
    registerFsIpcHandlers({ getMainWindow: () => main, loadConfigs: async () => [], saveConfigs: async () => {} });
  });
  afterEach(async () => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith("terraforge-bitmap-ipc-")) throw new Error("Invalid cleanup target");
    await rm(target, { recursive: true, force: true });
  });
  const sender = (contents: { mainFrame: object }) => ({ sender: contents, senderFrame: contents.mainFrame });
  it("reads exact binary data and UTF-8 layouts through the trusted main frame", async () => {
    const image = join(directory, "test.png");
    const layout = join(directory, "test.tforge");
    await writeFile(image, Buffer.from([137, 80, 0, 255]));
    await writeFile(layout, '{"name":"café"}');
    expect(await invoke("fs:readBitmapFile", sender(contents), image)).toEqual(Buffer.from([137, 80, 0, 255]));
    expect(await invoke("fs:readLayoutFile", sender(contents), layout)).toBe('{"name":"café"}');
  });
  it("rejects calls from another window and from child frames", async () => {
    await expect(invoke("fs:readBitmapFile", { sender: {}, senderFrame: {} }, "ignored")).rejects.toThrow(/denied/);
    await expect(invoke("fs:readLayoutFile", { sender: contents, senderFrame: {} }, "ignored")).rejects.toThrow(/denied/);
  });
  it("rejects a sparse source above the image byte cap", async () => {
    const file = join(directory, "large.png");
    const handle = await open(file, "w");
    try { await handle.truncate(BITMAP_LIMITS.sourceBytes + 1); } finally { await handle.close(); }
    await expect(invoke("fs:readBitmapFile", sender(contents), file)).rejects.toThrow(/20 MiB/);
  });
  it("rejects malformed UTF-8 instead of silently rewriting a layout", async () => {
    const file = join(directory, "bad.tforge");
    await writeFile(file, Buffer.from([0xff, 0xff]));
    await expect(invoke("fs:readLayoutFile", sender(contents), file)).rejects.toThrow();
  });
});
