import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const PREFIX = "terraforge-menu-e2e-";
let fixture: string;
let pluginDir: string;
let app: ElectronApplication;
let page: Page;

function install(name: string, input: "none" | "bitmap" | "vector", outputs: string[], category = "generator") {
  const id = name.toLowerCase().replace(/\s+/g, "-");
  const manifest = { id: `org.terraforge.menu.${id}`, name, version: "1.0.0", apiVersion: 1,
    description: "Cascading menu test fixture.", category, input, outputs };
  writeFileSync(path.join(pluginDir, `${id}.tf-plugin.js`), `/* terraforge-plugin\n${JSON.stringify(manifest)}\n*/\nexport default function run() { return { width: 10, height: 10, paths: [{points:[{x:0,y:0},{x:10,y:10}]}] }; }\n`);
}

async function launch() {
  app = await electron.launch({ args: [`--user-data-dir=${path.join(fixture, "profile")}`, path.join(ROOT, "out/main/index.js")], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined, TERRAFORGE_PLUGIN_DIR: pluginDir } });
  expect(await app.evaluate(({ app }) => app.getPath("userData"))).toBe(path.join(fixture, "profile"));
  page = await app.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
const trigger = () => page.getByRole("button", { name: "Plugins", exact: true });
const root = () => page.getByRole("menu", { name: "Plugins", exact: true });
const category = (name: string) => root().getByRole("menuitem", { name, exact: true });
const submenu = (name: string) => page.getByRole("menu", { name, exact: true });

test.beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), PREFIX));
  pluginDir = path.join(fixture, "plugins"); mkdirSync(pluginDir);
  copyFileSync(path.join(ROOT, "docs/examples/spiral-sawtooth.tf-plugin.js"), path.join(pluginDir, "spiral-sawtooth.tf-plugin.js"));
  install("Bitmap Tones", "bitmap", ["bitmap"], "bitmap-processor");
  install("Dual Output", "bitmap", ["bitmap", "vector"], "bitmap-processor");
  install("Reverse Vectors", "vector", ["vector"]);
  install("Rectangle Generator", "none", ["vector"]);
});
test.afterEach(async () => {
  if (app) await app.close();
  const resolved = path.resolve(fixture);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Refusing cleanup outside this test's temporary directory.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("mouse opens adjacent categories, crosses into submenu, selects Properties and closes outside", async () => {
  await launch(); await trigger().click();
  await expect(root()).toBeVisible();
  for (const name of ["Bitmap Filters", "Bitmap to Vector", "Generators", "Font Tools"]) await expect(category(name)).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(1);
  await page.screenshot({ path: path.join(ROOT, "docs/images/plugins-categories.png") });
  await category("Bitmap Filters").hover();
  await expect(submenu("Bitmap Filters")).toBeVisible();
  await expect(submenu("Bitmap Filters").getByRole("menuitem", { name: "Bitmap Tones", exact: true })).toBeVisible();
  await expect(submenu("Bitmap Filters").getByRole("menuitem", { name: "Dual Output", exact: true })).toBeVisible();
  await category("Bitmap to Vector").click();
  await expect(submenu("Bitmap Filters")).toHaveCount(0);
  const vector = submenu("Bitmap to Vector");
  await expect(vector).toBeVisible();
  await expect(category("Bitmap to Vector")).toHaveAttribute("data-state", "open");
  const parentBox = (await root().boundingBox())!;
  const childBox = (await vector.boundingBox())!;
  expect(childBox.x).toBeGreaterThanOrEqual(parentBox.x + parentBox.width - 4);
  const spiral = vector.getByRole("menuitem", { name: "Spiral Sawtooth", exact: true });
  await spiral.hover();
  // Stay inside beyond the pointer grace period to catch premature submenu closure.
  await expect(spiral).toBeVisible();
  await page.waitForTimeout(400);
  await expect(root()).toBeVisible(); await expect(vector).toBeVisible();
  await page.screenshot({ path: path.join(ROOT, "docs/images/plugins-bitmap-to-vector.png") });
  await spiral.click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  const panel = page.getByRole("region", { name: "Plugin: Spiral Sawtooth", exact: true });
  await expect(panel).toBeVisible();
  await expect(panel.getByText("Select one bitmap to use this plugin.", { exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
  await trigger().click(); await category("Generators").hover();
  await expect(submenu("Generators").getByText("Vector input", { exact: true })).toBeVisible();
  await page.mouse.click(500, 400);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger().click(); await category("Font Tools").hover();
  await expect(submenu("Font Tools").getByText(/no .*installed|none installed/i)).toBeVisible();
});

test("keyboard traverses categories and plugins, returns Left, selects Enter and closes Escape", async () => {
  await launch(); await trigger().focus(); await page.keyboard.press("Enter");
  await expect(category("Bitmap Filters")).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(category("Bitmap to Vector")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(submenu("Bitmap to Vector")).toBeVisible();
  await expect(submenu("Bitmap to Vector").getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(submenu("Bitmap to Vector").getByRole("menuitem").nth(1)).toBeFocused();
  await page.keyboard.press("ArrowUp"); await expect(submenu("Bitmap to Vector").getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("ArrowLeft"); await expect(category("Bitmap to Vector")).toBeFocused();
  await expect(submenu("Bitmap to Vector")).toHaveCount(0);
  await page.keyboard.press("ArrowDown"); await expect(category("Generators")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(submenu("Generators").getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Plugin: Rectangle Generator", exact: true })).toBeVisible();
  await trigger().focus(); await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Escape"); await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(trigger()).toBeFocused();
});

test("long lists scroll, font metadata takes precedence, collisions open left and fit resized windows", async () => {
  install("Font Bitmap", "bitmap", ["bitmap", "vector"], "font-tool");
  for (let index = 0; index < 45; index++) install(`Generator ${String(index).padStart(2, "0")}`, "none", ["vector"]);
  await launch();
  // Move the real toolbar trigger to the viewport edge to exercise Radix collision handling.
  await trigger().evaluate(button => { button.style.position = "fixed"; button.style.right = "12px"; button.style.top = "100px"; });
  await trigger().click(); await category("Generators").hover();
  const generators = submenu("Generators");
  await expect(generators).toBeVisible();
  expect(await generators.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  await generators.getByRole("menuitem", { name: "Reverse Vectors", exact: true }).scrollIntoViewIfNeeded();
  await expect(generators.getByRole("menuitem", { name: "Reverse Vectors", exact: true })).toBeInViewport();
  const parentBox = (await root().boundingBox())!;
  const box = (await generators.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(parentBox.x + 4);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await category("Bitmap Filters").hover();
  await expect(submenu("Bitmap Filters").getByRole("menuitem", { name: "Font Bitmap", exact: true })).toHaveCount(0);
  await category("Bitmap to Vector").hover();
  await expect(submenu("Bitmap to Vector").getByRole("menuitem", { name: "Font Bitmap", exact: true })).toHaveCount(0);
  await category("Font Tools").hover();
  await expect(submenu("Font Tools").getByRole("menuitem", { name: "Font Bitmap", exact: true })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setMinimumSize(400, 300); window.setSize(620, 460); });
  await category("Generators").hover();
  const resized = (await generators.boundingBox())!;
  expect(resized.x).toBeGreaterThanOrEqual(0);
  expect(resized.y + resized.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
});
