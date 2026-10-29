import { test, expect, type Locator } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { mockIpcInvoke, mockOpenDialog, mockSaveDialog } from "./helpers";
import type { CanvasLayout, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "../..");
const CACHE = path.join(ROOT, ".cache");
const EXECUTABLE = process.env.TERRAFORGE_SCULPTURAL_EXECUTABLE;
const names = [["flowing-ribbons", "Flowing Ribbons"], ["wave-volume", "Wave Volume"], ["organic-contours", "Organic Contours"]];
let directory: string, profile: string, pluginDirectory: string;
let application: ElectronApplication | undefined, page: Page;
const rows = (name: string) => page.locator("span[title='Double-click to rename']").filter({ hasText: new RegExp(`^${name}(?: — .*)?$`) });

async function launch() {
  application = await electron.launch({
    ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : {}),
    args: [`--user-data-dir=${profile}`, ...(EXECUTABLE ? [] : [path.join(ROOT, "out/main/index.js")])], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined, TERRAFORGE_PLUGIN_DIR: pluginDirectory },
    timeout: 30000,
  });
  const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
  expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
  expect(identity.packaged).toBe(!!EXECUTABLE);
  page = await application.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
async function close() { if (application) { const active = application; application = undefined; await active.close(); } }
async function menu(channel: "menu:saveLayout" | "menu:openLayout") {
  const window = await application!.browserWindow(page);
  try { await window.evaluate((main, action) => main.webContents.send(action), channel); }
  finally { await window.dispose(); }
}
async function open(filename: string) { await mockOpenDialog(application!, filename); await menu("menu:openLayout"); }
async function save(name: string, count: number): Promise<CanvasLayout> {
  const filename = path.join(directory, `${name}.tforge`);
  await mockSaveDialog(application!, filename); await menu("menu:saveLayout");
  await expect.poll(() => { try { return JSON.parse(readFileSync(filename, "utf8")).imports.length; } catch { return -1; } }).toBe(count);
  return JSON.parse(readFileSync(filename, "utf8"));
}
async function choose(name: string) {
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Generators", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
  return page.getByRole("region", { name: `Plugin: ${name}`, exact: true });
}
async function preview(panel: Locator) {
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("button", { name: /^(Apply artwork|Update artwork)$/ })).toBeEnabled({ timeout: 30000 });
}
async function undo() { await page.locator("body").click({ position: { x: 470, y: 350 } }); await page.keyboard.press("Control+z"); }
async function redo() { await page.locator("body").click({ position: { x: 470, y: 350 } }); await page.keyboard.press("Control+y"); }

