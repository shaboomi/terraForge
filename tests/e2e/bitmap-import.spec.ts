import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "playwright";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { validateBitmapAsset } from "../../src/types/bitmapValidation";
import { launchApp, closeApp, fixturePath, mockOpenDialog, mockSaveDialog } from "./helpers";
import type { BitmapAsset, BitmapImport, CanvasLayout } from "../../src/types";

const PREFIX = "terraforge-bitmap-e2e-";
let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;
let temporaryRoot: string;

const row = (name: string) => window.locator("span[title='Double-click to rename']")
  .filter({ hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
const allRows = () => window.locator("span[title='Double-click to rename']");
const dimension = (label: "W (mm)" | "H (mm)") => window.getByText(label, { exact: true }).locator("..").locator("input");

async function menu(channel: "menu:saveLayout" | "menu:openLayout") {
  const nativeWindow = await electronApp.browserWindow(window);
  try { await nativeWindow.evaluate((main, action) => main.webContents.send(action), channel); }
  finally { await nativeWindow.dispose(); }
}
async function importFile(filename: string, name: string) {
  await mockOpenDialog(electronApp, filename);
  await window.getByRole("button", { name: "Import", exact: true }).click();
  await expect(row(name)).toBeVisible();
}
async function saveScene(filename: string, expectedItems: number): Promise<CanvasLayout> {
  const target = path.join(temporaryRoot, filename);
  await mockSaveDialog(electronApp, target);
  await menu("menu:saveLayout");
  await expect.poll(() => {
    try { return (JSON.parse(readFileSync(target, "utf8")) as CanvasLayout).imports.length; }
    catch { return -1; }
  }).toBe(expectedItems);
  return JSON.parse(readFileSync(target, "utf8")) as CanvasLayout;
}
async function restart() {
  await closeApp(electronApp, userDataDir);
  ({ electronApp, window, userDataDir } = await launchApp());
}
async function openScene(filename: string) {
  await mockOpenDialog(electronApp, path.join(temporaryRoot, filename));
  await menu("menu:openLayout");
}
async function assetPixels(asset: BitmapAsset, positions: {x:number;y:number}[]) {
  return window.evaluate(async ({ encoded, positions }) => {
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    const image = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
    const canvas = new OffscreenCanvas(image.width, image.height);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);
    const samples = positions.map(({x,y}) => Array.from(context.getImageData(x,y,1,1).data));
    image.close();
    return samples;
  }, { encoded: asset.data, positions });
}


function pngWithCorruptPixelData(): BitmapAsset {
  const bytes = Buffer.from(readFileSync(fixturePath("bitmaps/transparent.png")));
  let offset = 8;
  let damaged = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      bytes.fill(0, offset + 8, offset + 8 + length);
      let crc = 0xffffffff;
      for (let index = offset + 4; index < offset + 8 + length; index++) {
        crc ^= bytes[index];
        for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
      bytes.writeUInt32BE((crc ^ 0xffffffff) >>> 0, offset + 8 + length);
      damaged = true;
    }
    offset += 12 + length;
  }
  if (!damaged) throw new Error("PNG fixture did not contain image data.");
  return { id: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png",
    data: bytes.toString("base64"), widthPx: 4, heightPx: 2 };
}

async function generateGcode(filename: string): Promise<string> {
  const target = path.join(temporaryRoot, filename);
  await window.getByRole("button", { name: "Generate G-code", exact: true }).click();
  await window.getByRole("tab", { name: /^output$/i }).click();
  await window.getByLabel("Save to computer", { exact: false }).check();
  await mockSaveDialog(electronApp, target);
  await window.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => existsSync(target), { timeout: 30000 }).toBe(true);
  return readFileSync(target, "utf8");
}

