import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { launchApp, closeApp, fixturePath, mockOpenDialog, mockIpcInvoke, pushRendererEvent } from "./helpers";

test("page colour and lightest-first pens survive saving, reopening and undo", async () => {
  const { electronApp, window, userDataDir } = await launchApp();
  try {
    const savedPath = path.join(userDataDir, "colours.tforge");
    await window.getByLabel("Page size", { exact: true }).selectOption("a5");
    await window.getByRole("button", { name: "Page colour", exact: true }).click();
    await window.getByRole("button", { name: "Kraft (#b99566)", exact: true }).click();
    await window.getByRole("button", { name: "Page colour", exact: true }).click();
    await window.getByLabel("Page colour hex code", { exact: true }).fill("#def");
    await window.getByLabel("Page colour hex code", { exact: true }).press("Enter");
    await window.getByLabel("Page colour hex code", { exact: true }).press("Escape");

    await window.getByRole("button", { name: "Pen colours", exact: true }).click();
    const dialog = window.getByRole("dialog", { name: "Pen colours", exact: true });
    for (const [name, color] of [["Black", "#000000"], ["Yellow", "#ffff00"], ["White", "#ffffff"]]) {
      await dialog.getByLabel("New pen name", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "New pen colour", exact: true }).click();
      const hex = dialog.getByLabel("New pen colour hex code", { exact: true });
      await hex.fill(color);
      await hex.press("Enter");
      await hex.press("Escape");
      await dialog.getByRole("button", { name: "Add pen", exact: true }).click();
    }
    await expect(dialog.getByLabel("Pen", { exact: true }).locator("option")).toHaveText([
      "Original SVG colours", "1. White (#ffffff)", "2. Yellow (#ffff00)", "3. Black (#000000)",
    ]);
    await dialog.getByRole("button", { name: "Close pen colours", exact: true }).click();

    // A palette-only document can be saved before importing artwork.
    await mockIpcInvoke(electronApp, "fs:saveLayoutDialog", savedPath);
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect.poll(() => fs.existsSync(savedPath)).toBe(true);
    const palette = JSON.parse(fs.readFileSync(savedPath, "utf8"));
    expect(palette.pageTemplate.color).toBe("#ddeeff");
    expect(palette.imports).toHaveLength(0);
    expect(palette.layerGroups.map((pen: { name: string }) => pen.name)).toEqual(["White", "Yellow", "Black"]);

    await mockOpenDialog(electronApp, fixturePath("sample.svg"));
    await window.getByRole("button", { name: "Import", exact: true }).click();
    await expect(window.getByText("sample", { exact: true }).first()).toBeVisible();
    await window.getByText("sample", { exact: true }).first().click();
    await window.getByRole("button", { name: "Pen colours", exact: true }).click();
    await dialog.getByLabel("Pen", { exact: true }).selectOption({ label: "2. Yellow (#ffff00)" });
    await dialog.getByRole("button", { name: "Apply pen to selection", exact: true }).click();
    await dialog.getByRole("button", { name: "Close pen colours", exact: true }).click();
    await pushRendererEvent(electronApp, "menu:saveLayout", undefined);
    await expect.poll(() => JSON.parse(fs.readFileSync(savedPath, "utf8")).imports.length).toBe(1);
    const saved = JSON.parse(fs.readFileSync(savedPath, "utf8"));
    expect(saved.layerGroups.find((pen: { name: string }) => pen.name === "Yellow").importIds).toContain(saved.imports[0].id);
    await window.screenshot({ path: "test-results/page-and-pen-colours.png" });

    // Reopen over an existing canvas, exercising the replacement confirmation.
    await mockIpcInvoke(electronApp, "fs:openLayoutDialog", savedPath);
    await pushRendererEvent(electronApp, "menu:openLayout", undefined);
    await window.getByRole("button", { name: "Replace", exact: true }).click();
    await window.getByRole("button", { name: "Page colour", exact: true }).click();
    await expect(window.getByLabel("Page colour hex code", { exact: true })).toHaveValue("#ddeeff");
    await window.getByRole("button", { name: "Black (#000000)", exact: true }).click();
    await window.keyboard.press("Control+z");
    await window.getByRole("button", { name: "Page colour", exact: true }).click();
    await expect(window.getByLabel("Page colour hex code", { exact: true })).toHaveValue("#ddeeff");
  } finally {
    await closeApp(electronApp, userDataDir);
  }
});
