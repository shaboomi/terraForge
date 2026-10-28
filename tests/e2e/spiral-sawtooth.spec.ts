import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { Resvg } from "@resvg/resvg-js";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mockOpenDialog, mockSaveDialog } from "./helpers";
import type { CanvasLayout, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "../..");
const PREFIX = "terraforge-spiral-e2e-";
const EXECUTABLE = process.env.TERRAFORGE_SPIRAL_EXECUTABLE;
const NAME = "Spiral Sawtooth";
let temporaryRoot: string;
let profile: string;
let pluginDir: string;
let application: ElectronApplication | undefined;
let page: Page;

function sourceLayout(): CanvasLayout {
  // Original, reproducible RGBA artwork: deliberately rectangular with empty margins.
  const bytes = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><path fill="#ff0000" d="M8 8H48V56H8Z"/><path fill="#0000ff" d="M48 8H88V56H48Z"/><circle cx="30" cy="30" r="10" fill="#0000ff"/><circle cx="68" cy="32" r="12" fill="#ff0000"/></svg>').render().asPng();
  const id = createHash("sha256").update(bytes).digest("hex");
  return { tfVersion: 2, savedAt: new Date().toISOString(), assets: {
    [id]: { id, mimeType: "image/png", widthPx: 96, heightPx: 64, data: Buffer.from(bytes).toString("base64") },
  }, imports: [{ id: "source-image", name: "Spiral source image", kind: "bitmap", assetId: id,
    svgWidth: 96, svgHeight: 64, viewBoxX: 0, viewBoxY: 0, x: 25, y: 25,
    scale: 1, scaleX: 1.1, scaleY: 0.75, rotation: 32, visible: true, opacity: 0.65 }],
    layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: [] },
      { id: "red", name: "Red", color: "#ff0000", importIds: [] },
      { id: "blue", name: "Blue", color: "#0000ff", importIds: [] }], activePenId: "white",
    pageTemplate: { sizeId: "a5", landscape: false, marginMM: 5, color: "#eeeeee" } };
}

async function launch() {
  application = await electron.launch({
    ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : {}),
    args: [`--user-data-dir=${profile}`, ...(EXECUTABLE ? [] : [path.join(ROOT, "out/main/index.js")])], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined,
      TERRAFORGE_PLUGIN_DIR: pluginDir },
  });
  const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
  expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
  expect(identity.packaged).toBe(!!EXECUTABLE);
  page = await application.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
async function close() {
  if (application) { const running = application; application = undefined; await running.close(); }
}
async function menu(channel: "menu:saveLayout" | "menu:openLayout") {
  const window = await application!.browserWindow(page);
  try { await window.evaluate((main, action) => main.webContents.send(action), channel); }
  finally { await window.dispose(); }
}
async function open(filename: string) { await mockOpenDialog(application!, filename); await menu("menu:openLayout"); }
async function save(filename: string, count: number): Promise<CanvasLayout> {
  const target = path.join(temporaryRoot, filename);
  await mockSaveDialog(application!, target); await menu("menu:saveLayout");
  await expect.poll(() => { try { return JSON.parse(readFileSync(target, "utf8")).imports.length; } catch { return -1; } }).toBe(count);
  return JSON.parse(readFileSync(target, "utf8"));
}
const rows = () => page.locator("span[title='Double-click to rename']").filter({ hasNotText: /^(White|Red|Blue)$/ });
const panel = () => page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
const control = (key: string) => panel().locator(`#plugin-control-${key}`);
async function choosePlugin() {
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bitmap to Vector", exact: true }).click();
  await page.getByRole("menuitem", { name: NAME, exact: true }).click();
  await expect(page.getByRole("menu", { name: "Plugins", exact: true })).toHaveCount(0);
}
async function setupScene() {
  const layoutPath = path.join(temporaryRoot, "source.tforge");
  writeFileSync(layoutPath, JSON.stringify(sourceLayout()));
  await launch(); await open(layoutPath);
  await expect(rows()).toHaveCount(1);
  await rows().filter({ hasText: /^Spiral source image$/ }).click();
  await choosePlugin();
}
async function preview(action = "Apply artwork") {
  await panel().getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel().getByRole("button", { name: action, exact: true })).toBeEnabled();
}
async function undo() {
  await page.locator("body").click({ position: { x: 470, y: 350 } });
  await page.keyboard.press("Control+z");
}
async function canvasChecksum() {
  return page.locator("canvas[data-testid='toolpath-canvas']").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      hash = Math.imul(hash ^ pixels[index], 16777619);
      hash = Math.imul(hash ^ pixels[index + 1], 16777619);
    }
    return hash >>> 0;
  });
}
function vectors(layout: CanvasLayout) { return layout.imports.filter(item => item.pluginSource) as SvgImport[]; }
function geometry(layout: CanvasLayout) { return vectors(layout).map(item => item.paths.map(p => p.d)); }
async function editResult(name: string) {
  await rows().filter({ hasText: name }).first().click();
  await page.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
}

