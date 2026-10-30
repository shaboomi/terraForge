import { test, expect, type Locator } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { launchApp, closeApp, mockSaveDialog, type AppHandle } from "./helpers";

async function saveSheet(app: AppHandle, dialog: Locator, name: string) {
  const path = join(app.userDataDir, `${name}.gcode`);
  await mockSaveDialog(app.electronApp, path);
  await dialog.getByRole("button", { name: "Save calibration test", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(/Saved the test/);
  await expect.poll(() => existsSync(`${path}.txt`)).toBe(true);
  const gcode = readFileSync(path, "utf8");
  const record = readFileSync(`${path}.txt`, "utf8");
  expect(gcode).toMatch(/^G21\nG90\nG17\nG94$/m);
  expect(gcode).toMatch(/\nM2\n$/);
  expect(record).toContain("Pen: Calibration test pen");
  return { gcode, record };
}

test("Settings calibration exports mm/min speeds and shows the plotted label orientation", async () => {
  const app = await launchApp();
  try {
    const profile = await app.window.evaluate(() => window.terraForge.config.getMachineConfigs());
    await app.window.getByRole("button", { name: "Machine and application settings", exact: true }).click();
    await app.window.getByRole("tab", { name: "Pens", exact: true }).click();
    await app.window.getByRole("button", { name: "Create calibration sheet", exact: true }).click();
    const dialog = app.window.getByRole("dialog", { name: "Pen calibration", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Start speed (mm/min)", { exact: true })).toHaveValue("600");
    await expect(dialog.getByLabel("End speed (mm/min)", { exact: true })).toHaveValue("3600");
    await expect(dialog.getByLabel("Drawing / reference speed (mm/min)", { exact: true })).toHaveValue(String(profile[0].drawSpeed));
    await expect(dialog.getByText("Row 6: 3600 mm/min", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/mm\/s/)).toHaveCount(0);
    await dialog.getByLabel("Pen name", { exact: true }).fill("Calibration test pen");
    const preview = dialog.locator("svg");
    await expect(preview.locator("g")).toHaveAttribute("transform", "translate(0 164) scale(1 -1)");
    // Digit 1 is on the right with machine Y increasing upward.
    await expect(preview.locator("polyline").first()).toHaveAttribute("points", "9,16 9,14");
    await preview.screenshot({ path: "test-results/calibration-speed-preview.png" });
    const { gcode, record } = await saveSheet(app, dialog, "calibration-speed");
    expect(gcode).toContain("G1 X122 Y12 F600");
    expect(gcode).toContain("G1 X122 Y132 F3600");
    expect(gcode).not.toContain("F216000");
    expect(record).toContain("Row 6: 3600 mm/min");
    expect(await app.window.evaluate(() => window.terraForge.config.getMachineConfigs())).toEqual(profile);
  } finally {
    await closeApp(app.electronApp, app.userDataDir);
  }
});

test("new calibration tests save timing, measured geometry, retraces and hatch sheets without changing the profile", async () => {
  test.setTimeout(120000);
  const app = await launchApp();
  try {
    const profile = await app.window.evaluate(() => window.terraForge.config.getMachineConfigs());
    await app.window.getByRole("button", { name: "Machine and application settings", exact: true }).click();
    await app.window.getByRole("tab", { name: "Pens", exact: true }).click();
    await app.window.getByRole("button", { name: "Create calibration sheet", exact: true }).click();
    const dialog = app.window.getByRole("dialog", { name: "Pen calibration", exact: true });
    const testChoice = dialog.getByLabel("Test", { exact: true });
    await dialog.getByLabel("Pen name", { exact: true }).fill("Calibration test pen");
    await dialog.getByLabel("Drawing / reference speed (mm/min)", { exact: true }).fill("900");

    await testChoice.selectOption("timing");
    await dialog.getByLabel("Rows (2–10)", { exact: true }).fill("3");
    await expect(dialog.getByLabel("Safe lift Z (mm)", { exact: true })).toHaveCount(0);
    for (const mode of ["down", "up"]) {
      await dialog.getByLabel("Delay to test", { exact: true }).selectOption(mode);
      const { gcode, record } = await saveSheet(app, dialog, `calibration-timing-${mode}`);
      expect(record).toContain(`Row 2: pen-${mode} delay 150 ms`);
      expect(record).toContain(`Row 3: pen-${mode} delay 300 ms`);
      expect(gcode).toContain("G4 P0.15");
      expect(gcode).toContain("G4 P0.3");
      expect(gcode).toContain("F900");
    }

    await testChoice.selectOption("geometry");
    await expect(dialog.getByLabel("Rows (2–10)", { exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel("Square side length (mm)", { exact: true })).toHaveValue("100");
    await dialog.locator("svg").screenshot({ path: "test-results/calibration-geometry-preview.png" });
    const geometry = await saveSheet(app, dialog, "calibration-geometry");
    expect(geometry.record).toContain("Square: 100 × 100 mm; diagonals: 141.4214 mm; circle diameters: 50 and 100 mm");
    expect(geometry.gcode).toContain("G1 X122 Y112 F900");
    expect(geometry.gcode).toContain("G1 X22 Y112 F900");
    expect(geometry.gcode.match(/^G1 X122 Y12 F900$/gm)).toHaveLength(1);

    await testChoice.selectOption("repeatability");
    await expect(dialog.getByLabel("Passes (2–10)", { exact: true })).toHaveValue("3");
    const repeat = await saveSheet(app, dialog, "calibration-repeatability");
    expect(repeat.record).toContain("Pass 3: retrace the same 100 mm square");
    expect(repeat.gcode.match(/^G1 X122 Y12 F900$/gm)).toHaveLength(3);

    await testChoice.selectOption("hatching");
    await dialog.getByLabel("Rows (2–10)", { exact: true }).fill("6");
    await expect(dialog.getByLabel("Minimum line spacing (mm)", { exact: true })).toHaveValue("0.25");
    await expect(dialog.getByLabel("Maximum line spacing (mm)", { exact: true })).toHaveValue("2");
    await dialog.locator("svg").screenshot({ path: "test-results/calibration-hatching-preview.png" });
    const hatch = await saveSheet(app, dialog, "calibration-hatching");
    expect(hatch.record).toContain("Row 1: 0.25 mm line spacing");
    expect(hatch.record).toContain("Row 6: 2 mm line spacing");
    expect(hatch.record).toContain("204 mm continuous stroke");
    expect(hatch.gcode).toContain("G1 X122 Y36 F900\nG1 X122 Y40 F900\nG1 X22 Y40 F900");
    expect(await app.window.evaluate(() => window.terraForge.config.getMachineConfigs())).toEqual(profile);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(dialog).not.toBeVisible();
  } finally {
    await closeApp(app.electronApp, app.userDataDir);
  }
});

