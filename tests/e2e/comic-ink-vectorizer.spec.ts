import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { Resvg } from "@resvg/resvg-js";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mockOpenDialog, mockSaveDialog } from "./helpers";
import type { CanvasLayout, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "../.."), PREFIX = "terraforge-comic-e2e-", NAME = "Comic Ink Vectorizer";
const EXECUTABLE = process.env.TERRAFORGE_COMIC_EXECUTABLE;
let temporaryRoot: string, profile: string, pluginDir: string;
let application: ElectronApplication | undefined, page: Page;
function sourceLayout(): CanvasLayout {
  const bytes = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><path fill="#be4b32" fill-rule="evenodd" d="M8 8H44V56H8Z M20 22V40H32V22Z"/><path fill="#758ca0" d="M48 8H88V32H48Z"/><path fill="#252525" d="M48 36H88V56H48Z"/></svg>').render().asPng();
  const id = createHash("sha256").update(bytes).digest("hex");
  return { tfVersion: 2, savedAt: new Date().toISOString(), assets: {
    [id]: { id, mimeType: "image/png", widthPx: 96, heightPx: 64, data: Buffer.from(bytes).toString("base64") },
  }, imports: [{ id: "source-image", name: "Comic source image", kind: "bitmap", assetId: id,
    svgWidth: 96, svgHeight: 64, viewBoxX: 0, viewBoxY: 0, x: 25, y: 25,
    scale: 1, scaleX: 1.1, scaleY: 0.75, rotation: 32, visible: true, opacity: 0.65 }],
  layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: [] },
    { id: "black", name: "Black", color: "#000000", importIds: [] }], activePenId: "white",
  pageTemplate: { sizeId: "a5", landscape: false, marginMM: 5, color: "#eeeeee" } };
}
async function launch() {
  application = await electron.launch({ ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : {}),
    args: [`--user-data-dir=${profile}`, ...(EXECUTABLE ? [] : [path.join(ROOT, "out/main/index.js")])], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined, TERRAFORGE_PLUGIN_DIR: pluginDir } });
  const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
  expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
  expect(identity.packaged).toBe(!!EXECUTABLE);
  page = await application.firstWindow(); await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
