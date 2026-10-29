import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { launchApp, closeApp, mockOpenDialog } from "./helpers";

async function openText(window: Page) {
  await window.getByRole("button", { name: "Plugins", exact: true }).click();
  await window.getByRole("menuitem", { name: "Font Tools", exact: true }).hover();
  await window.getByRole("menuitem", { name: "Text generator", exact: true }).click();
  const dialog = window.getByRole("dialog", { name: "Text generator", exact: true });
  await expect(dialog.getByRole("status")).toHaveCount(0);
  return dialog;
}

test("existing Dancing Script strokes upgrade to Béziers with an unbroken F stem and crossing bar", async () => {
  test.setTimeout(120_000);
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    const directory = join(await electronApp.evaluate(({ app }) => app.getPath("userData")), "font-library");
    mkdirSync(directory, { recursive: true });
    const legacy = JSON.parse(readFileSync(resolve("tests/fixtures/fonts/DancingScript-legacy-strokes.json"), "utf8"));
    writeFileSync(join(directory, `${legacy.id}.json`), JSON.stringify(legacy));
    const dialog = await openText(window);
    await expect(dialog.getByLabel("Text font", { exact: true })).toHaveValue(legacy.id);
    await dialog.getByLabel("Text to generate", { exact: true }).fill("F acs");
    const preview = dialog.getByRole("img", { name: "Text centre-line preview", exact: true });
    expect((await preview.locator("path").first().getAttribute("d"))!).not.toContain("C");
    await dialog.getByRole("button", { name: "Smooth centrelines", exact: true }).click();
    await expect.poll(async () => (await window.evaluate(() => window.terraForge.fonts.list()))[0].processingVersion, { timeout: 30_000 }).toBe(2);
    await expect(preview).toBeVisible();
    const paths = await preview.locator("path").evaluateAll(elements => elements.map(element => element.getAttribute("d") ?? ""));
    expect(paths.some(path => path.includes("C"))).toBe(true);
    await expect(dialog.getByLabel("Text to generate", { exact: true })).toHaveValue("F acs");
    const saved = (await window.evaluate(() => window.terraForge.fonts.list()))[0];
    expect(saved.id).toBe(legacy.id);
    const strokes = saved.glyphs.F.paths;
    expect(strokes.some(stroke => Math.min(...stroke.points.map(p => p.y)) < 0 && Math.max(...stroke.points.map(p => p.y)) > 650)).toBe(true);
    expect(strokes.some(stroke => Math.min(...stroke.points.map(p => p.x)) < 100 && Math.max(...stroke.points.map(p => p.x)) > 400 && stroke.points.every(p => p.y > 250 && p.y < 430))).toBe(true);
    await window.screenshot({ path: "test-results/dancing-script-upgraded-curves.png" });
  } finally { await closeApp(electronApp, userDataDir); }
});

test("a fresh Dancing Script import produces cubic centreline geometry", async () => {
  test.setTimeout(180_000);
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    const dialog = await openText(window);
    await dialog.getByLabel("Text to generate", { exact: true }).fill("F acs");
    await mockOpenDialog(electronApp, resolve("tests/fixtures/fonts/DancingScript.ttf"));
    await dialog.getByRole("button", { name: "Import TTF / OTF", exact: true }).click();
    await expect(dialog.getByLabel("Text font", { exact: true })).not.toHaveValue("", { timeout: 120_000 });
    const preview = dialog.getByRole("img", { name: "Text centre-line preview", exact: true });
    await expect(preview).toBeVisible();
    expect((await preview.locator("path").all()).length).toBeGreaterThan(3);
    const library = await window.evaluate(() => window.terraForge.fonts.list());
    expect(library[0].processingVersion).toBe(2);
    expect(library[0].glyphs.F.paths.some(stroke => stroke.commands?.some(command => command.type === "C"))).toBe(true);
    await window.screenshot({ path: "test-results/dancing-script-smooth-curves.png" });
  } finally { await closeApp(electronApp, userDataDir); }
});
