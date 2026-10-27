/**
 * Smoke-test the unpacked Windows application without touching a real profile.
 * Run after packaging: node --experimental-strip-types scripts/plugin-package-smoke.ts
 */
import { _electron as electron } from "playwright";
import type { ElectronApplication, Page } from "playwright";
import { expect } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasLayout } from "../src/types/index.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXECUTABLE = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(ROOT, "release", "win-unpacked", "terraForge.exe");
const TEMP_PREFIX = "terraforge-plugin-package-smoke-";

function comparable(value: string): string {
  return path.resolve(value).toLowerCase();
}

function cleanupTemporaryRoot(directory: string): void {
  const resolved = path.resolve(directory);
  if (comparable(path.dirname(resolved)) !== comparable(tmpdir()) ||
      !path.basename(resolved).startsWith(TEMP_PREFIX)) {
    throw new Error("Refusing to remove a path outside this smoke test's temporary root.");
  }
  rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
}

async function main(): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("This packaged-application smoke test supports Windows only.");
  }
  if (!existsSync(EXECUTABLE)) {
    throw new Error(`Packaged app missing at ${EXECUTABLE}. Build the Windows directory package first, or provide its executable path as the first argument.`);
  }
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), TEMP_PREFIX));
  const profileDirectory = path.join(temporaryRoot, "user-data");
  const ignoredOverride = path.join(temporaryRoot, "override-must-not-be-used");
  const layoutFile = path.join(temporaryRoot, "generated.tforge");
  const screenshotFile = path.join(ROOT, ".cache", "plugin-stage1.png");
  mkdirSync(profileDirectory);
  let application: ElectronApplication | undefined;
  let success: Record<string, unknown> | undefined;

  const close = async () => {
    if (application) {
      const active = application;
      application = undefined;
      await active.close();
    }
  };
  const launch = async (): Promise<{ page: Page; version: string; electronVersion: string }> => {
    application = await electron.launch({
      executablePath: EXECUTABLE,
      args: [`--user-data-dir=${profileDirectory}`],
      cwd: ROOT,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined,
        TERRAFORGE_PLUGIN_DIR: ignoredOverride, TERRAFORGE_PLUGIN_TIMEOUT_MS: "100" },
      timeout: 30000,
    });
    // Check the actual Electron path before installing plugins, mocking dialogs,
    // generating artwork or otherwise modifying application state.
    const identity = await application.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      userData: app.getPath("userData"),
      version: app.getVersion(),
      electronVersion: process.versions.electron,
    }));
    if (!identity.packaged) throw new Error("Smoke test launched a development app instead of the packaged executable.");
    if (comparable(identity.userData) !== comparable(profileDirectory)) {
      throw new Error("Smoke test refused to act because Electron did not use the isolated temporary profile.");
    }
    const page = await application.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await page.getByRole("combobox", { name: "Machine selector" }).waitFor({ timeout: 15000 });
    return { page, version: identity.version, electronVersion: identity.electronVersion };
  };

  const dispatchMenuAction = async (page: Page, channel: "menu:saveLayout" | "menu:openLayout") => {
    const nativeWindow = await application!.browserWindow(page);
    try { await nativeWindow.evaluate((main, action) => main.webContents.send(action), channel); }
    finally { await nativeWindow.dispose(); }
  };

  try {
    const first = await launch();
    const page = first.page;
    await page.getByRole("button", { name: "Plugins", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "Plugins", exact: true });
    await manager.getByRole("button", { name: "Add Example Generator" }).click();
    await manager.getByRole("button", { name: "Example Grid", exact: true }).click();
    const panel = page.getByRole("region", { name: "Plugin: Example Grid", exact: true });
    await panel.getByLabel("Width", { exact: true }).fill("50");
    await panel.getByLabel("Height", { exact: true }).fill("40");
    await panel.getByLabel("Spacing", { exact: true }).fill("10");
    await panel.getByLabel("Border", { exact: true }).check();
    await panel.getByRole("button", { name: "Add artwork", exact: true }).click();
    await expect(page.locator("span[title='Double-click to rename']")
      .filter({ hasText: "Example Grid" })).toHaveCount(1, { timeout: 35000 });
    await expect(page.getByRole("button", { name: "Generate G-code", exact: true })).toBeEnabled();

    await application!.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    }, layoutFile);
    await dispatchMenuAction(page, "menu:saveLayout");
    await expect.poll(() => {
      try { return (JSON.parse(readFileSync(layoutFile, "utf8")) as CanvasLayout).imports.length; }
      catch { return 0; }
    }, { timeout: 10000 }).toBe(1);
    const layout = JSON.parse(readFileSync(layoutFile, "utf8")) as CanvasLayout;
    expect(layout.imports[0]).toMatchObject({
      name: "Example Grid", svgWidth: 50, svgHeight: 40,
      pluginSource: { pluginId: "terraforge.example-grid", pluginVersion: "1.0.0",
        parameters: { width: 50, height: 40, spacing: 10, border: true } },
    });
    expect(layout.imports[0].paths).toHaveLength(8);
    const original = layout.imports[0];
    const originalPlacement = { x: original.x, y: original.y, scale: original.scale,
      scaleX: original.scaleX, scaleY: original.scaleY, rotation: original.rotation };
    await panel.getByRole("button", { name: "Minimise plugin panel" }).click();
    await expect(panel.getByLabel("Width", { exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Expand plugin panel" }).click();
    await expect(panel.getByLabel("Width", { exact: true })).toHaveValue("50");
    await panel.getByRole("button", { name: "Close plugin panel" }).click();
    await expect(panel).toHaveCount(0);
    const generated = page.locator("span[title='Double-click to rename']").filter({ hasText: "Example Grid" });
    await expect(generated).toHaveCount(1);
    await generated.click();
    await page.getByRole("button", { name: "Edit with Example Grid", exact: true }).click();
    await expect(panel.getByLabel("Width", { exact: true })).toHaveValue("50");
    await panel.getByLabel("Width", { exact: true }).fill("60");
    await panel.getByRole("button", { name: "Update artwork", exact: true }).click();
    await expect(page.getByText("Example Grid: artwork updated", { exact: true })).toBeVisible();
    const updatedFile = path.join(temporaryRoot, "updated.tforge");
    const saveScene = async (filename: string): Promise<CanvasLayout> => {
      await application!.evaluate(({ dialog }, target) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      }, filename);
      await dispatchMenuAction(page, "menu:saveLayout");
      await expect.poll(() => {
        try { return (JSON.parse(readFileSync(filename, "utf8")) as CanvasLayout).imports.length; }
        catch { return 0; }
      }).toBe(1);
      return JSON.parse(readFileSync(filename, "utf8")) as CanvasLayout;
    };
    const updated = (await saveScene(updatedFile)).imports[0];
    expect(updated.id).toBe(original.id);
    expect(updated.svgWidth).toBe(60);
    expect(updated.pluginSource?.parameters.width).toBe(60);
    expect({ x: updated.x, y: updated.y, scale: updated.scale, scaleX: updated.scaleX,
      scaleY: updated.scaleY, rotation: updated.rotation }).toEqual(originalPlacement);
    await expect(generated).toHaveCount(1);
    await page.locator("body").click({ position: { x: 500, y: 400 } });
    await page.keyboard.press("Control+z");
    const undoneFile = path.join(temporaryRoot, "undone.tforge");
    const undone = (await saveScene(undoneFile)).imports[0];
    expect(undone.id).toBe(original.id);
    expect(undone.svgWidth).toBe(50);
    expect(undone.pluginSource?.parameters.width).toBe(50);
    expect(undone.paths).toHaveLength(8);
    expect({ x: undone.x, y: undone.y, scale: undone.scale, scaleX: undone.scaleX,
      scaleY: undone.scaleY, rotation: undone.rotation }).toEqual(originalPlacement);
    expect(existsSync(path.join(profileDirectory, "plugins", "example-grid.tf-plugin.js"))).toBe(true);
    expect(existsSync(path.join(profileDirectory, "plugins-dev"))).toBe(false);
    expect(existsSync(ignoredOverride)).toBe(false);

    // A known 250 ms computation proves the packaged runtime ignores the
    // development-only 100 ms timeout override, beyond merely using the right folder.
    const probeId = "terraforge.package-timeout-probe";
    const probeHeader = { id: probeId, name: "Packaged timeout probe", version: "1.0.0",
      apiVersion: 1, description: "Temporary packaged-build deadline check.",
      category: "generator", input: "none", outputs: ["vector"] };
    const probeSource = "/* terraforge-plugin\n" + JSON.stringify(probeHeader) + "\n*/\n" +
      "export default async function run() { await new Promise(resolve => setTimeout(resolve, 250)); " +
      "return {width:1,height:1,paths:[{points:[{x:0,y:0},{x:1,y:1}]}]}; }\n";
    writeFileSync(path.join(profileDirectory, "plugins", "timeout-probe.tf-plugin.js"), probeSource);
    await close();

    const restarted = await launch();
    const entries = await restarted.page.evaluate(() => window.terraForge.plugins.list());
    const example = entries.find((entry) => entry.manifest?.id === "terraforge.example-grid");
    expect(example).toMatchObject({ filename: "example-grid.tf-plugin.js", enabled: true });
    expect(example?.error).toBeUndefined();
    await application!.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
    }, undoneFile);
    await dispatchMenuAction(restarted.page, "menu:openLayout");
    const reopened = restarted.page.locator("span[title='Double-click to rename']")
      .filter({ hasText: "Example Grid" });
    await expect(reopened).toHaveCount(1);
    await reopened.click();
    await restarted.page.getByRole("button", { name: "Edit with Example Grid", exact: true }).click();
    const reopenedPanel = restarted.page.getByRole("region", { name: "Plugin: Example Grid", exact: true });
    await expect(reopenedPanel.getByLabel("Width", { exact: true })).toHaveValue("50");
    await expect(reopenedPanel.getByRole("button", { name: "Update artwork", exact: true })).toBeEnabled();
    mkdirSync(path.dirname(screenshotFile), { recursive: true });
    await restarted.page.screenshot({ path: screenshotFile });
    const probeResult = await restarted.page.evaluate((pluginId) => window.terraForge.plugins.run({
      runId: "packaged-timeout-override-probe", pluginId,
      input: { kind: "none", page: { widthMM: 220, heightMM: 220 } }, parameters: {},
    }), probeId);
    expect(probeResult).toMatchObject({ width: 1, height: 1 });
    expect(existsSync(path.join(profileDirectory, "plugins-dev"))).toBe(false);
    expect(existsSync(ignoredOverride)).toBe(false);
    success = { status: "passed", packaged: true, executable: EXECUTABLE, version: first.version,
      electronVersion: first.electronVersion, generatedPaths: layout.imports[0].paths.length,
      pluginDirectory: "plugins", testingDirectoryOverrideIgnored: true, testingTimeoutOverrideIgnored: true,
      exampleDiscoveredAfterRestart: true, updatedInPlace: true, updateUndoRestored: true,
      savedControlsRestored: true, temporaryProfileRemoved: true,
      screenshot: screenshotFile };
  } finally {
    try { await close(); }
    finally { cleanupTemporaryRoot(temporaryRoot); }
  }
  process.stdout.write(`${JSON.stringify(success, null, 2)}\n`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`Packaged plugin smoke test failed: ${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
