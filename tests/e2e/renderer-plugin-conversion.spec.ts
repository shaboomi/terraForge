import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mockOpenDialog, mockSaveDialog } from "./helpers";
import type { CanvasLayout, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "../..");
const PREFIX = "terraforge-converted-renderer-";
const NAME = "Spirograph (example)";
let temporaryRoot: string, plugins: string, profile: string;
let application: ElectronApplication | undefined, page: Page;
const rows = () => page.locator("span[title='Double-click to rename']");
async function launch() {
  application = await electron.launch({ args: [`--user-data-dir=${profile}`, path.join(ROOT, "out/main/index.js")], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", TERRAFORGE_PLUGIN_DIR: plugins } });
  page = await application.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
  const actual = await application.evaluate(({ app }) => app.getPath("userData"));
  expect(path.resolve(actual).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
}
async function close() { if (application) { const current = application; application = undefined; await current.close(); } }
async function menu(channel: "menu:saveLayout" | "menu:openLayout") {
  await application!.evaluate(({ BrowserWindow }, event) => { BrowserWindow.getAllWindows()[0].webContents.send(event); }, channel);
}
async function save(filename: string, count: number): Promise<CanvasLayout> {
  const target = path.join(temporaryRoot, filename);
  await mockSaveDialog(application!, target); await menu("menu:saveLayout");
  await expect.poll(() => { try { return JSON.parse(readFileSync(target, "utf8")).imports.length; } catch { return -1; } }).toBe(count);
  return JSON.parse(readFileSync(target, "utf8"));
}
test.skip(process.platform !== "win32", "Converted plugin runtime is verified with the existing sandbox-enabled Windows host.");
test.beforeEach(async () => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX));
  plugins = path.join(temporaryRoot, "plugins"); profile = path.join(temporaryRoot, "profile");
  mkdirSync(plugins); mkdirSync(profile);
  execFileSync(process.execPath, [path.join(ROOT, "scripts/convert-renderer-plugin.mjs"),
    path.join(ROOT, "tests/fixtures/renderer-spirograph"), path.join(plugins, "spirograph.tf-plugin.js")]);
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Unsafe converted-plugin test cleanup path.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("converted upstream generator previews and applies labelled coloured layers atomically, then opens without its code", async () => {
  await launch();
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Generators", exact: true }).click();
  await page.getByRole("menuitem", { name: NAME, exact: true }).click();
  const panel = page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
  await expect(panel.getByRole("button", { name: "Add artwork", exact: true })).toHaveCount(0);
  await panel.getByLabel("Split across two pens", { exact: true }).check();
  await panel.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel.getByRole("button", { name: "Apply artwork", exact: true })).toBeEnabled();
  await expect(rows()).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeDisabled();
  await panel.getByRole("button", { name: "Apply artwork", exact: true }).click();
  await expect(rows()).toHaveCount(2);
  const saved = await save("converted.tforge", 2);
  const imports = saved.imports as SvgImport[];
  expect(imports.map(item => item.name)).toEqual(["Outer sweep", "Return sweep"]);
  expect(imports.flatMap(item => item.paths.map(p => p.strokeColor))).toEqual(["#1b6ac9", "#c9451b"]);
  expect(new Set(imports.map(item => item.pluginSource?.outputGroupId)).size).toBe(1);
  expect(imports.every(item => item.pluginSource?.parameters.twoPens === true)).toBe(true);
  expect(imports.every(item => /^[a-f0-9]{64}$/.test(item.pluginSource?.sourceFingerprint ?? ""))).toBe(true);
  await page.locator("body").click({ position: { x: 470, y: 350 } });
  await page.keyboard.press("Control+z"); await expect(rows()).toHaveCount(0);
  await page.keyboard.press("Control+y"); await expect(rows()).toHaveCount(2);
  await close();
  const installed = path.resolve(plugins, "spirograph.tf-plugin.js");
  if (path.dirname(installed) !== path.resolve(plugins)) throw new Error("Unsafe disposable plugin path.");
  rmSync(installed);
  await launch();
  await mockOpenDialog(application!, path.join(temporaryRoot, "converted.tforge")); await menu("menu:openLayout");
  await expect(rows()).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeEnabled();
  expect((await save("portable.tforge", 2)).imports).toEqual(saved.imports);
});
