import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { CanvasLayout, SvgImport } from "../../src/types";
import { mockOpenDialog, mockSaveDialog } from "./helpers";

const ROOT = path.resolve(__dirname, "../..");
const PREFIX = "terraforge-preparation-e2e-";
const NAME = "Prepared Scanlines";
let temporary: string, profile: string, pluginDir: string;
let application: ElectronApplication | undefined;
let page: Page;
const rows = () => page.locator("span[title='Double-click to rename']").filter({ hasNotText: /^(White|Red)$/ });
const panel = () => page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });

function sourceLayout(): CanvasLayout {
  const bytes = readFileSync(path.join(ROOT, "tests/fixtures/bitmaps/transparent.png"));
  const id = createHash("sha256").update(bytes).digest("hex");
  return { tfVersion: 2, savedAt: new Date().toISOString(), assets: {
    [id]: { id, mimeType: "image/png", widthPx: 4, heightPx: 2, data: bytes.toString("base64") },
  }, imports: [{ id: "source-image", name: "Source image", kind: "bitmap", assetId: id,
    svgWidth: 4, svgHeight: 2, viewBoxX: 0, viewBoxY: 0, x: 25, y: 25,
    scale: 20, scaleX: 20, scaleY: 12, rotation: 32, visible: true, opacity: 1 }],
    layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: [] },
      { id: "red", name: "Red", color: "#ff0000", importIds: [] }], activePenId: "white",
    pageTemplate: { sizeId: "a5", landscape: false, marginMM: 5, color: "#222222" } };
}

async function launch() {
  application = await electron.launch({ args: [`--user-data-dir=${profile}`, path.join(ROOT, "out/main/index.js")], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined, TERRAFORGE_PLUGIN_DIR: pluginDir } });
  const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
  expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
  expect(identity.packaged).toBe(false);
  page = await application.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
async function close() { if (application) { const running = application; application = undefined; await running.close(); } }
async function dispatch(channel: "menu:saveLayout" | "menu:openLayout") {
  const window = await application!.browserWindow(page);
  try { await window.evaluate((main, action) => main.webContents.send(action), channel); }
  finally { await window.dispose(); }
}
async function open(filename: string) { await mockOpenDialog(application!, filename); await dispatch("menu:openLayout"); }
async function save(filename: string, count?: number): Promise<CanvasLayout> {
  const target = path.join(temporary, filename);
  await mockSaveDialog(application!, target); await dispatch("menu:saveLayout");
  await expect.poll(() => { try { const layout = JSON.parse(readFileSync(target, "utf8")); return count === undefined || layout.imports.length === count; } catch { return false; } }).toBe(true);
  return JSON.parse(readFileSync(target, "utf8"));
}
async function choose() {
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bitmap to Vector", exact: true }).click();
  await page.getByRole("menuitem", { name: NAME, exact: true }).click();
}
async function setup() {
  const file = path.join(temporary, "source.tforge"); writeFileSync(file, JSON.stringify(sourceLayout()));
  await launch(); await open(file); await expect(rows()).toHaveCount(1);
  await rows().filter({ hasText: /^Source image$/ }).click(); await choose();
  await panel().getByLabel("Row spacing", { exact: true }).fill("1");
  await panel().getByLabel("Minimum channel amount", { exact: true }).press("Home");
}
async function preview() {
  await panel().getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel().getByRole("button", { name: /^(Apply artwork|Update artwork)$/ })).toBeEnabled();
}