test.beforeEach(async () => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX));
  ({ electronApp, window, userDataDir } = await launchApp());
});
test.afterEach(async () => {
  await closeApp(electronApp, userDataDir);
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) {
    throw new Error("Refusing cleanup outside the bitmap test directory.");
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("PNG import preserves transparency, starts at 96 PPI and deduplicates embedded assets", async () => {
  const source = path.join(temporaryRoot, "ALPHA.PNG");
  copyFileSync(fixturePath("bitmaps/transparent.png"), source);
  await importFile(source, "ALPHA");
  await expect(window.getByRole("region", { name: "Bitmap properties" })).toContainText("4 × 2 pixels");
  await expect(window.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  const layout = await saveScene("alpha.tforge", 1);
  expect(layout.tfVersion).toBe(2);
  const item = layout.imports[0] as BitmapImport;
  expect(item).toMatchObject({ kind: "bitmap", svgWidth: 4, svgHeight: 2, opacity: 1 });
  expect(item.scale).toBeCloseTo(25.4 / 96);
  const asset = layout.assets![item.assetId];
  expect(asset).toMatchObject({ mimeType: "image/png", widthPx: 4, heightPx: 2 });
  expect(await assetPixels(asset, [{x:0,y:0},{x:1,y:0},{x:2,y:0}])).toEqual([
    [255,0,0,255], [0,0,0,0], [0,255,0,128],
  ]);
  await importFile(fixturePath("bitmaps/transparent.png"), "transparent");
  const repeated = await saveScene("deduplicated.tforge", 2);
  expect(Object.keys(repeated.assets!)).toHaveLength(1);
  expect((repeated.imports[1] as BitmapImport).assetId).toBe(item.assetId);
});

test("JPEG orientation is normalised before pixel dimensions and the saved PNG are exposed", async () => {
  await importFile(fixturePath("bitmaps/oriented.jpg"), "oriented");
  const layout = await saveScene("oriented.tforge", 1);
  const item = layout.imports[0] as BitmapImport;
  expect(item).toMatchObject({ kind: "bitmap", svgWidth: 8, svgHeight: 12 });
  const asset = layout.assets![item.assetId];
  expect(asset).toMatchObject({ widthPx: 8, heightPx: 12, mimeType: "image/png" });
  const pixels = await assetPixels(asset, [{x:4,y:2},{x:4,y:10}]);
  expect(pixels[0][0]).toBeGreaterThan(220);
  expect(pixels[0][2]).toBeLessThan(40);
  expect(pixels[1][2]).toBeGreaterThan(220);
  expect(pixels[1][0]).toBeLessThan(40);
});

test("bitmap transforms, opacity, copying, undo, visibility and groups survive portable save/open", async () => {
  const source = path.join(temporaryRoot, "portable.png");
  copyFileSync(fixturePath("bitmaps/transparent.png"), source);
  await importFile(source, "portable");
  await window.getByLabel("X (mm)", { exact: true }).fill("25");
  await window.getByLabel("Y (mm)", { exact: true }).fill("15");
  await dimension("W (mm)").fill("40");
  await window.getByLabel("Rotation (°)", { exact: true }).fill("30");
  const opacity = window.getByRole("slider", { name: "Opacity (%)" });
  for (let step = 0; step < 35; step++) await opacity.press("ArrowLeft");
  await row("portable").click();
  await window.keyboard.press(process.platform === "darwin" ? "Meta+c" : "Control+c");
  await window.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
  await expect(allRows()).toHaveCount(2);
  const copied = await saveScene("copied.tforge", 2);
  expect(Object.keys(copied.assets!)).toHaveLength(1);
  expect((copied.imports[1] as BitmapImport).assetId).toBe((copied.imports[0] as BitmapImport).assetId);
  await window.locator("body").click({position:{x:500,y:400}});
  await window.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(allRows()).toHaveCount(1);
  await row("portable").locator("..").locator("span[title='Toggle visibility']").click();
  expect((await saveScene("hidden.tforge", 1)).imports[0].visible).toBe(false);
  await row("portable").locator("..").locator("span[title='Toggle visibility']").click();
  await window.getByTitle("Add layer group", { exact: true }).click();
  const target = window.getByRole("button", {name:"Delete group",exact:true}).locator("..");
  const transfer = await window.evaluateHandle(() => new DataTransfer());
  const handle = row("portable").locator("..").locator("span[title='Drag to a group']");
  await handle.dispatchEvent("dragstart", {dataTransfer:transfer});
  await target.dispatchEvent("dragover", {dataTransfer:transfer});
  await target.dispatchEvent("drop", {dataTransfer:transfer});
  await transfer.dispose();
  const saved = await saveScene("portable.tforge", 1);
  const item = saved.imports[0] as BitmapImport;
  expect(item).toMatchObject({x:25,y:15,rotation:30,opacity:0.65,visible:true});
  expect(item.svgWidth * (item.scaleX ?? item.scale)).toBeCloseTo(40);
  expect(saved.layerGroups?.[0].importIds).toContain(item.id);
  rmSync(source);
  await restart();
  await openScene("portable.tforge");
  await expect(row("portable")).toBeVisible();
  await row("portable").click();
  await expect(window.getByRole("region", {name:"Bitmap properties"})).toContainText("4 × 2 pixels");
  await expect(window.getByRole("slider", {name:"Opacity (%)"})).toHaveValue("65");
  const reopened = await saveScene("portable-reopened.tforge", 1);
  expect(reopened.imports[0]).toEqual(item);
  expect(reopened.assets).toEqual(saved.assets);
  expect(reopened.layerGroups).toEqual(saved.layerGroups);
});

test("large bitmap imports fit the active page margins uniformly", async () => {
  await window.locator("select[title='Page template — adds a size guide overlay to the canvas']").selectOption("a6");
  await importFile(fixturePath("bitmaps/large.png"), "large");
  const layout = await saveScene("fitted.tforge", 1);
  const item = layout.imports[0] as BitmapImport;
  expect(item.svgWidth).toBe(2000);
  expect(item.svgHeight).toBe(1000);
  // A6 landscape is 148×105 mm, with the existing default 20 mm margin.
  expect(item.scale).toBeCloseTo(Math.min(108 / 2000, 65 / 1000));
  expect(item.x).toBe(20);
  expect(item.y).toBe(20);
});

test("mixed documents generate exactly the vector machine commands", async () => {
  await importFile(fixturePath("sample.svg"), "sample");
  const vectorOnly = await generateGcode("vectors.gcode");
  await importFile(fixturePath("bitmaps/transparent.png"), "transparent");
  await expect(window.getByRole("button", {name:"Generate G-code",exact:true})).toBeEnabled();
  const mixed = await generateGcode("mixed.gcode");
  const commands = (text: string) => text.split(/\r?\n/).filter((line) => /^[GMTFS]/.test(line));
  expect(commands(mixed)).toEqual(commands(vectorOnly));
});

test("corrupt, unsupported and oversized sources fail without adding artwork", async () => {
  const corrupt = path.join(temporaryRoot, "corrupt.png");
  writeFileSync(corrupt, Buffer.from([137,80,78,71]));
  await mockOpenDialog(electronApp, corrupt);
  await window.getByRole("button", {name:"Import",exact:true}).click();
  await expect(window.getByText("The selected file is not a valid PNG image.",{exact:true})).toBeVisible();
  const oversized = path.join(temporaryRoot, "oversized.png");
  copyFileSync(fixturePath("bitmaps/transparent.png"), oversized);
  truncateSync(oversized, 20 * 1024 * 1024 + 1);
  await mockOpenDialog(electronApp, oversized);
  await window.getByRole("button", {name:"Import",exact:true}).click();
  await expect(window.getByText(/20 MiB/).last()).toBeVisible();
  await expect(window.getByText(/Error invoking remote method/)).toHaveCount(0);
  const pixelBomb = path.join(temporaryRoot, "too-many-pixels.png");
  const bytes = readFileSync(fixturePath("bitmaps/transparent.png"));
  bytes.writeUInt32BE(8193,16);
  writeFileSync(pixelBomb,bytes);
  await mockOpenDialog(electronApp,pixelBomb);
  await window.getByRole("button", {name:"Import",exact:true}).click();
  await expect(window.getByText(/use at most 8192 pixels/)).toBeVisible();
  const unsupported = path.join(temporaryRoot,"unsupported.webp");
  writeFileSync(unsupported,"unsupported");
  await mockOpenDialog(electronApp,unsupported);
  await window.getByRole("button", {name:"Import",exact:true}).click();
  await expect(window.getByText("Unsupported import format",{exact:true})).toBeVisible();
  await expect(allRows()).toHaveCount(0);
  await expect(window.getByRole("button",{name:"Generate G-code",exact:true})).toBeDisabled();
});

test("version-1 vector layouts migrate without changing artwork", async () => {
  await importFile(fixturePath("sample.svg"), "sample");
  const saved = await saveScene("vector-v2.tforge", 1);
  const legacy = {...saved,tfVersion:1};
  delete legacy.assets;
  writeFileSync(path.join(temporaryRoot,"legacy.tforge"),JSON.stringify(legacy));
  await restart();
  await openScene("legacy.tforge");
  await expect(row("sample")).toBeVisible();
  const migrated = await saveScene("migrated.tforge",1);
  expect(migrated.tfVersion).toBe(2);
  expect(migrated.imports).toEqual(saved.imports);
  await expect(window.getByRole("button",{name:"Generate G-code",exact:true})).toBeEnabled();
});

test("invalid embedded bitmap layouts do not partially replace a document", async () => {
  await importFile(fixturePath("sample.svg"), "sample");
  const original=await saveScene("before-invalid.tforge",1);
  const invalid={tfVersion:2,savedAt:new Date().toISOString(),assets:{},imports:[{
    id:"missing-bitmap",name:"Missing asset",kind:"bitmap",assetId:"a".repeat(64),opacity:1,
    x:0,y:0,scale:1,rotation:0,visible:true,svgWidth:1,svgHeight:1,viewBoxX:0,viewBoxY:0,
  }]};
  writeFileSync(path.join(temporaryRoot,"invalid.tforge"),JSON.stringify(invalid));
  await openScene("invalid.tforge");
  await expect(window.getByText("Load layout failed",{exact:true})).toBeVisible();
  await expect(row("sample")).toBeVisible();
  expect((await saveScene("after-invalid.tforge",1)).imports).toEqual(original.imports);
  const corruptAsset = pngWithCorruptPixelData();
  // Correct chunk CRCs and frame dimensions pass structural checks; only
  // actual PNG decoding can detect this invalid compressed pixel stream.
  expect(() => validateBitmapAsset(corruptAsset)).not.toThrow();
  const corruptLayout = { ...invalid, assets: { [corruptAsset.id]: corruptAsset }, imports: [{
    ...invalid.imports[0], id: "damaged-bitmap", name: "Damaged bitmap",
    assetId: corruptAsset.id, svgWidth: 4, svgHeight: 2,
  }] };
  writeFileSync(path.join(temporaryRoot,"damaged-pixels.tforge"),JSON.stringify(corruptLayout));
  await openScene("damaged-pixels.tforge");
  await expect(window.getByText(/Layout contains a damaged PNG image/)).toBeVisible();
  await expect(row("sample")).toBeVisible();
  expect((await saveScene("after-damaged-pixels.tforge",1)).imports).toEqual(original.imports);
});

test("cancelling a pending bitmap read prevents a late import", async () => {
  const bytes=Array.from(readFileSync(fixturePath("bitmaps/transparent.png")));
  await electronApp.evaluate(({ipcMain,app},data) => {
    const state=app as typeof app & {bitmapReadFinished?:boolean};
    state.bitmapReadFinished=false;
    ipcMain.removeHandler("fs:readBitmapFile");
    ipcMain.handle("fs:readBitmapFile",async () => {
      await new Promise((resolve)=>setTimeout(resolve,500));
      state.bitmapReadFinished=true;
      return new Uint8Array(data);
    });
  },bytes);
  await mockOpenDialog(electronApp,fixturePath("bitmaps/transparent.png"));
  await window.getByRole("button",{name:"Import",exact:true}).click();
  await window.getByRole("button",{name:"Cancel task",exact:true}).click();
  await expect(window.getByText("Bitmap import cancelled",{exact:true})).toBeVisible();
  await expect.poll(()=>electronApp.evaluate(({app}) =>
    (app as typeof app & {bitmapReadFinished?:boolean}).bitmapReadFinished)).toBe(true);
  await window.evaluate(()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect(allRows()).toHaveCount(0);
  await expect(window.getByRole("button",{name:"Generate G-code",exact:true})).toBeDisabled();
});
