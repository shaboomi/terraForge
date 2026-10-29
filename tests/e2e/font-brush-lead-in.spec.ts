import { test, expect, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchApp, closeApp, mockOpenDialog, mockSaveDialog } from "./helpers";

async function openText(window: Page) {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await window.getByRole("menuitem", { name: "Font Tools", exact: true }).hover();
  await window.getByRole("menuitem", { name: "Text generator", exact: true }).click();
  const dialog = window.getByRole("dialog", { name: "Text generator", exact: true });
  await expect(dialog.getByRole("status")).toHaveCount(0);
  return dialog;
}

test("real font strokes lower a brush during a moving approach and switch back to fixed height", async () => {
  test.setTimeout(120_000);
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    await window.getByRole("button", { name: "Pen colours", exact: true }).click();
    const pens = window.getByRole("dialog", { name: "Pen colours", exact: true });
    await pens.getByLabel("New pen name", { exact: true }).fill("Test brush");
    await pens.getByRole("button", { name: "Add pen", exact: true }).click();
    await pens.getByLabel("Pen type", { exact: true }).selectOption("brush");
    await pens.getByLabel("Maximum drawing speed (mm/min)", { exact: true }).fill("700");
    await pens.getByLabel("Z at maximum width (mm)", { exact: true }).fill("-1.5");
    await pens.getByRole("button", { name: "Apply specifications", exact: true }).click();
    await expect(pens.getByRole("status")).toHaveText("Pen specifications applied to this layout.");
    await pens.getByRole("button", { name: "Close pen colours", exact: true }).click();

    let dialog = await openText(window);
    await mockOpenDialog(electronApp, resolve("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
    await dialog.getByRole("button", { name: "Import TTF / OTF", exact: true }).click();
    await expect(dialog.getByLabel("Text font", { exact: true })).not.toHaveValue("", { timeout: 30_000 });
    await expect(dialog.getByRole("status")).toHaveCount(0);
    await dialog.getByLabel("Text to generate", { exact: true }).fill("AV");
    await dialog.getByLabel("Font size (mm)", { exact: true }).fill("20");
    await dialog.getByLabel("Use stroke width information", { exact: true }).check();
    await dialog.getByLabel("Brush lead-in (mm)", { exact: true }).fill("2");
    await dialog.getByRole("button", { name: "Add text to canvas", exact: true }).click();

    const exportGcode = async (name: string) => {
      const target = join(userDataDir, name);
      await window.getByRole("button", { name: "Generate G-code", exact: true }).click();
      await window.getByRole("tab", { name: /^output$/i }).click();
      await window.getByLabel("Upload to SD card", { exact: true }).uncheck();
      await window.getByLabel("Save to computer", { exact: true }).check();
      await mockSaveDialog(electronApp, target);
      await window.getByRole("button", { name: "Generate", exact: true }).click();
      await expect.poll(() => existsSync(target), { timeout: 30_000 }).toBe(true);
      return readFileSync(target, "utf8");
    };
    const variable = await exportGcode("variable.gcode");
    expect(variable).toMatch(/^F700\s*$/m);
    expect(variable).toContain("; Brush moving lead-in");
    expect(variable).not.toMatch(/^G1\s+Z/m);
    const zs = [...variable.matchAll(/^G1 X[-\d.]+ Y[-\d.]+ Z([-\d.]+)/gm)].map((match) => Number(match[1]));
    expect(new Set(zs).size).toBeGreaterThan(2);
    const firstRamp = /G0 X([-\d.]+) Y([-\d.]+) ; Rapid travel\s+F700\s+G1 X([-\d.]+) Y([-\d.]+) Z[-\d.]+ ; Brush moving lead-in/.exec(variable);
    expect(firstRamp).not.toBeNull();
    expect(Math.hypot(Number(firstRamp![3]) - Number(firstRamp![1]), Number(firstRamp![4]) - Number(firstRamp![2]))).toBeCloseTo(2, 2);

    await window.getByText("Text: AV", { exact: true }).first().click();
    dialog = await openText(window);
    await expect(dialog.getByLabel("Use stroke width information", { exact: true })).toBeChecked();
    await dialog.getByLabel("Use stroke width information", { exact: true }).uncheck();
    await dialog.getByRole("button", { name: "Update selected text", exact: true }).click();
    const fixed = await exportGcode("fixed.gcode");
    expect(fixed).not.toContain("; Brush moving lead-in");
    expect(fixed).not.toMatch(/^G1 X[-\d.]+ Y[-\d.]+ Z/m);
    expect(fixed).toMatch(/; Pen down/);
    expect(fixed).toMatch(/^F700\s*$/m);
  } finally { await closeApp(electronApp, userDataDir); }
});