test.skip(process.platform !== "win32", "Requires the sandbox-enabled Windows desktop runtime.");
test.beforeEach(() => {
  temporary = mkdtempSync(path.join(tmpdir(), PREFIX)); profile = path.join(temporary, "profile"); pluginDir = path.join(temporary, "plugins");
  mkdirSync(pluginDir, { recursive: true });
  const original = readFileSync(path.join(ROOT, "docs/examples/prepared-scanlines.tf-plugin.js"), "utf8");
  // Run the distributed algorithm with additional fixture assertions at the worker boundary.
  const probe = original.replace("export default function run(input, parameters, context) {", `export default function run(input, parameters, context) {
    if (input.data.length !== 32 || input.data[7] !== 0 || input.data[4] !== 0) throw new Error('Original RGBA/alpha changed');
    if (input.prepared.widthPx !== 4 || input.prepared.heightPx !== 2) throw new Error('Prepared frame changed');
    if (input.prepared.tones[1] !== 255 || input.prepared.channels.some(channel => channel.data[1] !== 0)) throw new Error('Transparent pixels became marks');`);
  writeFileSync(path.join(pluginDir, "prepared-scanlines.tf-plugin.js"), probe);
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Unsafe preparation cleanup path.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("prepares original RGBA with cached decoding, manual preview, complete apply/undo and saved settings", async () => {
  await setup();
  await page.evaluate(() => {
    const original = globalThis.createImageBitmap;
    const state = window as unknown as { __pluginBitmapDecodes: number };
    state.__pluginBitmapDecodes = 0;
    globalThis.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      state.__pluginBitmapDecodes++; return original(...args);
    }) as typeof createImageBitmap;
  });
  const decodes = () => page.evaluate(() => (window as unknown as { __pluginBitmapDecodes: number }).__pluginBitmapDecodes);
  await preview();
  expect(await decodes()).toBe(1);
  await expect(rows()).toHaveCount(1);
  const previewOnly = await save("preview-only.tforge", 1);
  expect(previewOnly.imports).toEqual(sourceLayout().imports);
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  await panel().getByLabel("Minimum channel amount", { exact: true }).press("ArrowRight");
  await expect(panel().getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
  await preview(); expect(await decodes()).toBe(1);
  await page.screenshot({ path: test.info().outputPath("prepared-preview.png") });
  await panel().getByLabel("Preparation Gamma", { exact: true }).fill("1.3");
  await panel().getByLabel("Preparation Contrast", { exact: true }).fill("1.25");
  await panel().getByLabel("Preparation colour separation", { exact: true }).selectOption("cmyk");
  await expect(panel().getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
  await preview(); expect(await decodes()).toBe(1);
  await panel().getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect.poll(() => rows().count()).toBeGreaterThan(1);
  const applied = await save("applied.tforge");
  expect(applied.imports[0]).toEqual(previewOnly.imports[0]);
  expect(applied.assets).toEqual(previewOnly.assets);
  const outputs = applied.imports.slice(1) as SvgImport[];
  expect(new Set(outputs.map((item) => item.pluginSource?.outputGroupId)).size).toBe(1);
  expect(outputs.every((item) => item.pluginSource?.sourceId === "source-image")).toBe(true);
  for (const item of outputs) {
    expect(item).toMatchObject({ x: 25, y: 25, scaleX: 20, scaleY: 12, rotation: 32, svgWidth: 4, svgHeight: 2,
      pluginSource: { bitmapPreparation: { gamma: 1.3, contrast: 1.25, separation: "cmyk" } } });
    expect(item.paths.every((path) => /^#[0-9a-f]{6}$/i.test(path.sourceColor ?? ""))).toBe(true);
  }
  expect(applied.layerGroups!.every((group) => group.importIds.length === 0)).toBe(true);
  await page.locator("body").click({ position: { x: 470, y: 350 } }); await page.keyboard.press("Control+z");
  await expect(rows()).toHaveCount(1);
  await page.keyboard.press("Control+y"); await expect(rows()).toHaveCount(applied.imports.length);
  await close(); await launch(); await open(path.join(temporary, "applied.tforge"));
  await expect(rows()).toHaveCount(applied.imports.length);
  await rows().filter({ hasText: new RegExp(`^${outputs[0].name}$`) }).click();
  await page.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
  await expect(panel().getByLabel("Preparation Gamma", { exact: true })).toHaveValue("1.3");
  await expect(panel().getByLabel("Preparation Contrast", { exact: true })).toHaveValue("1.25");
  await expect(panel().getByLabel("Preparation colour separation", { exact: true })).toHaveValue("cmyk");
  await expect(panel().getByRole("button", { name: "Update artwork", exact: true })).toHaveCount(0);
  expect((await save("reopened.tforge", applied.imports.length)).imports).toEqual(applied.imports);
});

test("rejects invalid palette settings before execution and permits explicit correction", async () => {
  await setup();
  await panel().getByLabel("Preparation colour separation", { exact: true }).selectOption("palette");
  await panel().getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel().getByRole("alert")).toContainText("Choose at least one colour");
  await expect(rows()).toHaveCount(1);
  await panel().getByLabel("Preparation palette colours", { exact: true }).fill("#000000, #ff0000");
  await preview();
  await panel().getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect.poll(() => rows().count()).toBeGreaterThan(1);
  const saved = await save("palette.tforge");
  for (const item of saved.imports.slice(1)) expect(item.pluginSource?.bitmapPreparation).toMatchObject({ separation: "palette", palette: ["#000000", "#ff0000"] });
});
