import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp, closeApp, fixturePath, mockOpenDialog, mockSaveDialog, pushRendererEvent } from "./helpers";

test("Settings pen library persists and carries calibrated assignments into saved layouts", async () => {
  const app = await launchApp();
  try {
    await mockOpenDialog(app.electronApp, fixturePath("sample.svg"));
    await app.window.locator("button:has-text('Import')").click();
    await expect(app.window.locator("text=sample").first()).toBeVisible();
    await app.window.keyboard.press("Control+a");
    await app.window.getByRole("button", { name: "Machine and application settings", exact: true }).click();
    await app.window.getByRole("tab", { name: "Pens", exact: true }).click();
    const library = app.window.getByRole("region", { name: "Pen library", exact: true });
    await library.getByLabel("Pen name", { exact: true }).fill("Calibrated grey fineliner");
    await library.getByLabel("Maximum drawing speed (mm/min)", { exact: true }).fill("900");
    await library.getByRole("button", { name: "Save pen to library", exact: true }).click();
    await expect(library.getByRole("status")).toHaveText("Pen saved to your library.");
    await library.getByRole("button", { name: "Apply pen to selection", exact: true }).click();
    await expect(library.getByRole("status")).toContainText("Pen applied");
    await app.window.getByRole("button", { name: "Close", exact: true }).click();
    const layoutPath = join(app.userDataDir, "calibrated-layout.tforge");
    await mockSaveDialog(app.electronApp, layoutPath);
    await pushRendererEvent(app.electronApp, "menu:saveLayout", undefined);
    await expect.poll(() => {
      try { return JSON.parse(readFileSync(layoutPath, "utf8")).layerGroups[0]?.penProfile?.maxDrawSpeedMMMin; }
      catch { return null; }
    }).toBe(900);
    await app.window.reload();
    await app.window.getByRole("button", { name: "Machine and application settings", exact: true }).click();
    await app.window.getByRole("tab", { name: "Pens", exact: true }).click();
    await expect(app.window.getByRole("heading", { name: "Pen library (1)", exact: true })).toBeVisible();
    const saved = app.window.getByLabel("Saved pen", { exact: true });
    await saved.selectOption({ label: "Calibrated grey fineliner · #000000 · 0.5 mm" });
    await expect(app.window.getByLabel("Maximum drawing speed (mm/min)", { exact: true })).toHaveValue("900");
    await app.window.screenshot({ path: "test-results/settings-pens.png" });
  } finally { await closeApp(app.electronApp, app.userDataDir); }
});
