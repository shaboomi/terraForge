import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isVectorImport, type CanvasLayout } from "../../src/types";
import { launchApp, closeApp, mockOpenDialog, mockSaveDialog, mockIpcInvoke, pushRendererEvent } from "./helpers";
import { parseGcode } from "../../src/renderer/src/utils/gcodeParser";

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
    expect(textItem.useStrokeWidths).toBe(false);
    expect(textItem.paths.length).toBeGreaterThan(5);
    expect(textItem.paths.every((stroke) => stroke.centerline && stroke.centerline.points.every((point) => Number.isFinite(point.width) && point.width > 0))).toBe(true);

    dialog = await openTextGenerator(window);
    await expect(dialog.getByLabel("Text to generate", { exact: true })).toHaveValue("AV O\nTerra");
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue(fontId);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: "Use stroke width information", exact: true })).not.toBeChecked();
    await dialog.getByRole("checkbox", { name: "Use stroke width information", exact: true }).check();
    await dialog.getByLabel("Brush lead-in (mm)", { exact: true }).fill("1.5");
    await dialog.getByLabel("Text to generate", { exact: true }).fill("AV O!");
    await dialog.getByRole("button", { name: "Update selected text", exact: true }).click();
    await expect(window.getByText("Text: AV O!", { exact: true }).first()).toBeVisible();
    dialog = await openTextGenerator(window);
    await expect(dialog.getByRole("checkbox", { name: "Use stroke width information", exact: true })).toBeChecked();
    await expect(dialog.getByLabel("Brush lead-in (mm)", { exact: true })).toHaveValue("1.5");
    await dialog.getByRole("button", { name: "Close text generator", exact: true }).click();
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

test("standard outline fonts provide native curves and solid/sketch plot strokes through G-code and reopening", async () => {
  test.setTimeout(120_000);
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    const layoutPath = join(userDataDir, "outline-text.tforge"), gcodePath = join(userDataDir, "outline-text.gcode");
    let dialog = await openTextGenerator(window);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await dialog.getByLabel("Font mode", { exact: true }).selectOption("outline");
    await mockOpenDialog(electronApp, resolve("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
    await dialog.getByRole("button", { name: "Import TTF / OTF", exact: true }).click();
    await expect(dialog.getByLabel("Text font", { exact: true })).not.toHaveValue("", { timeout: 30_000 });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: "Use stroke width information", exact: true })).toHaveCount(0);
    const fontId = await dialog.getByLabel("Text font", { exact: true }).inputValue();
    const library = await window.evaluate(() => window.terraForge.fonts.list());
    expect(library[0].mode).toBe("outline");
    expect(library[0].glyphs.O.paths).toEqual([]);
    expect(library[0].glyphs.O.outline?.some((command) => command.type === "Q")).toBe(true);
    await dialog.getByLabel("Text to generate", { exact: true }).fill("O");
    await dialog.getByLabel("Font size (mm)", { exact: true }).fill("18");
    await dialog.getByLabel("Text infill", { exact: true }).selectOption("solid");
    await dialog.getByLabel("Fill spacing (mm)", { exact: true }).fill("0.3");
    await dialog.getByLabel("Fill angle (degrees)", { exact: true }).fill("0");
    const preview = dialog.getByRole("img", { name: "Text outline preview", exact: true });
    await expect(preview).toBeVisible();
    expect(await preview.locator("path").count()).toBeGreaterThan(30);
    expect(await preview.locator("path").first().getAttribute("d")).toContain("Q");
    await window.screenshot({ path: "test-results/font-solid-outline-preview.png" });
    await dialog.getByRole("button", { name: "Add text to canvas", exact: true }).click();
    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      expect(existsSync(layoutPath)).toBe(true);
      expect((JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout).imports[0]).toMatchObject({ textSource: { mode: "outline" } });
    }).toPass();
    const solid = JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout;
    const item = solid.imports[0];
    if (!isVectorImport(item)) throw new Error("Outline text did not create vector artwork.");
    expect(item.useStrokeWidths).toBe(false);
    expect(item.textSource).toMatchObject({ mode: "outline", infill: "solid", fillSpacingMM: 0.3, fillAngleDeg: 0, fontId });
    expect(item.paths[0].d.match(/M/g)).toHaveLength(2);
    expect(item.paths.every((path) => !path.centerline && !path.hatchLines && !path.hasFill)).toBe(true);

    dialog = await openTextGenerator(window);
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await expect(dialog.getByLabel("Font mode", { exact: true })).toHaveValue("outline");
    await expect(dialog.getByLabel("Text infill", { exact: true })).toHaveValue("solid");
    await dialog.getByLabel("Text infill", { exact: true }).selectOption("sketch");
    await dialog.getByLabel("Fill spacing (mm)", { exact: true }).fill("0.6");
    await dialog.getByLabel("Fill angle (degrees)", { exact: true }).fill("30");
    await window.screenshot({ path: "test-results/font-sketch-outline-preview.png" });
    await dialog.getByRole("button", { name: "Update selected text", exact: true }).click();
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      expect((JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout).imports[0]).toMatchObject({ textSource: { infill: "sketch" } });
    }).toPass();

    await window.getByRole("button", { name: "Generate G-code", exact: true }).click();
    await window.getByRole("tab", { name: /^output$/i }).click();
    await window.getByLabel("Upload to SD card", { exact: true }).uncheck();
    await window.getByLabel("Save to computer", { exact: true }).check();
    await mockSaveDialog(electronApp, gcodePath);
    await window.getByRole("button", { name: "Generate", exact: true }).click();
    await expect.poll(() => existsSync(gcodePath), { timeout: 30_000 }).toBe(true);
    const gcode = readFileSync(gcodePath, "utf8");
    expect(parseGcode(gcode).cutPaths.length).toBeGreaterThan(0);
    expect(gcode.match(/^G1 X/gm)!.length).toBeGreaterThan(50);
    await mockIpcInvoke(electronApp, "fs:openLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:openLayout", undefined);
    await window.getByRole("button", { name: "Replace", exact: true }).click();
    await window.getByText("Text: O", { exact: true }).first().click();
    dialog = await openTextGenerator(window);
    await expect(dialog.getByLabel("Font mode", { exact: true })).toHaveValue("outline");
    await expect(dialog.getByLabel("Text infill", { exact: true })).toHaveValue("sketch");
    await expect(dialog.getByLabel("Fill spacing (mm)", { exact: true })).toHaveValue("0.6");
    await expect(dialog.getByLabel("Fill angle (degrees)", { exact: true })).toHaveValue("30");
  } finally { await closeApp(electronApp, userDataDir); }
});
