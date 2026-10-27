import { test, expect } from "@playwright/test";
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { mockOpenDialog, mockSaveDialog } from "./helpers";
import type { CanvasLayout, PluginRunRequest, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "..", "..");
const TEST_PREFIX = "terraforge-plugin-e2e-";
const NAME = "E2E Rectangle";
const ID = "org.terraforge.e2e.rectangle";
const RECTANGLE_RUN = `export default async function run(input, parameters, context) {
  context.progress(100);
  return { width: parameters.width ?? 40, height: 12, paths: [{
    points: [{x:0,y:0},{x:parameters.width ?? 40,y:0},
      {x:parameters.width ?? 40,y:12},{x:0,y:12}],
    closed: true, color: "#112233"
  }] };
}`;

function pluginSource(code = RECTANGLE_RUN, overrides: Record<string, unknown> = {}) {
  const metadata = {
    id: ID, name: NAME, version: "1.0.0", apiVersion: 1,
    description: "Test generator for discovery and document integration.",
    category: "generator", input: "none", outputs: ["vector"],
    controls: [{ key: "width", label: "Width (mm)", type: "number", default: 40,
      min: 1, max: 100, step: 1 }],
    ...overrides,
  };
  return `/* terraforge-plugin\n${JSON.stringify(metadata, null, 2)}\n*/\n${code}\n`;
}

function runRequest(runId: string): PluginRunRequest {
  return { runId, pluginId: ID,
    input: { kind: "none", page: { widthMM: 220, heightMM: 220 } },
    parameters: { width: 40 } };
}

let fixtureRoot: string;
let pluginDir: string;
let userDataDir: string;
let electronApp: ElectronApplication | undefined;
let window: Page;

async function launchPlugins(timeoutMs = 5000) {
  electronApp = await electron.launch({
    args: [`--user-data-dir=${userDataDir}`, path.join(ROOT, "out", "main", "index.js")],
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", TERRAFORGE_PLUGIN_DIR: pluginDir,
      TERRAFORGE_PLUGIN_TIMEOUT_MS: String(timeoutMs) },
  });
  window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.getByRole("combobox", { name: "Machine selector" }).waitFor();
}

async function stopApp() {
  if (electronApp) {
    const app = electronApp;
    electronApp = undefined;
    await app.close();
  }
}

async function chooseRectangle() {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  const dialog = window.getByRole("dialog", { name: "Plugins", exact: true });
  await dialog.getByRole("button", { name: NAME, exact: true }).click();
  if (await dialog.isVisible()) {
    await dialog.getByRole("button", { name: "Close Plugins" }).click();
  }
  return window.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
}

const artworkRow = () => window.locator("span[title='Double-click to rename']")
  .filter({ hasText: NAME });

// The runtime intentionally refuses globally disabled Chromium sandboxing.
// These checks require a host on which Electron's sandbox is available.
test.skip(process.platform === "linux", "Plugin runtime checks require an Electron sandbox-enabled desktop host.");

test.beforeEach(() => {
  fixtureRoot = mkdtempSync(path.join(tmpdir(), TEST_PREFIX));
  pluginDir = path.join(fixtureRoot, "plugins");
  userDataDir = path.join(fixtureRoot, "user-data");
  mkdirSync(pluginDir);
  mkdirSync(userDataDir);
});

test.afterEach(async () => {
  await stopApp();
  // Remove only the unique directory this test created, never a supplied path.
  const resolved = path.resolve(fixtureRoot);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) ||
      !path.basename(resolved).startsWith(TEST_PREFIX)) {
    throw new Error("Refusing cleanup outside the plugin test's temporary directory.");
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});

test("discovers a saved plugin after restart without evaluating its top-level code", async () => {
  await launchPlugins();
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(window.getByRole("button", { name: NAME, exact: true })).toHaveCount(0);
  await stopApp();

  writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"),
    pluginSource('throw new Error("TOP_LEVEL_SENTINEL");\n' + RECTANGLE_RUN));
  await launchPlugins();
  const panel = await chooseRectangle();
  await expect(panel.getByLabel("Width (mm)", { exact: true })).toBeVisible();
  await expect(window.getByText("TOP_LEVEL_SENTINEL", { exact: false })).toHaveCount(0);
  await panel.getByRole("button", { name: "Add artwork" }).click();
  await expect(panel.getByRole("alert")).toContainText("TOP_LEVEL_SENTINEL");
  await expect(artworkRow()).toHaveCount(0);
});

