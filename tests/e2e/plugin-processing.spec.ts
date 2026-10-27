import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mockOpenDialog, mockSaveDialog } from "./helpers";
import type { BitmapImport, CanvasLayout, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "../..");
const PREFIX = "terraforge-processing-e2e-";
const EXECUTABLE = process.env.TERRAFORGE_PROCESSING_EXECUTABLE;
const NAME = "Processing proof";
const ID = "org.terraforge.processing.proof";
let temporaryRoot: string;
let profile: string;
let pluginDir: string;
let application: ElectronApplication | undefined;
let page: Page;

const code = `export default async function run(input, parameters, context) {
  if (input.kind !== 'bitmap' || input.data.length !== 32) throw new Error('Expected RGBA input');
  if (input.data[7] !== 0 || input.data[4] !== 0) throw new Error('Transparent pixels must be zero');
  if (input.palette.length !== 2) throw new Error('Expected user pen palette');
  if (parameters.delay) await new Promise(resolve => setTimeout(resolve, 500));
  const pixels = new Uint8Array(input.data);
  for (let i=0;i<pixels.length;i+=4) if (pixels[i+3]) {
    pixels[i]=255-pixels[i]; pixels[i+1]=255-pixels[i+1]; pixels[i+2]=255-pixels[i+2];
  }
  context.progress(100);
  return { items: [
    {kind:'bitmap',name:'Inverted reference',width:input.width,height:input.height,widthPx:4,heightPx:2,data:pixels},
    {kind:'vector',name:'Two pen paths',width:input.width,height:input.height,paths:[
      {points:[{x:0.5,y:0.5},{x:3.5,y:0.5}],penId:input.palette[0].id},
      {points:[{x:0.5,y:1.5},{x:3.5,y:1.5}],penId:input.palette[1].id}
    ]}
  ]};
}`;

function installPlugin(source = code, overrides: Record<string, unknown> = {}) {
  const header = { id: ID, name: NAME, version: "1.0.0", apiVersion: 1,
    description: "Prove bitmap pixels, multi-pen vectors and portable grouped results.",
    category: "bitmap-processor", input: "bitmap", outputs: ["bitmap", "vector"],
    controls: [{ key: "delay", label: "Delay processing", type: "boolean", default: false }], ...overrides };
  writeFileSync(path.join(pluginDir, "processing.tf-plugin.js"), `/* terraforge-plugin\n${JSON.stringify(header)}\n*/\n${source}\n`);
}

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
  application = await electron.launch({
    ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : {}),
    args: [`--user-data-dir=${profile}`, ...(EXECUTABLE ? [] : [path.join(ROOT, "out/main/index.js")])], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined,
      TERRAFORGE_PLUGIN_DIR: pluginDir, TERRAFORGE_PLUGIN_TIMEOUT_MS: "3000" },
  });
  const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
  expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
  expect(identity.packaged).toBe(!!EXECUTABLE);
  page = await application.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
async function close() { if (application) { const running = application; application = undefined; await running.close(); } }
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
const rows = () => page.locator("span[title='Double-click to rename']").filter({ hasNotText: /^(White|Red)$/ });
async function choosePlugin() {
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Plugins", exact: true });
  await dialog.getByRole("button", { name: NAME, exact: true }).click();
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "Close Plugins" }).click();
  return page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
}
async function setupScene(layout = sourceLayout()) {
  const layoutPath = path.join(temporaryRoot, "source.tforge");
  writeFileSync(layoutPath, JSON.stringify(layout));
  await launch(); await open(layoutPath);
  await expect(rows()).toHaveCount(1);
  await rows().filter({ hasText: /^Source image$/ }).click();
  return choosePlugin();
}
async function undo() { await page.locator("body").click({ position: { x: 470, y: 350 } }); await page.keyboard.press("Control+z"); }
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

