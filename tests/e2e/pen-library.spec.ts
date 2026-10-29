import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CanvasLayout } from "../../src/types";
import { launchApp, closeApp, fixturePath, mockOpenDialog, mockSaveDialog, mockIpcInvoke, pushRendererEvent } from "./helpers";

async function openPens(window: Page) {
  await window.getByRole("button", { name: "Pen colours", exact: true }).click();
  return window.getByRole("dialog", { name: "Pen colours", exact: true });
}

test("brush specifications, calibrated speed and reusable pen library survive layouts and app restart", async () => {
  test.setTimeout(120000);
  let { electronApp, window, userDataDir } = await launchApp();
  try {
    const layoutPath = join(userDataDir, "brush-library.tforge");
    const gcodePath = join(userDataDir, "brush-library.gcode");
    let dialog = await openPens(window);
    await dialog.getByLabel("New pen name", { exact: true }).fill("Calibrated black brush");
    await dialog.getByRole("button", { name: "Add pen", exact: true }).click();
    const layoutPenId = await dialog.getByLabel("Pen", { exact: true }).inputValue();
    await dialog.getByLabel("Pen type", { exact: true }).selectOption("brush");
    await dialog.getByLabel("Maximum drawing speed (mm/min)", { exact: true }).fill("900");
    await dialog.getByLabel("Z at maximum width (mm)", { exact: true }).fill("0");
    await dialog.getByRole("button", { name: "Save pen to library", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/two different Z heights/);
    await expect(dialog.getByText("Pen library (0)", { exact: true })).toBeVisible();
    await dialog.getByLabel("Z at maximum width (mm)", { exact: true }).fill("-1.5");
    await dialog.getByRole("button", { name: "Save pen to library", exact: true }).click();
    await expect(dialog.getByRole("status")).toHaveText("Pen saved to your library.");
    const savedPen = dialog.getByLabel("Saved pen", { exact: true });
    const profileId = await savedPen.locator("optgroup[label='Brush'] option").getAttribute("value");
    expect(profileId).toBeTruthy();
    await savedPen.selectOption(profileId!);
    await dialog.getByLabel("Group pen library by", { exact: true }).selectOption("colour");
    await expect(savedPen.locator("optgroup[label='#000000'] option")).toHaveCount(1);
    await dialog.getByLabel("Search pen library", { exact: true }).fill("no-such-pen");
    await expect(dialog.getByText("No saved pens match this search.", { exact: true })).toBeVisible();
    await dialog.getByLabel("Search pen library", { exact: true }).fill("");
    await dialog.getByRole("button", { name: "Use saved pen", exact: true }).click();
    await expect(dialog.getByLabel("Pen", { exact: true })).toHaveValue(layoutPenId);
    await expect(dialog.getByLabel("Pen", { exact: true }).locator("option")).toHaveCount(2);
    await dialog.getByRole("button", { name: "Close pen colours", exact: true }).click();

    await mockOpenDialog(electronApp, fixturePath("sample.svg"));
    await window.getByRole("button", { name: "Import", exact: true }).click();
    await expect(window.getByText("sample", { exact: true }).first()).toBeVisible();
    await window.getByText("sample", { exact: true }).first().click();
    // Leave room for the physical moving brush approach around every stroke.
    await window.getByLabel("X (mm)", { exact: true }).fill("5");
    await window.getByLabel("X (mm)", { exact: true }).blur();
    await window.getByLabel("Y (mm)", { exact: true }).fill("5");
    await window.getByLabel("Y (mm)", { exact: true }).blur();
    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", layoutPath);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect.poll(() => existsSync(layoutPath)).toBe(true);
    const layout = JSON.parse(readFileSync(layoutPath, "utf8")) as CanvasLayout;
    expect(layout.layerGroups[0].penProfile).toMatchObject({
      id: profileId, type: "brush", maxDrawSpeedMMMin: 900,
      brush: { minWidthMM: 0.2, maxWidthMM: 3, minZ: 0, maxZ: -1.5 },
    });
    expect(layout.layerGroups[0].importIds).toEqual([layout.imports[0].id]);

    await window.getByRole("button", { name: "Generate G-code", exact: true }).click();
    await window.getByRole("tab", { name: /^output$/i }).click();
    await window.getByLabel("Upload to SD card", { exact: true }).uncheck();
    await window.getByLabel("Save to computer", { exact: true }).check();
    await mockSaveDialog(electronApp, gcodePath);
    await window.getByRole("button", { name: "Generate", exact: true }).click();
    await expect.poll(() => existsSync(gcodePath), { timeout: 30000 }).toBe(true);
    const gcode = readFileSync(gcodePath, "utf8");
    expect(gcode).toMatch(/^F900\s*$/m);
    expect(gcode).toMatch(/^G1\s+X[-\d.]+\s+Y[-\d.]+\s+Z-0\.161 ; Brush moving lead-in/m);
    expect(gcode).not.toMatch(/^G1\s+Z[-\d.]+ ; Brush contact/m);

    await pushRendererEvent(electronApp, "menu:closeLayout", undefined);
    await window.getByRole("button", { name: "Exit without Saving", exact: true }).click();
    dialog = await openPens(window);
    await expect(dialog.getByText("Pen library (1)", { exact: true })).toBeVisible();
    await dialog.getByLabel("Saved pen", { exact: true }).selectOption(profileId!);
    await dialog.getByRole("button", { name: "Use saved pen", exact: true }).click();
    await expect(dialog.getByLabel("Pen type", { exact: true })).toHaveValue("brush");
    await expect(dialog.getByLabel("Maximum drawing speed (mm/min)", { exact: true })).toHaveValue("900");
    await dialog.getByRole("button", { name: "Close pen colours", exact: true }).click();

    await electronApp.close();
    ({ electronApp, window } = await launchApp(userDataDir));
    dialog = await openPens(window);
    await expect(dialog.getByText("Pen library (1)", { exact: true })).toBeVisible();
    await dialog.getByLabel("Saved pen", { exact: true }).selectOption(profileId!);
    await dialog.getByRole("button", { name: "Use saved pen", exact: true }).click();
    await expect(dialog.getByLabel("Z at maximum width (mm)", { exact: true })).toHaveValue("-1.5");
    await expect(dialog.getByLabel("Maximum drawing speed (mm/min)", { exact: true })).toHaveValue("900");
    await window.screenshot({ path: "test-results/pen-library-brush.png" });
  } finally {
    await closeApp(electronApp, userDataDir);
  }
});