test("generator controls work on an empty canvas and output supports edit, undo, save and reopen", async () => {
  writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"), pluginSource());
  await launchPlugins();
  const panel = await chooseRectangle();
  await panel.getByLabel("Width (mm)", { exact: true }).fill("55");
  await panel.getByRole("button", { name: "Add artwork" }).click();
  await expect(artworkRow()).toHaveCount(1);
  await expect(window.getByRole("button", { name: "Generate G-code", exact: true })).toBeEnabled();

  const savedPath = path.join(fixtureRoot, "generated.tforge");
  await mockSaveDialog(electronApp!, savedPath);
  await dispatchMenuAction("menu:saveLayout");
  await expect.poll(() => {
    try { return JSON.parse(readFileSync(savedPath, "utf8")).imports.length; }
    catch { return 0; }
  }).toBe(1);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  expect(saved.imports[0]).toMatchObject({ name: NAME, svgWidth: 55, svgHeight: 12 });
  expect(saved.imports[0].paths).toHaveLength(1);

  await window.locator("body").click({ position: { x: 500, y: 400 } });
  await window.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await expect(artworkRow()).toHaveCount(0);
  await mockOpenDialog(electronApp!, savedPath);
  await dispatchMenuAction("menu:openLayout");
  await expect(artworkRow()).toHaveCount(1);
  await artworkRow().dblclick();
  const rename = window.locator("input:focus");
  await rename.fill("Edited generated artwork");
  await rename.press("Enter");
  await expect(window.locator("span[title='Double-click to rename']")
    .filter({ hasText: "Edited generated artwork" })).toHaveCount(1);
});

test("bad metadata and duplicate IDs are reported while a valid generator remains usable", async () => {
  writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"), pluginSource());
  writeFileSync(path.join(pluginDir, "broken.tf-plugin.js"), "/* terraforge-plugin\n{broken json}\n*/");
  const duplicate = pluginSource(RECTANGLE_RUN, { id: "org.terraforge.e2e.duplicate", name: "Duplicate" });
  writeFileSync(path.join(pluginDir, "duplicate-a.tf-plugin.js"), duplicate);
  writeFileSync(path.join(pluginDir, "duplicate-b.tf-plugin.js"), duplicate);
  await launchPlugins();
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  const manager = window.getByRole("dialog", { name: "Plugins", exact: true });
  await expect(manager.getByText("broken.tf-plugin.js", { exact: false })).toBeVisible();
  await expect(manager.getByText(/duplicate.*id|id.*duplicate/i).first()).toBeVisible();
  await expect(manager.getByRole("button", { name: NAME, exact: true })).toBeEnabled();
  const toggle = manager.getByRole("checkbox", { name: `Enable ${NAME}`, exact: true });
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await stopApp();
  await launchPlugins();
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await expect(window.getByRole("checkbox", { name: `Enable ${NAME}`, exact: true })).not.toBeChecked();
});

