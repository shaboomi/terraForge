import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isVectorImport, type CanvasLayout } from "../../src/types";
import { launchApp, closeApp, mockOpenDialog, mockIpcInvoke, pushRendererEvent } from "./helpers";

async function openTextGenerator(window: Page) {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await window.getByRole("menuitem", { name: "Font Tools", exact: true }).hover();
  await window.getByRole("menuitem", { name: "Text generator", exact: true }).click();
  return window.getByRole("dialog", { name: "Text generator", exact: true });
}

test("native TTF processing, editable text and stroke widths survive layouts and font-library restart", async () => {
  test.setTimeout(120_000);
  let { electronApp, window, userDataDir } = await launchApp();
  try {
    const fontPath = resolve("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf");
    const layoutPath = join(userDataDir, "centreline-text.tforge");
    let dialog = await openTextGenerator(window);
    await mockOpenDialog(electronApp, fontPath);
    await dialog.getByRole("button", { name: "Import TTF / OTF", exact: true }).click();
    await expect(dialog.getByLabel("Text font", { exact: true })).not.toHaveValue("", { timeout: 30_000 });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    const fontId = await dialog.getByLabel("Text font", { exact: true }).inputValue();
    const library = await window.evaluate(() => window.terraForge.fonts.list());
    expect(library).toHaveLength(1);
    expect(library[0].id).toBe(fontId);
    expect(Object.keys(library[0].glyphs).length).toBeGreaterThan(200);
    expect(library[0].glyphs.O.paths).toHaveLength(1);
    await dialog.getByLabel("Text to generate", { exact: true }).fill("AV O\nTerra");
    await dialog.getByLabel("Font size (mm)", { exact: true }).fill("20");
    await dialog.getByLabel("Text alignment", { exact: true }).selectOption("center");
    await expect(dialog.getByRole("img", { name: "Text centre-line preview", exact: true })).toBeVisible();
    await window.screenshot({ path: "test-results/font-centreline-preview.png" });
    await dialog.getByRole("button", { name: "Add text to canvas", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(window.getByText("Text: AV O Terra", { exact: true }).first()).toBeVisible();

    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      expect(existsSync(layoutPath)).toBe(true);
      expect(JSON.parse(readFileSync(layoutPath, "utf8")).imports).toHaveLength(1);
    }).toPass();
    const saved = JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout;
    expect(saved.imports).toHaveLength(1);
    const textItem = saved.imports[0];
    expect(isVectorImport(textItem)).toBe(true);
    if (!isVectorImport(textItem)) throw new Error("Text was not saved as vector artwork.");
    expect(textItem.textSource).toMatchObject({ fontId, text: "AV O\nTerra", fontSizeMM: 20, alignment: "center" });
    expect(textItem.paths.length).toBeGreaterThan(5);
    expect(textItem.paths.every((stroke) => stroke.centerline && stroke.centerline.points.every((point) => Number.isFinite(point.width) && point.width > 0))).toBe(true);

    dialog = await openTextGenerator(window);
    await expect(dialog.getByLabel("Text to generate", { exact: true })).toHaveValue("AV O\nTerra");
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue(fontId);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await dialog.getByLabel("Text to generate", { exact: true }).fill("AV O!");
    await dialog.getByRole("button", { name: "Update selected text", exact: true }).click();
    await expect(window.getByText("Text: AV O!", { exact: true }).first()).toBeVisible();
    await window.keyboard.press("ControlOrMeta+z");
    await expect(window.getByText("Text: AV O Terra", { exact: true }).first()).toBeVisible();

    await mockIpcInvoke(electronApp, "fs:openLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:openLayout", undefined);
    await window.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(window.getByText("Text: AV O Terra", { exact: true }).first()).toBeVisible();
    const beforeReopenedSave = readFileSync(layoutPath, "utf8");
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      const content = readFileSync(layoutPath, "utf8");
      expect(content).not.toBe(beforeReopenedSave);
      expect((JSON.parse(content) as CanvasLayout).imports).toEqual(saved.imports);
    }).toPass();

    await electronApp.close();
    ({ electronApp, window } = await launchApp(userDataDir));
    dialog = await openTextGenerator(window);
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue(fontId);
    await dialog.getByRole("button", { name: "Close text generator", exact: true }).click();
    await mockIpcInvoke(electronApp, "fs:openLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:openLayout", undefined);
    await expect(window.getByText("Text: AV O Terra", { exact: true }).first()).toBeVisible();
    dialog = await openTextGenerator(window);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Delete selected font", exact: true }).click();
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue("");
    expect(await window.evaluate(() => window.terraForge.fonts.list())).toHaveLength(0);
    await dialog.getByRole("button", { name: "Close text generator", exact: true }).click();
    await expect(window.getByRole("button", { name: "Generate G-code", exact: true })).toBeEnabled();
    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", layoutPath);
    const beforeDeletedFontSave = readFileSync(layoutPath, "utf8");
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      const content = readFileSync(layoutPath, "utf8");
      expect(content).not.toBe(beforeDeletedFontSave);
      expect((JSON.parse(content) as CanvasLayout).imports).toEqual(saved.imports);
    }).toPass();
  } finally { await closeApp(electronApp, userDataDir); }
});