test.skip(process.platform !== "win32", "Processing runtime workflows currently verified on sandbox-enabled Windows.");
test.beforeEach(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX)); profile = path.join(temporaryRoot, "user-data");
  pluginDir = EXECUTABLE ? path.join(profile, "plugins") : path.join(temporaryRoot, "plugins");
  mkdirSync(pluginDir, { recursive: true }); installPlugin();
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Refusing cleanup outside the processing test directory.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("previews real RGBA processing, applies multi-pen results atomically and reopens saved controls", async () => {
  let panel = await setupScene();
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  const sourcePixels = await canvasChecksum();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toBeEnabled();
  await expect.poll(canvasChecksum).not.toBe(sourcePixels);
  await page.screenshot({ path: path.join(ROOT, ".cache/stage3-preview.png") });
  await expect(rows()).toHaveCount(1);
  const before = await save("preview-only.tforge", 1);
  expect(before.imports).toEqual(sourceLayout().imports);
  expect(Object.keys(before.assets!)).toHaveLength(1);
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect(rows()).toHaveCount(4);
  const applied = await save("applied.tforge", 4);
  expect(applied.imports[0]).toEqual(before.imports[0]);
  expect(applied.activePenId).toBe("white");
  const outputs = applied.imports.slice(1);
  expect(new Set(outputs.map(item => item.pluginSource?.outputGroupId)).size).toBe(1);
  expect(outputs.every(item => item.pluginSource?.sourceId === "source-image")).toBe(true);
  for (const item of outputs) expect(item).toMatchObject({ x: 25, y: 25, scaleX: 20, scaleY: 12, rotation: 32, svgWidth: 4, svgHeight: 2 });
  const vectors = outputs.filter(item => item.kind !== "bitmap") as SvgImport[];
  expect(vectors).toHaveLength(2);
  expect(applied.layerGroups!.map(pen => pen.importIds.length)).toEqual([1, 1]);
  expect(new Set(vectors.flatMap(item => item.paths.map(p => p.strokeColor)))).toEqual(new Set(["#ffffff", "#ff0000"]));
  expect(Object.keys(applied.assets!)).toHaveLength(2);
  await undo(); await expect(rows()).toHaveCount(1);
  await page.keyboard.press("Control+y"); await expect(rows()).toHaveCount(4);
  await close(); await launch(); await open(path.join(temporaryRoot, "applied.tforge"));
  panel = page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
  await expect(rows()).toHaveCount(4);
  const bitmap = applied.imports.find(item => item.kind === "bitmap" && item.pluginSource)! as BitmapImport;
  await rows().filter({ hasText: new RegExp(`^${bitmap.name}$`) }).click();
  await page.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
  await expect(panel.getByLabel("Delay processing")).not.toBeChecked();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Update artwork", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "Update artwork", exact: true }).click();
  const updated = await save("updated.tforge", 4);
  expect(updated.imports.map(item => item.id)).toEqual(applied.imports.map(item => item.id));
  await page.screenshot({ path: path.join(ROOT, ".cache/stage3-processing.png") });
});

test("invalidates previews and pending results when source placement or settings change", async () => {
  const panel = await setupScene();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toBeEnabled();
  await page.getByLabel("X (mm)", { exact: true }).fill("30");
  await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
  await panel.getByLabel("Delay processing").check();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Cancel plugin", exact: true })).toBeVisible();
  await page.getByLabel("Y (mm)", { exact: true }).fill("30");
  await expect(panel.getByRole("alert")).toContainText("document or page changed");
  await expect(rows()).toHaveCount(1);
  await save("stale.tforge", 1);
});

test("saved processor artwork remains usable when its plugin is removed", async () => {
  const panel = await setupScene();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
  const saved = await save("portable.tforge", 4);
  await close();
  const plugin = path.resolve(pluginDir, "processing.tf-plugin.js");
  if (!plugin.startsWith(path.resolve(temporaryRoot) + path.sep)) throw new Error("Unsafe plugin test path.");
  rmSync(plugin); await launch(); await open(path.join(temporaryRoot, "portable.tforge"));
  await expect(rows()).toHaveCount(4);
  await rows().filter({ hasText: /^Inverted reference$/ }).click();
  await expect(page.getByRole("button", { name: "Edit plugin settings" })).toBeDisabled();
  expect((await save("without-plugin.tforge", 4)).imports).toEqual(saved.imports);
});

test("host cancels a bitmap processor tight loop without changing artwork", async () => {
  installPlugin("export default function run() { while(true) {} }");
  const panel = await setupScene();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await panel.getByRole("button", { name: "Cancel plugin", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("cancelled");
  await expect(rows()).toHaveCount(1);
  await save("cancelled.tforge", 1);
});

test("processes a vector snapshot with viewBox offsets, curves and no controls", async () => {
  installPlugin(`export default function run(input) {
    return {width:input.width,height:input.height,paths:input.paths.map(path=>({
      ...path,points:[...path.points].reverse()
    }))};
  }`, { input: "vector", outputs: ["vector"], controls: [] });
  const layout = sourceLayout();
  layout.assets = {};
  layout.imports = [{ id: "source-vector", name: "Source image", kind: "vector", svgWidth: 20, svgHeight: 10,
    viewBoxX: 40, viewBoxY: 50, x: 25, y: 25, scale: 2, scaleX: 3, scaleY: 4, rotation: 32, visible: true,
    paths: [{ id: "curve", d: "M40 50 Q50 60 60 50", svgSource: '<path d="M40 50 Q50 60 60 50"/>', visible: true,
      sourceColor: "#ffffff", strokeColor: "#ffffff", outlineVisible: true }] }];
  layout.layerGroups![0].importIds = ["source-vector"];
  const panel = await setupScene(layout);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
  const saved = await save("processed-vector.tforge", 2);
  expect(saved.imports[0]).toMatchObject(layout.imports[0]);
  const generated = saved.imports[1] as SvgImport;
  expect(generated).toMatchObject({ x: 25, y: 25, scaleX: 3, scaleY: 4, rotation: 32, viewBoxX: 0, viewBoxY: 0,
    svgWidth: 20, svgHeight: 10, pluginSource: { sourceId: "source-vector" } });
  expect(generated.paths[0].d).toMatch(/^M20 0 L/);
  expect(generated.paths[0].d).toMatch(/L0 0$/);
  expect(saved.layerGroups![0].importIds).toContain(generated.id);
});