async function close() { if (application) { const running = application; application = undefined; await running.close(); } }
async function menu(channel: "menu:saveLayout" | "menu:openLayout") {
  const window = await application!.browserWindow(page);
  try { await window.evaluate((main, action) => main.webContents.send(action), channel); } finally { await window.dispose(); }
}
async function open(filename: string) { await mockOpenDialog(application!, filename); await menu("menu:openLayout"); }
async function save(filename: string, count: number): Promise<CanvasLayout> {
  const target = path.join(temporaryRoot, filename);
  await mockSaveDialog(application!, target); await menu("menu:saveLayout");
  await expect.poll(() => { try { return JSON.parse(readFileSync(target, "utf8")).imports.length; } catch { return -1; } }).toBe(count);
  return JSON.parse(readFileSync(target, "utf8"));
}
const rows = () => page.locator("span[title='Double-click to rename']").filter({ hasNotText: /^(White|Black)$/ });
const panel = () => page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
const control = (key: string) => panel().locator(`#plugin-control-${key}`);
async function choosePlugin() {
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bitmap to Vector", exact: true }).click();
  await page.getByRole("menuitem", { name: NAME, exact: true }).click();
}
async function preview(action = "Apply artwork") {
  await panel().getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel().getByRole("button", { name: action, exact: true })).toBeEnabled();
}
async function undo() { await page.locator("body").click({ position: { x: 470, y: 350 } }); await page.keyboard.press("Control+z"); }
function vectors(layout: CanvasLayout) { return layout.imports.filter(i => i.pluginSource) as SvgImport[]; }
function geometry(layout: CanvasLayout) { return vectors(layout).map(item => item.paths.map(p => p.d)); }
async function edit(name: string) {
  await rows().filter({ hasText: name }).first().click();
  await page.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
}
async function canvasChecksum() {
  return page.locator("canvas[data-testid='toolpath-canvas']").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i += 4) { hash = Math.imul(hash ^ pixels[i], 16777619); hash = Math.imul(hash ^ pixels[i + 1], 16777619); }
    return hash >>> 0;
  });
}
test.skip(process.platform !== "win32", "The sandboxed workflow is currently verified on Windows.");
test.beforeEach(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX)); profile = path.join(temporaryRoot, "user-data");
  pluginDir = EXECUTABLE ? path.join(profile, "plugins") : path.join(temporaryRoot, "plugins");
  mkdirSync(pluginDir, { recursive: true });
  copyFileSync(path.join(ROOT, "docs/examples/comic-ink-vectorizer.tf-plugin.js"), path.join(pluginDir, "comic-ink-vectorizer.tf-plugin.js"));
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Refusing cleanup outside the comic test directory.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("comic preview, transformed separations, atomic apply/update history and portable regeneration", async () => {
  test.setTimeout(120000);
  const source = path.join(temporaryRoot, "source.tforge"); writeFileSync(source, JSON.stringify(sourceLayout()));
  await launch(); await open(source); await expect(rows()).toHaveCount(1);
  await rows().filter({ hasText: /^Comic source image$/ }).click(); await choosePlugin();
  await control("inkPen").selectOption("black");
  const initialPixels = await canvasChecksum();
  await preview(); await expect.poll(canvasChecksum).not.toBe(initialPixels);
  await expect(rows()).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  const before = await save("preview.tforge", 1);
  expect(before.imports).toEqual(sourceLayout().imports);
  await panel().getByRole("button", { name: "Minimise plugin panel" }).click();
  await panel().getByRole("button", { name: "Expand plugin panel" }).click();
  await expect(control("inkPen")).toHaveValue("black");
  await page.screenshot({ path: test.info().outputPath("comic-preview.png") });
  await panel().getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect.poll(() => rows().count()).toBeGreaterThan(4);
  const count = await rows().count(), applied = await save("applied.tforge", count), output = vectors(applied);
  expect(applied.imports[0]).toEqual(before.imports[0]); expect(applied.assets).toEqual(before.assets);
  expect(new Set(output.map(i => i.pluginSource!.outputGroupId)).size).toBe(1);
  expect(output.some(i => i.name.includes("Colour"))).toBe(true);
  for (const name of ["Black outlines", "Black shadows", "Black hatching"]) expect(output.some(i => i.name.startsWith(name))).toBe(true);
  for (const item of output) {
    expect(item).toMatchObject({ x: 25, y: 25, scaleX: 1.1, scaleY: 0.75, rotation: 32, svgWidth: 96, svgHeight: 64,
      viewBoxX: 0, viewBoxY: 0, pluginSource: { sourceId: "source-image", parameters: { inkPen: "black" }, bitmapPreparation: { gamma: 1 } } });
    expect(item.paths.every(p => !p.hasFill && p.d.startsWith("M"))).toBe(true);
    const assigned = applied.layerGroups!.find(g => g.importIds.includes(item.id));
    expect(assigned?.id).toBe(item.name.startsWith("Black") ? "black" : undefined);
    for (const p of item.paths) {
      const coords = p.d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
      for (let k = 0; k < coords.length; k += 2) {
        expect(coords[k]).toBeGreaterThanOrEqual(8); expect(coords[k]).toBeLessThanOrEqual(88);
        expect(coords[k + 1]).toBeGreaterThanOrEqual(8); expect(coords[k + 1]).toBeLessThanOrEqual(56);
      }
    }
  }
  await undo(); await expect(rows()).toHaveCount(1);
  await page.keyboard.press("Control+y"); await expect(rows()).toHaveCount(count);
  await panel().getByRole("button", { name: "Close plugin panel" }).click();
  await edit(output[0].name); await control("fillSpacing").fill("1.25"); await preview("Update artwork");
  expect((await save("during-update.tforge", count)).imports).toEqual(applied.imports);
  await panel().getByRole("button", { name: "Update artwork", exact: true }).click();
  const updated = await save("updated.tforge", count);
  expect(geometry(updated)).not.toEqual(geometry(applied));
  expect(updated.imports.map(i => i.id)).toEqual(applied.imports.map(i => i.id));
  await undo(); expect((await save("undo-update.tforge", count)).imports).toEqual(applied.imports);
  await page.keyboard.press("Control+y"); expect((await save("redo-update.tforge", count)).imports).toEqual(updated.imports);
  await close(); await launch(); await open(path.join(temporaryRoot, "updated.tforge"));
  await expect(rows()).toHaveCount(count); await edit(vectors(updated)[0].name);
  await expect(control("fillSpacing")).toHaveValue("1.25"); await expect(control("inkPen")).toHaveValue("black");
  await preview("Update artwork"); await panel().getByRole("button", { name: "Update artwork", exact: true }).click();
  const regenerated = await save("regenerated.tforge", count);
  expect(geometry(regenerated)).toEqual(geometry(updated));
  await page.screenshot({ path: test.info().outputPath("comic-reopened.png") });
  await close(); unlinkSync(path.join(pluginDir, "comic-ink-vectorizer.tf-plugin.js"));
  await launch(); await open(path.join(temporaryRoot, "regenerated.tforge")); await expect(rows()).toHaveCount(count);
  const portable = await save("without-plugin.tforge", count);
  expect(geometry(portable)).toEqual(geometry(regenerated)); expect(portable.assets).toEqual(before.assets);
});