test.skip(process.platform !== "win32", "The sandboxed plugin workflow is currently verified on Windows.");
test.beforeEach(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX)); profile = path.join(temporaryRoot, "user-data");
  pluginDir = EXECUTABLE ? path.join(profile, "plugins") : path.join(temporaryRoot, "plugins");
  mkdirSync(pluginDir, { recursive: true });
  copyFileSync(path.join(ROOT, "docs/examples/spiral-sawtooth.tf-plugin.js"), path.join(pluginDir, "spiral-sawtooth.tf-plugin.js"));
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Refusing cleanup outside the spiral test directory.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("actual spiral preserves a transformed bitmap, preview isolation, pens, grouped history and saved settings", async () => {
  test.setTimeout(120_000);
  await setupScene();
  await control("ringSpacing").fill("5");
  await control("centreX").fill("35");
  await control("centreY").fill("60");
  await control("colourMode").selectOption("pens");
  const originalPixels = await canvasChecksum();
  await preview();
  await expect.poll(canvasChecksum).not.toBe(originalPixels);
  await expect(rows()).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  const before = await save("preview-only.tforge", 1);
  expect(before.imports).toEqual(sourceLayout().imports);
  expect(before.assets).toEqual(sourceLayout().assets);
  await panel().getByRole("button", { name: "Minimise plugin panel" }).click();
  await expect(panel().getByRole("button", { name: "Expand plugin panel" })).toBeVisible();
  await panel().getByRole("button", { name: "Expand plugin panel" }).click();
  await expect(control("ringSpacing")).toHaveValue("5");
  await expect(panel().getByRole("button", { name: "Apply artwork", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("spiral-preview.png") });
  await panel().getByRole("button", { name: "Close plugin panel" }).click();
  await expect(panel()).toHaveCount(0);
  await expect(page.getByText("Plugin preview · Apply or cancel in Properties", { exact: true })).toHaveCount(0);
  expect((await save("closed-preview.tforge", 1)).imports).toEqual(before.imports);
  await choosePlugin();
  await expect(control("ringSpacing")).toHaveValue("5");
  await preview();
  await panel().getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect(rows()).toHaveCount(3);
  const applied = await save("applied.tforge", 3);
  expect(applied.imports[0]).toEqual(before.imports[0]);
  expect(applied.assets).toEqual(before.assets);
  expect(applied.activePenId).toBe("white");
  expect(applied.layerGroups!.map(pen => pen.id)).toEqual(["white", "red", "blue"]);
  expect(applied.layerGroups!.map(pen => pen.importIds.length)).toEqual([0, 1, 1]);
  const output = vectors(applied);
  expect(output).toHaveLength(2);
  expect(new Set(output.map(item => item.pluginSource!.outputGroupId)).size).toBe(1);
  for (const item of output) {
    expect(item).toMatchObject({ x: 25, y: 25, scaleX: 1.1, scaleY: 0.75, rotation: 32,
      svgWidth: 96, svgHeight: 64, viewBoxX: 0, viewBoxY: 0,
      pluginSource: { sourceId: "source-image", parameters: { ringSpacing: 5, centreX: 35, centreY: 60, colourMode: "pens" } } });
    const pen = applied.layerGroups!.find(group => group.importIds.includes(item.id))!;
    expect(item.paths.every(p => p.strokeColor === pen.color)).toBe(true);
    for (const generated of item.paths) {
      const coordinates = generated.d.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!.map(Number);
      for (let index = 0; index < coordinates.length; index += 2) {
        expect(coordinates[index]).toBeGreaterThanOrEqual(8 - 1e-7);
        expect(coordinates[index]).toBeLessThanOrEqual(88 + 1e-7);
        expect(coordinates[index + 1]).toBeGreaterThanOrEqual(8 - 1e-7);
        expect(coordinates[index + 1]).toBeLessThanOrEqual(56 + 1e-7);
      }
    }
  }
  await undo(); await expect(rows()).toHaveCount(1);
  await page.keyboard.press("Control+y"); await expect(rows()).toHaveCount(3);
  await panel().getByRole("button", { name: "Close plugin panel" }).click();
  await editResult(output[0].name);
  await expect(control("ringSpacing")).toHaveValue("5");
  await control("ringSpacing").fill("6");
  await preview("Update artwork");
  const duringUpdate = await save("update-preview.tforge", 3);
  expect(duringUpdate.imports).toEqual(applied.imports);
  await panel().getByRole("button", { name: "Update artwork", exact: true }).click();
  const updated = await save("updated.tforge", 3);
  expect(updated.imports[0]).toEqual(before.imports[0]);
  expect(updated.imports.map(item => item.id)).toEqual(applied.imports.map(item => item.id));
  expect(geometry(updated)).not.toEqual(geometry(applied));
  expect(vectors(updated).every(item => item.pluginSource!.parameters.ringSpacing === 6)).toBe(true);
  await undo();
  expect((await save("undone-update.tforge", 3)).imports).toEqual(applied.imports);
  await page.keyboard.press("Control+y");
  expect((await save("redone-update.tforge", 3)).imports).toEqual(updated.imports);
  await close(); await launch(); await open(path.join(temporaryRoot, "updated.tforge"));
  await expect(rows()).toHaveCount(3);
  await editResult(vectors(updated)[0].name);
  await expect(control("ringSpacing")).toHaveValue("6");
  await expect(control("centreX")).toHaveValue("35");
  await expect(control("colourMode")).toHaveValue("pens");
  await preview("Update artwork");
  await panel().getByRole("button", { name: "Update artwork", exact: true }).click();
  const reopened = await save("reopened.tforge", 3);
  expect(geometry(reopened)).toEqual(geometry(updated));
  expect(reopened.imports.map(item => item.id)).toEqual(updated.imports.map(item => item.id));
  expect(reopened.imports[0]).toEqual(updated.imports[0]);
  expect(vectors(reopened).map(item => item.pluginSource)).toEqual(vectors(updated).map(item => item.pluginSource));
  await page.screenshot({ path: test.info().outputPath("spiral-reopened.png") });
});

test("single-colour spiral keeps its selected colour instead of inheriting the active pen", async () => {
  await setupScene();
  await expect(control("colourMode")).toHaveValue("single");
  await control("colour").fill("#145678");
  await preview();
  await panel().getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect(rows()).toHaveCount(2);
  const saved = await save("single-colour.tforge", 2);
  expect(saved.imports[0]).toEqual(sourceLayout().imports[0]);
  expect(vectors(saved)[0].paths.every(p => p.strokeColor === "#145678")).toBe(true);
  expect(saved.layerGroups!.every(pen => !pen.importIds.includes(vectors(saved)[0].id))).toBe(true);
});