test.skip(process.platform !== "win32", "Windows sandbox-enabled Electron workflow.");
test.beforeEach(() => {
  mkdirSync(CACHE, { recursive: true }); directory = mkdtempSync(path.join(CACHE, "sculptural-e2e-"));
  profile = path.join(directory, "profile"); pluginDirectory = EXECUTABLE ? path.join(profile, "plugins") : path.join(directory, "plugins");
  mkdirSync(pluginDirectory, { recursive: true });
  for (const [slug] of names) copyFileSync(path.join(ROOT, `docs/examples/${slug}.tf-plugin.js`), path.join(pluginDirectory, `${slug}.tf-plugin.js`));
  const blank: CanvasLayout = { tfVersion: 2, savedAt: new Date().toISOString(), imports: [],
    layerGroups: [{ id: "ink-c", name: "Blue ink", color: "#164970", importIds: [] }, { id: "ink-a", name: "Red ink", color: "#aa362c", importIds: [] }, { id: "ink-b", name: "Black ink", color: "#292b30", importIds: [] }],
    activePenId: "ink-b", pageTemplate: { sizeId: "a4", landscape: false, marginMM: 5, color: "#faf8f3" } };
  writeFileSync(path.join(directory, "blank.tforge"), JSON.stringify(blank));
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved).toLowerCase() !== CACHE.toLowerCase() || !path.basename(resolved).startsWith("sculptural-e2e-")) throw new Error("Refusing cleanup outside this test's isolated directory.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

for (const [slug, name] of names) {
  test(`${name}: cancel, preview isolation, atomic apply/update, pens, undo/redo and reopen`, async () => {
    test.setTimeout(150000);
    await launch(); await open(path.join(directory, "blank.tforge"));
    const entries = await page.evaluate(() => window.terraForge.plugins.list());
    for (const [id] of names) expect(entries.find(e => e.manifest?.id === `terraforge.${id}`)).toMatchObject({ enabled: true });
    const baseline = await save("loaded-blank", 0);
    const itemCount = slug === "organic-contours" ? 1 : 3;
    let panel = await choose(name);
    await expect(panel.getByLabel("Random seed", { exact: true })).toHaveValue("42");
    await expect(panel.getByRole("button", { name: "Add artwork", exact: true })).toHaveCount(0);
    await panel.getByLabel("Primary pen position (0 = stroke colour)", { exact: true }).fill("1");
    await panel.getByLabel("Add border", { exact: true }).check();
    await expect(panel.getByLabel("Border placement", { exact: true })).toHaveValue("artwork");
    await panel.getByLabel("Border gap from artwork", { exact: true }).fill("3");
    if (slug === "flowing-ribbons") {
      await panel.getByLabel("Pen assignment", { exact: true }).selectOption("ribbons");
    } else if (slug === "wave-volume") {
      await panel.getByLabel("Pen assignment", { exact: true }).selectOption("families");
      await panel.getByLabel("Lower surface pen position (0 = primary)", { exact: true }).fill("2");
      await panel.getByLabel("Connecting strand pen position (0 = primary)", { exact: true }).fill("3");
    }
    await panel.getByRole("button", { name: "Preview", exact: true }).click();
    await panel.getByRole("button", { name: "Cancel plugin", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Cancel plugin", exact: true })).toHaveCount(0);
    await expect(rows(name)).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
    await preview(panel);
    await expect(rows(name)).toHaveCount(0);
    expect((await save("preview-isolated", 0)).imports).toHaveLength(0);
    await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
    await panel.getByRole("button", { name: "Minimise plugin panel", exact: true }).click();
    await expect(panel.getByLabel("Random seed", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Expand plugin panel", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "Close plugin panel", exact: true }).click();
    panel = await choose(name);
    await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
    await preview(panel);
    await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
    await expect(rows(name)).toHaveCount(itemCount);
    const before = await save("applied", itemCount), item = before.imports[0] as SvgImport;
    expect(item).toMatchObject({ svgWidth: 180, svgHeight: 260, pluginSource: { pluginId: `terraforge.${slug}`, pluginVersion: "1.0.0", parameters: { randomSeed: 42, penIndex: 1, border: true, borderMode: "artwork", borderGap: 3 } } });
    expect(item.paths.at(-1)!.d.endsWith(" Z")).toBe(true);
    expect(new Set(before.imports.map(item => item.pluginSource!.outputGroupId)).size).toBe(1);
    expect(before.layerGroups!.map(pen => pen.id)).toEqual(baseline.layerGroups!.map(pen => pen.id));
    expect(before.activePenId).toBe("ink-b");
    expect(before.layerGroups!.map(pen => pen.importIds.length)).toEqual(slug === "organic-contours" ? [1, 0, 0] : [1, 1, 1]);
    if (slug === "organic-contours") expect(item.paths.every(p => p.strokeColor === baseline.layerGroups![0].color)).toBe(true);
    await undo(); await expect(rows(name)).toHaveCount(0); await redo(); await expect(rows(name)).toHaveCount(itemCount);
    await rows(name).first().click();
    await page.getByRole("button", { name: `Edit with ${name}`, exact: true }).click();
    panel = page.getByRole("region", { name: `Plugin: ${name}`, exact: true });
    await panel.getByLabel("Random seed", { exact: true }).fill("43");
    await panel.getByLabel("Border gap from artwork", { exact: true }).fill("7");
    await preview(panel);
    expect((await save("update-preview-isolated", itemCount)).imports).toEqual(before.imports);
    await panel.getByRole("button", { name: "Update artwork", exact: true }).click();
    const updatedLayout = await save("updated", itemCount), updated = updatedLayout.imports[0] as SvgImport;
    expect(updated.id).toBe(item.id); expect(updated.pluginSource!.parameters.randomSeed).toBe(43);
    expect(updated.pluginSource!.parameters.borderGap).toBe(7);
    expect(updated.paths).not.toEqual(item.paths);
    expect({ x: updated.x, y: updated.y, scale: updated.scale, rotation: updated.rotation }).toEqual({ x: item.x, y: item.y, scale: item.scale, rotation: item.rotation });
    await undo(); expect((await save("undo-update", itemCount)).imports).toEqual(before.imports);
    await redo(); expect((await save("redo-update", itemCount)).imports).toEqual(updatedLayout.imports);
    mkdirSync(path.join(ROOT, ".cache/sculptural-screenshots"), { recursive: true });
    await page.screenshot({ path: path.join(ROOT, `.cache/sculptural-screenshots/${slug}-${EXECUTABLE ? "packaged" : "development"}.png`) });
    await close(); await launch(); await open(path.join(directory, "updated.tforge"));
    await rows(name).first().click(); await page.getByRole("button", { name: `Edit with ${name}`, exact: true }).click();
    panel = page.getByRole("region", { name: `Plugin: ${name}`, exact: true });
    await expect(panel.getByLabel("Random seed", { exact: true })).toHaveValue("43");
    await expect(panel.getByLabel("Primary pen position (0 = stroke colour)", { exact: true })).toHaveValue("1");
    await expect(panel.getByLabel("Add border", { exact: true })).toBeChecked();
    await expect(panel.getByLabel("Border gap from artwork", { exact: true })).toHaveValue("7");
    await preview(panel); await panel.getByRole("button", { name: "Update artwork", exact: true }).click();
    const regenerated = await save("reopened-regenerated", itemCount);
    expect(regenerated.imports.map(item => (item as SvgImport).paths.map(p => p.d))).toEqual(updatedLayout.imports.map(item => (item as SvgImport).paths.map(p => p.d)));
  });
}

test("braid preset previews editable paths and parameter edits invalidate the pending preview", async () => {
  test.setTimeout(60000);
  await launch(); await open(path.join(directory, "blank.tforge"));
  const panel = await choose("Flowing Ribbons");
  await panel.getByLabel("Composition preset", { exact: true }).selectOption("braid");
  await panel.getByLabel("Crossweave amount (0 = off)", { exact: true }).fill("0");
  await preview(panel);
  await panel.getByLabel("Random seed", { exact: true }).fill("64");
  await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
  await preview(panel); await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
  const layout = await save("braid-preset", 1);
  expect(layout.imports[0].pluginSource!.parameters).toMatchObject({ preset: "braid", randomSeed: 64, crossweave: 0 });
  expect((layout.imports[0] as SvgImport).paths).toHaveLength(174);
  expect((layout.imports[0] as SvgImport).paths.every(p => !p.hasFill && p.strokeColor === "#183d53")).toBe(true);
});

test("author four reusable preset layouts from actual applied vector output", async () => {
  test.skip(process.env.TERRAFORGE_WRITE_SCULPTURAL_PRESETS !== "1", "Explicit authoring pass only; ordinary tests do not rewrite delivered layouts.");
  test.setTimeout(120000);
  const outputDirectory = path.join(ROOT, "docs/images/sculptural-generators");
  for (const presetName of ["woven-curtains", "braided-ribbons", "wave-volume", "organic-contours"]) {
    const preset = JSON.parse(readFileSync(path.join(outputDirectory, `${presetName}.json`), "utf8")) as { pluginId: string; parameters: Record<string, number | string | boolean> };
    const slug = preset.pluginId.replace("terraforge.", ""), name = names.find(value => value[0] === slug)![1];
    // Empty palette: the delivered scene does not introduce fictitious configured pen IDs.
    const blank: CanvasLayout = { tfVersion: 2, savedAt: new Date().toISOString(), imports: [], layerGroups: [], pageTemplate: { sizeId: "a4", landscape: false, marginMM: 5, color: "#faf8f3" } };
    const source = path.join(directory, "empty-palette.tforge"); writeFileSync(source, JSON.stringify(blank));
    await launch(); await open(source);
    const panel = await choose(name);
    for (const [key, value] of Object.entries(preset.parameters)) {
      const field = panel.locator(`#plugin-control-${key}`);
      const tag = await field.evaluate(el => ({ tag: el.tagName, type: (el as HTMLInputElement).type }));
      if (tag.tag === "SELECT") await field.selectOption(String(value));
      else if (typeof value === "boolean") await field.setChecked(value);
      else await field.fill(String(value));
    }
    await preview(panel); await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
    await panel.getByRole("button", { name: "Close plugin panel", exact: true }).click();
    await rows(name).click();
    // Display-only width: preserve the fine line art in the app's canvas.
    await page.getByRole("spinbutton", { name: "Stroke width value", exact: true }).fill("0.18");
    const layout = await save(presetName, 1), item = layout.imports[0] as SvgImport;
    expect(item.strokeWidthMM).toBe(0.18);
    expect(item.pluginSource!.parameters).toEqual(preset.parameters);
    expect(item.paths.every(p => p.hasFill === false && p.strokeColor === preset.parameters.colour)).toBe(true);
    copyFileSync(path.join(directory, `${presetName}.tforge`), path.join(outputDirectory, `${presetName}.tforge`));
    const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
    while (await dismiss.count()) await dismiss.first().click();
    await page.screenshot({ path: path.join(ROOT, `.cache/sculptural-screenshots/${presetName}-preset.png`) });
    await close();
  }
});

test("configured pen families preserve existing combined and per-group export without joining strands", async () => {
  test.setTimeout(90000);
  await launch(); await open(path.join(directory, "blank.tforge"));
  const baseline = await save("export-baseline", 0), panel = await choose("Wave Volume");
  await panel.getByLabel("Strand spacing (also surface grid)", { exact: true }).fill("4");
  await panel.getByLabel("Pen assignment", { exact: true }).selectOption("families");
  await panel.getByLabel("Primary pen position (0 = stroke colour)", { exact: true }).fill("1");
  await panel.getByLabel("Lower surface pen position (0 = primary)", { exact: true }).fill("2");
  await panel.getByLabel("Connecting strand pen position (0 = primary)", { exact: true }).fill("3");
  await preview(panel); await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
  const applied = await save("export-applied", 3);
  await panel.getByRole("button", { name: "Close plugin panel", exact: true }).click();
  await page.getByRole("button", { name: "Generate G-code", exact: true }).click();
  await page.getByRole("tab", { name: /^paths$/i }).click();
  await page.getByRole("checkbox", { name: "Optimise paths", exact: true }).check();
  await page.getByRole("checkbox", { name: "Join nearby paths", exact: true }).uncheck();
  await page.getByRole("tab", { name: /^output$/i }).click();
  await page.getByRole("checkbox", { name: "Save to computer", exact: true }).check();
  const output = path.join(directory, "wave-volume.gcode"); await mockSaveDialog(application!, output);
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => { try { return readFileSync(output, "utf8").includes("End of job"); } catch { return false; } }, { timeout: 30000 }).toBe(true);
  const gcode = readFileSync(output, "utf8");
  const colors = (value: string) => [...value.matchAll(/^;@tf .*color=([^\s]+)/gm)].map(match => decodeURIComponent(match[1]));
  expect(new Set(colors(gcode))).toEqual(new Set(baseline.layerGroups!.map(pen => pen.color)));
  expect(gcode.includes("; Joined   : no")).toBe(true);
  expect([...gcode.matchAll(/; Pen down/g)].length).toBe(applied.imports.reduce((n, item) => n + (item as SvgImport).paths.length, 0));
  const split = path.join(directory, "per-pen"); mkdirSync(split);
  await mockIpcInvoke(application!, "fs:chooseDirectory", split);
  await page.getByRole("button", { name: "Generate G-code", exact: true }).click();
  await page.getByRole("tab", { name: /^output$/i }).click();
  await page.getByRole("checkbox", { name: "Split output into separate files", exact: true }).check();
  await page.getByRole("radio", { name: "Export one file per group", exact: true }).check();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect.poll(() => readdirSync(split).filter(name => name.endsWith(".gcode")).length, { timeout: 30000 }).toBe(3);
  const fileColors = readdirSync(split).filter(name => name.endsWith(".gcode")).map(filename => {
    const distinct = [...new Set(colors(readFileSync(path.join(split, filename), "utf8")))];
    expect(distinct).toHaveLength(1); return distinct[0];
  });
  expect(new Set(fileColors)).toEqual(new Set(baseline.layerGroups!.map(pen => pen.color)));
});