test("plugin execution has no app bridge, Node globals or usable network access", async () => {
  let networkRequests = 0;
  const server = createServer((_request, response) => {
    networkRequests += 1;
    response.writeHead(200, { "Access-Control-Allow-Origin": "*" });
    response.end("network should be blocked");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing probe port");
    const sentinelPath = path.join(fixtureRoot, "private-sentinel.txt");
    writeFileSync(sentinelPath, "plugin must not read this file");
    const fileUrl = JSON.stringify(pathToFileURL(sentinelPath).href);
    const probeCode = `export default async function run() {
      if (typeof process !== "undefined" || typeof require !== "undefined" ||
          typeof window !== "undefined" || typeof globalThis.terraForge !== "undefined") {
        throw new Error("Privileged global leaked into plugin");
      }
      let nodeImported = false;
      try { await import("node:fs"); nodeImported = true; } catch {}
      if (nodeImported) throw new Error("Node filesystem import was allowed");
      let networkAllowed = false;
      try { await fetch("http://127.0.0.1:${address.port}/probe"); networkAllowed = true; } catch {}
      if (networkAllowed) throw new Error("Network access was allowed");
      let fileAllowed = false;
      try { const response = await fetch(${fileUrl}); await response.text(); fileAllowed = true; } catch {}
      if (fileAllowed) throw new Error("Local file access was allowed");
      return {width:10,height:10,paths:[{points:[{x:0,y:0},{x:10,y:10}]}]};
    }`;
    writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"), pluginSource(probeCode));
    await launchPlugins();
    const result = await window.evaluate((request) => window.terraForge.plugins.run(request), runRequest("security-probe"));
    expect(result.paths).toHaveLength(1);
    expect(networkRequests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a tight loop can be cancelled while the UI remains responsive", async () => {
  writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"),
    pluginSource("export default function run(input, parameters, context) { context.progress(17); while (true) {} }"));
  await launchPlugins();
  const panel = await chooseRectangle();
  await panel.getByRole("button", { name: "Add artwork" }).click();
  await expect(panel.getByRole("button", { name: "Cancel plugin" })).toBeVisible();
  await expect(window.getByText("17%", { exact: true })).toBeVisible();
  await expect.poll(() => electronApp!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((candidate) => !candidate.isVisible()))).toBe(true);
  const preferences = await electronApp!.evaluate(({ BrowserWindow }) => {
    const host = BrowserWindow.getAllWindows().find((candidate) => !candidate.isVisible());
    if (!host) return null;
    const prefs = host.webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration, nodeIntegrationInWorker: prefs.nodeIntegrationInWorker };
  });
  expect(preferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false });
  expect(preferences?.nodeIntegrationInWorker).not.toBe(true);
  await panel.getByRole("button", { name: "Cancel plugin" }).click();
  await expect(panel.getByRole("button", { name: "Add artwork" })).toBeEnabled();
  await expect(artworkRow()).toHaveCount(0);
  await expect(window.getByRole("button", { name: "Plugins", exact: true })).toBeEnabled();
});

test("a tight loop reaches its deadline and leaves no hidden runtime or artwork", async () => {
  writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"),
    pluginSource("export default function run(input, parameters, context) { context.progress(17); while (true) {} }"));
  await launchPlugins(1500);
  const result = await window.evaluate(async (request) => {
    let entered = false;
    const unsubscribe = window.terraForge.tasks.onTaskUpdate((task) => {
      if (task.id === request.runId && task.progress === 17) entered = true;
    });
    try { await window.terraForge.plugins.run(request); return { error: "unexpected success", entered }; }
    catch (error) { return { error: String(error), entered }; }
    finally { unsubscribe(); }
  }, runRequest("deadline-probe"));
  expect(result.error).toMatch(/timed?\s*out|timeout|deadline|time limit/i);
  expect(result.entered).toBe(true);
  await expect(artworkRow()).toHaveCount(0);
  await expect.poll(() => electronApp!.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().filter((candidate) => !candidate.isVisible()).length)).toBe(0);
});




test("the example installer adds one usable grid without overwriting its file", async () => {
  await launchPlugins();
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  const manager = window.getByRole("dialog", { name: "Plugins", exact: true });
  await manager.getByRole("button", { name: "Add Example Generator" }).click();
  const example = manager.getByRole("button", { name: "Example Grid", exact: true });
  await expect(example).toHaveCount(1);
  const examplePath = path.join(pluginDir, "example-grid.tf-plugin.js");
  const firstSource = readFileSync(examplePath, "utf8") + "\n// user customisation must survive another example install\n";
  writeFileSync(examplePath, firstSource);
  await manager.getByRole("button", { name: "Add Example Generator" }).click();
  await expect(example).toHaveCount(1);
  expect(readFileSync(examplePath, "utf8")).toBe(firstSource);
  await example.click();
  const panel = window.getByRole("region", { name: "Plugin: Example Grid", exact: true });
  await expect(panel.getByLabel("Width", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "Add artwork" }).click();
  await expect(window.locator("span[title='Double-click to rename']")
    .filter({ hasText: "Example Grid" })).toHaveCount(1);
});

test("changed executable source is rejected until restart", async () => {
  const filename = path.join(pluginDir, "rectangle.tf-plugin.js");
  writeFileSync(filename, pluginSource());
  await launchPlugins();
  writeFileSync(filename, pluginSource(RECTANGLE_RUN + "\n// edited after discovery"));
  const rejected = await window.evaluate(async (request) => {
    try { await window.terraForge.plugins.run(request); return "unexpected success"; }
    catch (error) { return String(error); }
  }, runRequest("edited-before-restart"));
  expect(rejected).toMatch(/changed.*startup|restart/i);
  await stopApp();
  await launchPlugins();
  const result = await window.evaluate((request) =>
    window.terraForge.plugins.run(request), runRequest("edited-after-restart"));
  expect(result).toMatchObject({ width: 40, height: 12 });
});



