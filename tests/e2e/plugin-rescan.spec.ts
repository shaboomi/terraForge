import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { CanvasLayout } from "../../src/types";
import { mockOpenDialog, mockSaveDialog } from "./helpers";

const ROOT = path.resolve(__dirname, "..", "..");
const PREFIX = "terraforge-rescan-e2e-";
const ID = "test.rescan.rectangle";
const NAME = "Rescan Rectangle";
const rectangle = (width = 40) => `export default function run() {
  return { width:${width}, height:12, paths:[{points:[{x:0,y:0},{x:${width},y:12}]}] };
}`;
function source(code = rectangle(), overrides: Record<string, unknown> = {}) {
  return `/* terraforge-plugin\n${JSON.stringify({ id: ID, name: NAME, version: "1.0.0", apiVersion: 1,
    description: "Live discovery fixture", category: "generator", input: "none", outputs: ["vector"], ...overrides })}\n*/\n${code}\n`;
}

let folder: string;
let plugins: string;
let profile: string;
let app: ElectronApplication | undefined;
let window: Page;
const file = () => path.join(plugins, "rectangle.tf-plugin.js");
const row = () => window.locator("span[title='Double-click to rename']").filter({ hasText: NAME });
const panel = () => window.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });

async function launch() {
  app = await electron.launch({ args: [`--user-data-dir=${profile}`, path.join(ROOT, "out/main/index.js")], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", TERRAFORGE_PLUGIN_DIR: plugins, TERRAFORGE_PLUGIN_TIMEOUT_MS: "15000" } });
  window = await app.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("combobox", { name: "Machine selector" }).waitFor();
  const actualProfile = await app.evaluate(({ app }) => app.getPath("userData"));
  expect(path.resolve(actualProfile)).toBe(path.resolve(profile));
}
async function stop() {
  if (app) { const current = app; app = undefined; await current.close(); }
}
async function rescan() {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await window.getByRole("menuitem", { name: "Rescan Plugins", exact: true }).click();
  await expect(window.getByRole("menu", { name: "Plugins", exact: true })).toHaveCount(0);
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(window.getByRole("menuitem", { name: "Rescan Plugins", exact: true })).toBeEnabled();
  await window.keyboard.press("Escape");
}
async function choose() {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await window.getByRole("menuitem", { name: "Generators", exact: true }).click();
  await window.getByRole("menuitem", { name: NAME, exact: true }).click();
  await expect(panel()).toBeVisible();
}
async function manage() {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await window.getByRole("menuitem", { name: "Manage Plugins", exact: true }).click();
  return window.getByRole("dialog", { name: "Manage Plugins", exact: true });
}
async function dispatch(channel: "menu:saveLayout" | "menu:openLayout") {
  const handle = await app!.browserWindow(window);
  try { await handle.evaluate((main, action) => main.webContents.send(action), channel); }
  finally { await handle.dispose(); }
}
async function save(name: string) {
  const target = path.join(folder, name);
  await mockSaveDialog(app!, target);
  await dispatch("menu:saveLayout");
  await expect.poll(() => { try { return JSON.parse(readFileSync(target, "utf8")).imports.length; } catch { return -1; } }).toBe(1);
  return JSON.parse(readFileSync(target, "utf8")) as CanvasLayout;
}

test.skip(process.platform === "linux", "Requires Electron sandbox support.");
test.beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), PREFIX));
  plugins = path.join(folder, "plugins"); profile = path.join(folder, "profile");
  mkdirSync(plugins); mkdirSync(profile);
});
test.afterEach(async () => {
  await stop();
  const target = path.resolve(folder);
  if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith(PREFIX)) throw new Error("Unexpected cleanup path");
  rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("live rescan validates added files without evaluation and retains disabled choices through removal", async () => {
  await launch();
  writeFileSync(file(), source('throw new Error("RESCAN_MUST_NOT_EVALUATE");\n' + rectangle()));
  writeFileSync(path.join(plugins, "invalid.tf-plugin.js"), "/* terraforge-plugin\n{ invalid }\n*/");
  const duplicate = source(rectangle(), { id: "test.rescan.duplicate", name: "Duplicate" });
  writeFileSync(path.join(plugins, "duplicate-a.tf-plugin.js"), duplicate);
  writeFileSync(path.join(plugins, "duplicate-b.tf-plugin.js"), duplicate);
  await rescan();
  await choose();
  await expect(panel().getByRole("button", { name: "Add artwork", exact: true })).toBeEnabled();
  await expect(window.getByText("RESCAN_MUST_NOT_EVALUATE", { exact: false })).toHaveCount(0);
  await expect(row()).toHaveCount(0);
  const manager = await manage();
  await expect(manager.getByText("invalid.tf-plugin.js", { exact: true })).toBeVisible();
  await expect(manager.getByRole("alert").filter({ hasText: "Duplicate plugin ID" })).toHaveCount(2);
  const enable = manager.getByRole("checkbox", { name: `Enable ${NAME}`, exact: true });
  await enable.uncheck();
  await expect(enable).not.toBeChecked();
  rmSync(file());
  await manager.getByRole("button", { name: "Rescan Plugins", exact: true }).click();
  await expect(enable).toHaveCount(0);
  writeFileSync(file(), source());
  rmSync(path.join(plugins, "duplicate-b.tf-plugin.js"));
  rmSync(path.join(plugins, "invalid.tf-plugin.js"));
  await manager.getByRole("button", { name: "Rescan Plugins", exact: true }).click();
  await expect(enable).not.toBeChecked();
  await expect(manager.getByRole("alert")).toHaveCount(0);
  await expect(manager.getByRole("checkbox", { name: "Enable Duplicate", exact: true })).toBeChecked();
});

test("same-version source edits invalidate previews and preserve saved geometry until explicit regeneration", async () => {
  writeFileSync(file(), source());
  await launch();
  await choose();
  await panel().getByRole("button", { name: "Add artwork", exact: true }).click();
  await expect(row()).toHaveCount(1);
  const original = (await save("original.tforge")).imports[0];
  expect(original.pluginSource?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  await panel().getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel().getByRole("button", { name: "Apply artwork", exact: true })).toBeVisible();
  writeFileSync(file(), source(rectangle(60)));
  await rescan();
  await expect(panel().getByRole("button", { name: "Apply artwork", exact: true })).toHaveCount(0);
  const untouched = (await save("after-rescan.tforge")).imports[0];
  expect(untouched).toEqual(original);
  await panel().getByRole("button", { name: "Close plugin panel", exact: true }).click();
  await row().click();
  await window.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
  await expect(panel().getByRole("status")).toContainText("different plugin code");
  await panel().getByRole("button", { name: "Update artwork", exact: true }).click();
  await expect(window.getByText(`${NAME}: artwork updated`, { exact: true })).toBeVisible();
  const updated = (await save("updated.tforge")).imports[0];
  expect(updated.id).toBe(original.id);
  expect(updated.svgWidth).toBe(60);
  expect(updated.pluginSource?.sourceFingerprint).not.toBe(original.pluginSource?.sourceFingerprint);
  expect(updated.pluginSource?.pluginVersion).toBe(original.pluginSource?.pluginVersion);
  await window.locator("body").click({ position: { x: 500, y: 400 } });
  await window.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  const undone = (await save("undone.tforge")).imports[0];
  expect(undone).toEqual(original);
  await stop();
  writeFileSync(file(), source('throw new Error("OPEN_MUST_NOT_EVALUATE");\n' + rectangle(70)));
  await launch();
  await mockOpenDialog(app!, path.join(folder, "original.tforge"));
  await dispatch("menu:openLayout");
  await expect(row()).toHaveCount(1);
  await expect(window.getByText("OPEN_MUST_NOT_EVALUATE", { exact: false })).toHaveCount(0);
  expect((await save("reopened.tforge")).imports[0]).toEqual(original);
});

test("rescan cancels an active tight loop, destroys the runtime and permits a fresh manual run", async () => {
  writeFileSync(file(), source("export default function run(i,p,c) { c.progress(17); while (true) {} }"));
  await launch();
  await choose();
  await panel().getByRole("button", { name: "Add artwork", exact: true }).click();
  await expect(window.getByText("17%", { exact: true })).toBeVisible();
  await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => !win.isVisible()).length)).toBe(1);
  writeFileSync(file(), source(rectangle(55)));
  await rescan();
  await expect(panel().getByRole("button", { name: "Cancel plugin", exact: true })).toHaveCount(0);
  await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(win => !win.isVisible()).length)).toBe(0);
  await expect(row()).toHaveCount(0);
  await panel().getByRole("button", { name: "Add artwork", exact: true }).click();
  await expect(row()).toHaveCount(1);
  expect((await save("after-cancel.tforge")).imports[0].svgWidth).toBe(55);
});
