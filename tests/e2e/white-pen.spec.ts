import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { parseGcode } from "../../src/renderer/src/utils/gcodeParser";
import type { CanvasLayout } from "../../src/types";
import {
  launchApp, closeApp, fixturePath, mockOpenDialog, mockIpcInvoke,
  mockSaveDialog, pushRendererEvent,
} from "./helpers";

/** Read the actual drawing surface, excluding SVG selection handles and labels. */
async function whiteStrokePixels(window: Page): Promise<number> {
  return window.getByTestId("toolpath-canvas").evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d")!;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let whitePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index] >= 245 && pixels[index + 1] >= 245 && pixels[index + 2] >= 245 && pixels[index + 3] === 255) whitePixels++;
    }
    return whitePixels;
  });
}

test("a white pen chosen before SVG import stays white through G-code generation and layout reopening", async () => {
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    const layoutPath = path.join(userDataDir, "white-pen.tforge");
    const gcodePath = path.join(userDataDir, "white-pen.gcode");
    await window.getByLabel("Page size", { exact: true }).selectOption("a5");
    await window.getByRole("button", { name: "Page colour", exact: true }).click();
    await window.getByRole("button", { name: "Black (#000000)", exact: true }).click();

    // Choose white before importing. No subsequent Apply action should be needed.
    await window.getByRole("button", { name: "Pen colours", exact: true }).click();
    const penDialog = window.getByRole("dialog", { name: "Pen colours", exact: true });
    await penDialog.getByLabel("New pen name", { exact: true }).fill("White ink");
    await penDialog.getByRole("button", { name: "New pen colour", exact: true }).click();
    const hex = penDialog.getByLabel("New pen colour hex code", { exact: true });
    await hex.fill("#fff");
    await hex.press("Enter");
    await hex.press("Escape");
    await penDialog.getByRole("button", { name: "Add pen", exact: true }).click();
    const activePenId = await penDialog.getByLabel("Pen", { exact: true }).inputValue();
    expect(activePenId).not.toBe("");
    await penDialog.getByRole("button", { name: "Close pen colours", exact: true }).click();

    await mockOpenDialog(electronApp, fixturePath("sample.svg"));
    await window.getByRole("button", { name: "Import", exact: true }).click();
    await expect(window.getByText("sample", { exact: true }).first()).toBeVisible();
    await expect.poll(() => whiteStrokePixels(window)).toBeGreaterThan(20);

    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect.poll(() => existsSync(layoutPath)).toBe(true);
    const saved = JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout;
    expect(saved.activePenId).toBe(activePenId);
    const pen = saved.layerGroups!.find((group) => group.id === activePenId)!;
    expect(pen.color).toBe("#ffffff");
    expect(pen.importIds).toEqual([saved.imports[0].id]);

    await window.getByRole("button", { name: "Generate G-code", exact: true }).click();
    await window.getByRole("tab", { name: /^output$/i }).click();
    await window.getByLabel("Upload to SD card", { exact: true }).uncheck();
    await window.getByLabel("Save to computer", { exact: true }).check();
    await mockSaveDialog(electronApp, gcodePath);
    await window.getByRole("button", { name: "Generate", exact: true }).click();
    await expect.poll(() => existsSync(gcodePath), { timeout: 30000 }).toBe(true);
    const gcode = readFileSync(gcodePath, "utf8");
    expect(gcode).toMatch(/;@tf[^\n]*color=%23ffffff/i);
    const toolpath = parseGcode(gcode);
    expect(toolpath.cutPaths.length).toBeGreaterThan(0);
    expect(toolpath.cutPathColors!.every((color) => color === "#ffffff")).toBe(true);

    // Hide the source SVG, so only generated pen strokes can satisfy this check.
    const importRow = window.getByText("sample", { exact: true }).first().locator("..");
    await importRow.locator("span[title='Toggle visibility']").click();
    await expect.poll(() => whiteStrokePixels(window)).toBeGreaterThan(20);
    await window.screenshot({ path: "test-results/white-pen-gcode-preview.png" });

    await mockIpcInvoke(electronApp, "fs:openLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:openLayout", undefined);
    await window.getByRole("button", { name: "Replace", exact: true }).click();
    await window.getByRole("button", { name: "Pen colours", exact: true }).click();
    await expect(penDialog.getByLabel("Pen", { exact: true })).toHaveValue(activePenId);
    await penDialog.getByRole("button", { name: "Close pen colours", exact: true }).click();
    await mockOpenDialog(electronApp, fixturePath("sample.svg"));
    await window.getByRole("button", { name: "Import", exact: true }).click();
    await expect(window.getByText("sample", { exact: true })).toHaveCount(2);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect(async () => {
      expect((JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout).imports).toHaveLength(2);
    }).toPass();
    const reopened = JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout;
    expect(reopened.activePenId).toBe(activePenId);
    expect(reopened.layerGroups!.find((group) => group.id === activePenId)!.importIds)
      .toEqual(reopened.imports.map((item) => item.id));
  } finally {
    await closeApp(electronApp, userDataDir);
  }
});
