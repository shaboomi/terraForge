import { test, expect } from "@playwright/test";
import type { ElectronApplication, Page } from "playwright";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { launchApp, closeApp, mockOpenDialog } from "./helpers";

type Handle = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";
type Point = { x: number; y: number };
const opposite: Record<Handle, Handle> = {
  tl: "br", t: "b", tr: "bl", r: "l", br: "tl", b: "t", bl: "tr", l: "r",
};
const corners = ["tl", "tr", "br", "bl"] as const;
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

async function point(window: Page, handle: Handle): Promise<Point> {
  const box = await window.getByTestId(`handle-scale-${handle}`).boundingBox();
  expect(box, `${handle} resize handle is visible`).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

async function geometry(window: Page) {
  const [tl, tr, br, bl] = await Promise.all(corners.map((handle) => point(window, handle)));
  return { tl, tr, br, bl, width: distance(tl, tr), height: distance(tr, br) };
}

async function selectArtwork(window: Page) {
  await window.locator("span[title='Double-click to rename']").first().click();
  await expect(window.getByTestId("handle-scale-tl")).toBeVisible();
}

async function changeField(window: Page, selector: string, value: number) {
  const field = window.locator(selector);
  await field.fill(String(value));
  await field.press("Tab");
}

async function dragTo(window: Page, from: Point, to: Point, ctrl = false) {
  await window.mouse.move(from.x, from.y);
  if (ctrl) await window.keyboard.down("Control");
  await window.mouse.down();
  await window.mouse.move(to.x, to.y, { steps: 8 });
  await window.mouse.up();
  if (ctrl) await window.keyboard.up("Control");
}

async function undo(window: Page) {
  await window.keyboard.press("Control+z");
  await selectArtwork(window);
}

function assertSameGeometry(actual: Awaited<ReturnType<typeof geometry>>, expected: Awaited<ReturnType<typeof geometry>>) {
  for (const handle of corners) expect(distance(actual[handle], expected[handle])).toBeLessThan(0.6);
}

function assertDimensions(actual: { width: number; height: number }, before: { width: number; height: number }, widthFactor: number, heightFactor = widthFactor) {
  // Native MouseEvent client coordinates are integral, while SVG handle centres are subpixel.
  expect(Math.abs(actual.width - before.width * widthFactor)).toBeLessThan(1.5);
  expect(Math.abs(actual.height - before.height * heightFactor)).toBeLessThan(1.5);
}

let electronApp: ElectronApplication;
let window: Page;
let userDataDir: string;

test.beforeEach(async () => {
  ({ electronApp, window, userDataDir } = await launchApp());
  const svgPath = path.join(userDataDir, "resize-artwork.svg");
  writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40"><path d="M2 2H58V38H2Z M10 30L30 8L50 30 M20 30H40" fill="none" stroke="#38bdf8" stroke-width="1"/></svg>');
  await mockOpenDialog(electronApp, svgPath);
  await window.getByRole("button", { name: "Import", exact: true }).click();
  await expect(window.getByText("resize-artwork", { exact: true }).first()).toBeVisible();
  await selectArtwork(window);
  await changeField(window, "#numfield-x-mm", 100);
  await changeField(window, "#numfield-y-mm", 100);
});

test.afterEach(async () => {
  if (electronApp) await closeApp(electronApp, userDataDir);
});

for (const [rotation, zoomSteps] of [[0, -1], [37, 1], [90, 0], [180, -1], [270, 1]] as const) {
  test(`corners preserve proportions and opposite anchors at ${rotation} degrees, zoom step ${zoomSteps}`, async ({}, testInfo) => {
    await changeField(window, "#numfield-rotation", rotation);
    if (zoomSteps) await window.getByRole("button", { name: zoomSteps > 0 ? "Zoom in" : "Zoom out", exact: true }).click();
    const original = await geometry(window);
    const nominalAngles: Record<Handle, number> = { tl: 45, t: 90, tr: 135, r: 0, br: 45, b: 90, bl: 135, l: 0 };
    const cursors = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
    for (const handle of Object.keys(opposite) as Handle[]) {
      const bucket = ((Math.round((nominalAngles[handle] + rotation) / 45) % 4) + 4) % 4;
      await expect(window.getByTestId(`handle-scale-${handle}`)).toHaveCSS("cursor", cursors[bucket]);
    }
    for (const handle of corners) {
      const start = await point(window, handle);
      const anchor = await point(window, opposite[handle]);
      // Move directly away from the opposite corner, in screen coordinates.
      await dragTo(window, start, { x: start.x + (start.x - anchor.x) * 0.25, y: start.y + (start.y - anchor.y) * 0.25 });
      const enlarged = await geometry(window);
      assertDimensions(enlarged, original, 1.25);
      expect(enlarged.width / enlarged.height).toBeCloseTo(original.width / original.height, 3);
      expect(distance(await point(window, opposite[handle]), anchor)).toBeLessThan(0.6);
      if (handle === "tr" && rotation === 90) {
        const screenshot = await window.screenshot({ path: "test-results/artwork-resize-90-locked.png" });
        await testInfo.attach("90 degree locked resize", { body: screenshot, contentType: "image/png" });
      }
      await undo(window);
      assertSameGeometry(await geometry(window), original);
      // A single gesture is one Undo entry and can be restored with keyboard Redo.
      await window.keyboard.press("Control+Shift+z");
      await selectArtwork(window);
      assertSameGeometry(await geometry(window), enlarged);
      await undo(window);
      const inwardStart = await point(window, handle);
      await dragTo(window, inwardStart, { x: anchor.x + (inwardStart.x - anchor.x) * 0.8, y: anchor.y + (inwardStart.y - anchor.y) * 0.8 });
      const shrunk = await geometry(window);
      assertDimensions(shrunk, original, 0.8);
      expect(shrunk.width / shrunk.height).toBeCloseTo(original.width / original.height, 3);
      expect(distance(await point(window, opposite[handle]), anchor)).toBeLessThan(0.6);
      await undo(window);
      assertSameGeometry(await geometry(window), original);
    }
  });
}

test("Ctrl freely scales rotated artwork, then the next gesture locks its existing unequal proportions", async ({}, testInfo) => {
  await changeField(window, "#numfield-rotation", 90);
  const before = await geometry(window);
  const anchor = await point(window, "bl");
  const start = await point(window, "tr");
  // At the top-right corner after 90 degrees, outward width points down and height points right.
  await dragTo(window, start, { x: start.x + before.height * 0.2, y: start.y + before.width * 0.5 }, true);
  const free = await geometry(window);
  assertDimensions(free, before, 1.5, 1.2);
  expect(distance(await point(window, "bl"), anchor)).toBeLessThan(0.6);
  const freeScreenshot = await window.screenshot({ path: "test-results/artwork-resize-90-ctrl-free.png" });
  await testInfo.attach("Ctrl free scaling", { body: freeScreenshot, contentType: "image/png" });

  const nextStart = await point(window, "tr");
  await dragTo(window, nextStart, { x: anchor.x + (nextStart.x - anchor.x) * 1.2, y: anchor.y + (nextStart.y - anchor.y) * 1.2 });
  const locked = await geometry(window);
  assertDimensions(locked, free, 1.2);
  expect(locked.width / locked.height).toBeCloseTo(free.width / free.height, 3);
  expect(distance(await point(window, "bl"), anchor)).toBeLessThan(0.6);
  const lockedScreenshot = await window.screenshot({ path: "test-results/artwork-resize-unequal-ratio-locked.png" });
  await testInfo.attach("Existing proportions stay locked", { body: lockedScreenshot, contentType: "image/png" });
  await undo(window);
  assertSameGeometry(await geometry(window), free);
  await undo(window);
  assertSameGeometry(await geometry(window), before);
  await window.keyboard.press("Control+y");
  await selectArtwork(window);
  assertSameGeometry(await geometry(window), free);
});

test("all rotated edge handles follow their local axis and keep the opposite edge fixed under Ctrl", async () => {
  await changeField(window, "#numfield-rotation", 37);
  const original = await geometry(window);
  for (const handle of ["t", "r", "b", "l"] as Handle[]) {
    const start = await point(window, handle);
    const anchor = await point(window, opposite[handle]);
    await dragTo(window, start, { x: start.x + (start.x - anchor.x) * 0.2, y: start.y + (start.y - anchor.y) * 0.2 }, true);
    const enlarged = await geometry(window);
    assertDimensions(enlarged, original, handle === "l" || handle === "r" ? 1.2 : 1, handle === "t" || handle === "b" ? 1.2 : 1);
    expect(distance(await point(window, opposite[handle]), anchor)).toBeLessThan(0.6);
    await undo(window);
    assertSameGeometry(await geometry(window), original);
  }
});