async function dispatchMenuAction(channel: "menu:saveLayout" | "menu:openLayout"): Promise<void> {
  const nativeWindow = await electronApp!.browserWindow(window);
  try {
    await nativeWindow.evaluate((main, action) => main.webContents.send(action), channel);
  } finally {
    await nativeWindow.dispose();
  }
}
async function savePluginScene(filename: string): Promise<CanvasLayout> {
  const savedPath = path.join(fixtureRoot, filename);
  await mockSaveDialog(electronApp!, savedPath);
  await dispatchMenuAction("menu:saveLayout");
  await expect.poll(() => {
    try { return (JSON.parse(readFileSync(savedPath, "utf8")) as CanvasLayout).imports.length; }
    catch { return 0; }
  }).toBe(1);
  return JSON.parse(readFileSync(savedPath, "utf8")) as CanvasLayout;
}

function placement(item: SvgImport) {
  return { x: item.x, y: item.y, scale: item.scale, scaleX: item.scaleX,
    scaleY: item.scaleY, rotation: item.rotation, visible: item.visible };
}

test("generated artwork reopens its controls and updates in place after minimising, closing and reopening a layout", async () => {
  writeFileSync(path.join(pluginDir, "rectangle.tf-plugin.js"), pluginSource());
  await launchPlugins();
  const panel = await chooseRectangle();
  await panel.getByLabel("Width (mm)", { exact: true }).fill("55");
  await panel.getByRole("button", { name: "Add artwork", exact: true }).click();
  await expect(artworkRow()).toHaveCount(1);
  await window.getByLabel("X (mm)", { exact: true }).fill("25");
  await window.getByLabel("Y (mm)", { exact: true }).fill("15");
  await window.getByLabel("Scale", { exact: true }).fill("1.2");
  await window.getByLabel("Rotation (°)", { exact: true }).fill("20");
  const before = (await savePluginScene("before-update.tforge")).imports[0];

  await panel.getByRole("button", { name: "Minimise plugin panel" }).click();
  await expect(panel.getByLabel("Width (mm)", { exact: true })).toHaveCount(0);
  await expect(artworkRow()).toHaveCount(1);
  await panel.getByRole("button", { name: "Expand plugin panel" }).click();
  await expect(panel.getByLabel("Width (mm)", { exact: true })).toHaveValue("55");
  await panel.getByRole("button", { name: "Close plugin panel" }).click();
  await expect(panel).toHaveCount(0);
  await expect(artworkRow()).toHaveCount(1);

  await artworkRow().click();
  await window.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
  await expect(panel.getByLabel("Width (mm)", { exact: true })).toHaveValue("55");
  await panel.getByLabel("Width (mm)", { exact: true }).fill("60");
  await panel.getByRole("button", { name: "Update artwork", exact: true }).click();
  await expect(window.getByText(`${NAME}: artwork updated`, { exact: true })).toBeVisible();
  const updated = (await savePluginScene("after-update.tforge")).imports[0];
  expect(updated.id).toBe(before.id);
  expect(updated.svgWidth).toBe(60);
  expect(updated.pluginSource?.parameters.width).toBe(60);
  expect(placement(updated)).toEqual(placement(before));
  await expect(artworkRow()).toHaveCount(1);

  await window.locator("body").click({ position: { x: 500, y: 400 } });
  await window.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  const undone = (await savePluginScene("undone-update.tforge")).imports[0];
  expect(undone.id).toBe(before.id);
  expect(undone.svgWidth).toBe(55);
  expect(undone.pluginSource?.parameters.width).toBe(55);
  expect(placement(undone)).toEqual(placement(before));

  await stopApp();
  await launchPlugins();
  await mockOpenDialog(electronApp!, path.join(fixtureRoot, "undone-update.tforge"));
  await dispatchMenuAction("menu:openLayout");
  await expect(artworkRow()).toHaveCount(1);
  await artworkRow().click();
  await window.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
  const reopenedPanel = window.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
  await expect(reopenedPanel.getByLabel("Width (mm)", { exact: true })).toHaveValue("55");
  await expect(reopenedPanel.getByRole("button", { name: "Update artwork", exact: true })).toBeEnabled();
});
