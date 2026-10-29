import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CanvasLayout } from "../../src/types";
import { isVectorImport } from "../../src/types";
import { launchApp, closeApp, mockOpenDialog, mockIpcInvoke, pushRendererEvent } from "./helpers";

test("choosing Centreline converts the selected imported font and keeps the text preview populated", async () => {
  test.setTimeout(120_000);
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    await window.getByRole("button", { name: "Plugins", exact: true }).click();
    await window.getByRole("menuitem", { name: "Font Tools", exact: true }).hover();
    await window.getByRole("menuitem", { name: "Text generator", exact: true }).click();
    const dialog = window.getByRole("dialog", { name: "Text generator", exact: true });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await dialog.getByLabel("Font mode", { exact: true }).selectOption("outline");
    await dialog.getByLabel("Text to generate", { exact: true }).fill("AVO B");
    await dialog.getByLabel("Font size (mm)", { exact: true }).fill("20");
    await mockOpenDialog(electronApp, resolve("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
    await dialog.getByRole("button", { name: "Import TTF / OTF", exact: true }).click();
    await expect(dialog.getByLabel("Text font", { exact: true })).not.toHaveValue("", { timeout: 30_000 });
    const sourceId = await dialog.getByLabel("Text font", { exact: true }).inputValue();
    const source = (await window.evaluate(() => window.terraForge.fonts.list()))[0];
    await expect(dialog.getByRole("img", { name: "Text outline preview", exact: true })).toBeVisible();

    // Switching an already imported font must use saved contours, without another file picker.
    await electronApp.evaluate(({ dialog: nativeDialog }) => {
      nativeDialog.showOpenDialog = async () => { throw new Error("Conversion must not ask for the original font again."); };
    });
    await dialog.getByLabel("Font mode", { exact: true }).selectOption("centerline");
    await expect(dialog.getByLabel("Font mode", { exact: true })).toHaveValue("centerline", { timeout: 30_000 });
    const preview = dialog.getByRole("img", { name: "Text centre-line preview", exact: true });
    await expect(preview).toBeVisible();
    expect(await preview.locator("path").count()).toBeGreaterThan(4);
    const curvePaths = await preview.locator("path").evaluateAll(paths => paths.map(path => path.getAttribute("d") ?? ""));
    expect(curvePaths.some(d => d.includes("C"))).toBe(true);
    await expect(dialog.getByLabel("Text to generate", { exact: true })).toHaveValue("AVO B");
    await expect(dialog.getByLabel("Font size (mm)", { exact: true })).toHaveValue("20");
    const derivedId = await dialog.getByLabel("Text font", { exact: true }).inputValue();
    expect(derivedId).not.toBe(sourceId);
    const library = await window.evaluate(() => window.terraForge.fonts.list());
    expect(library).toHaveLength(2);
    expect(library.find(font => font.id === sourceId)).toEqual(source);
    const converted = library.find(font => font.id === derivedId)!;
    expect(converted.sourceFontId).toBe(sourceId);
    expect(converted.glyphs.O.paths).toHaveLength(1);
    expect(converted.glyphs.O.outline).toBeUndefined();
    await window.screenshot({ path: "test-results/font-converted-centrelines.png" });

    await dialog.getByLabel("Font mode", { exact: true }).selectOption("outline");
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue(sourceId);
    await dialog.getByLabel("Font mode", { exact: true }).selectOption("centerline");
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue(derivedId);
    expect(await window.evaluate(() => window.terraForge.fonts.list())).toHaveLength(2);
    await dialog.getByRole("button", { name: "Add text to canvas", exact: true }).click();
    const target = join(userDataDir, "converted-centreline.tforge");
    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", target);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      expect(existsSync(target)).toBe(true);
      const saved = JSON.parse(readFileSync(target, "utf8")) as CanvasLayout;
      expect(saved.imports).toHaveLength(1);
      const item = saved.imports[0];
      expect(isVectorImport(item)).toBe(true);
      if (!isVectorImport(item)) throw new Error("Missing converted text.");
      expect(item.textSource).toMatchObject({ mode: "centerline", fontId: derivedId, text: "AVO B" });
      expect(item.paths.every(path => (path.centerline?.points.length ?? 0) >= 2)).toBe(true);
    }).toPass();
  } finally { await closeApp(electronApp, userDataDir); }
});
