import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginInput, PluginParameters, PluginResult, PluginOutputItem } from "../../src/types";
import { DEFAULT_BITMAP_PREPARATION, preparePluginBitmap } from "../../src/types/pluginBitmapPreparation";
import { parsePluginSource, pluginResultItems, validatePluginParameters, validatePluginResult, validatePluginRunRequest } from "../../src/types/pluginValidation";
import { pluginMenuCategories } from "../../src/renderer/src/features/plugins/pluginMenuGroups";

const source = readFileSync(resolve("docs/examples/comic-ink-vectorizer.tf-plugin.js"), "utf8");
const manifest = parsePluginSource(source);
const defaults = validatePluginParameters(manifest, {});
const run = new Function(source.replace("export default async function run", "return async function run"))() as
  (input: PluginInput, parameters: PluginParameters, context: PluginContext) => Promise<PluginResult>;
type Bitmap = Extract<PluginInput, { kind: "bitmap" }>;
type PluginVectorItem = Extract<PluginOutputItem, { kind: "vector" }>;
type Pixel = [number, number, number, number];
async function bitmap(width = 64, height = 48, pixel: (x: number, y: number) => Pixel = (x, y) =>
  x < 20 ? [190, 75, 50, 255] : x > 44 ? [30, 30, 30, 255] : [120 + y, 140, 160, 255]): Promise<Bitmap> {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  const input: Bitmap = { kind: "bitmap", sourceId: "photo", width, height, widthPx: width, heightPx: height, data,
    page: { widthMM: 420, heightMM: 297 }, palette: [], placement: { x: 25, y: -17, scale: 0.5, scaleX: 0.7, scaleY: 1.3, rotation: 37 } };
  input.prepared = await preparePluginBitmap(input, { ...DEFAULT_BITMAP_PREPARATION, palette: [] });
  return input;
}
function context(): PluginContext { return { runId: "comic-test", signal: new AbortController().signal, seed: 123, progress: vi.fn() }; }
async function generate(input: Bitmap, changes: PluginParameters = {}, runtime = context()) {
  const parameters = validatePluginParameters(manifest, { ...defaults, ...changes });
  const request = validatePluginRunRequest({ runId: runtime.runId, pluginId: manifest.id, input, parameters, seed: runtime.seed });
  const result = validatePluginResult(await run(input, parameters, runtime), request, manifest);
  const items = pluginResultItems(result) as PluginVectorItem[];
  return { result, items, runtime };
}
const paths = (items: PluginVectorItem[]) => items.flatMap(item => item.paths);
const named = (items: PluginVectorItem[], name: string) => items.find(item => item.name === name)?.paths ?? [];
const length = (items: PluginVectorItem[], name: string) => named(items, name).reduce((sum, p) => sum + p.points.slice(1).reduce((s, pt, i) => s + Math.hypot(pt.x - p.points[i].x, pt.y - p.points[i].y), 0), 0);

describe("Comic Ink Vectorizer distributable", () => {
  it("registers native bitmap-to-vector discovery and supported controls", () => {
    expect(manifest).toMatchObject({ id: "terraforge.comic-ink-vectorizer", bitmapPreparation: true, input: "bitmap", outputs: ["vector"] });
    expect(pluginMenuCategories(manifest)).toEqual(["bitmap-to-vector"]);
    expect(manifest.controls!.length).toBeLessThanOrEqual(32);
    expect(defaults).toMatchObject({ paletteSize: 5, preset: "clean", background: "skip-white", inkPen: "" });
  });

  it("returns deterministic, named colour, outline, shadow and hatch geometry", async () => {
    const input = await bitmap();
    const a = await generate(input), b = await generate(input);
    expect(a.result).toEqual(b.result);
    expect(a.items.some(i => i.name!.startsWith("Colour "))).toBe(true);
    for (const name of ["Black outlines", "Black shadows", "Black hatching"]) expect(named(a.items, name).length).toBeGreaterThan(0);
    expect(new Set(a.items.map(i => i.name)).size).toBe(a.items.length);
    expect(a.items.length).toBeLessThanOrEqual(11);
    const progress = vi.mocked(a.runtime.progress).mock.calls.map(([value]) => value!);
    expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(100);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(paths(a.items).every(p => !p.penId)).toBe(true);
  });

  it("preserves pixels, prepared data, source placement and the full rectangular frame", async () => {
    const input = await bitmap(77, 31), before = JSON.stringify(input);
    const a = await generate(input);
    const moved = await generate({ ...input, placement: { x: -90, y: 110, scale: 0.4, scaleX: 1.6, scaleY: 0.2, rotation: 123 } });
    expect(moved.result).toEqual(a.result); expect(JSON.stringify(input)).toEqual(before);
    for (const item of a.items) {
      expect(item).toMatchObject({ width: 77, height: 31, kind: "vector" });
      for (const path of item.paths) {
        expect(path.points.length).toBeGreaterThanOrEqual(2);
        for (const pt of path.points) {
          expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true);
          expect(pt.x).toBeGreaterThanOrEqual(0); expect(pt.x).toBeLessThanOrEqual(77);
          expect(pt.y).toBeGreaterThanOrEqual(0); expect(pt.y).toBeLessThanOrEqual(31);
        }
      }
    }
  });

  it.each(["skip-white", "keep-white"])("preserves transparent margins, holes and one-pixel slits with %s", async background => {
    const input = await bitmap(64, 48, (x, y) => x < 4 || x >= 60 || y < 4 || y >= 44 || x === 31 || (x > 15 && x < 23 && y > 15 && y < 28) ? [0, 0, 0, 0] : [90, 100, 110, 255]);
    const { items } = await generate(input, { background, direction: "directional", crosshatch: true, pathTolerance: 1 });
    // Test interiors of every segment, including simplified curved hatches.
    for (const path of paths(items)) for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 8);
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) / steps, x = Math.floor(a.x + (b.x - a.x) * t), y = Math.floor(a.y + (b.y - a.y) * t);
        expect(input.data[(y * 64 + x) * 4 + 3]).toBe(255);
      }
    }
  });

  it("preserves a transparent one-source-pixel slit at reduced resolution", async () => {
    const input = await bitmap(128, 64, x => x === 63 ? [0, 0, 0, 0] : [30, 30, 30, 255]);
    const { items } = await generate(input, { resolution: 32, outline: 0, density: 0 });
    for (const path of paths(items)) for (let i = 1; i < path.points.length; i++) {
      expect(path.points[i - 1].x < 63 && path.points[i].x > 64).toBe(false);
    }
  });

  it("keeps white holes unfilled and supports explicit drawing of white and transparent compositing", async () => {
    const ring = await bitmap(48, 48, (x, y) => Math.hypot(x - 24, y - 24) < 8 ? [255, 255, 255, 255] : [30, 30, 30, 255]);
    const { items } = await generate(ring, { outline: 0, density: 0 });
    for (const path of paths(items)) {
      const [a, b] = path.points;
      if (Math.abs(a.y - 24) < 5) expect(a.x < 23 && b.x > 25).toBe(false);
    }
    const white = await bitmap(12, 9, () => [255, 255, 255, 255]);
    await expect(generate(white)).rejects.toThrow(/No visible|No drawable/);
    expect((await generate(white, { background: "keep-white", outline: 0 })).items[0].name).toContain("#ffffff");
    const transparent = await bitmap(12, 9, () => [0, 0, 0, 0]);
    await expect(generate(transparent)).rejects.toThrow(/No visible/);
    const drawn = await generate(transparent, { background: "white", outline: 0 });
    expect(drawn.items[0].name).toContain("#ffffff");
  });

  it("separates palette choices from actual pen assignments and reuses shared colours", async () => {
    const input = await bitmap();
    input.palette = [{ id: "rust", name: "Rust", color: "#be4b32" }, { id: "ink", name: "Black", color: "#000000" }];
    const pens = await generate(input, { paletteMode: "pens", inkPen: "ink" });
    for (const item of pens.items) {
      expect(item.penId).toBe(item.name!.startsWith("Black") ? "ink" : undefined);
      expect(item.paths.every(p => !p.penId)).toBe(true);
    }
    input.prepared!.settings.palette = ["#be4b32", "#8899aa"];
    const shared = await generate(input, { paletteMode: "shared" });
    expect(shared.items.filter(i => i.name!.startsWith("Colour")).every(i => /#be4b32|#8899aa/.test(i.name!))).toBe(true);
    await expect(generate(input, { inkPen: "missing" })).rejects.toThrow(/unavailable/);
    input.palette = []; await expect(generate(input, { paletteMode: "pens" })).rejects.toThrow(/Add real pens/);
    input.prepared!.settings.palette = []; await expect(generate(input, { paletteMode: "shared" })).rejects.toThrow(/Add colours/);
  });

  it("changes shadows and artistic hatching independently from colour coverage", async () => {
    const input = await bitmap();
    const normal = await generate(input), noShadow = await generate(input, { shadow: 0 }), noHatch = await generate(input, { density: 0 });
    expect(named(noShadow.items, "Black shadows")).toHaveLength(0);
    expect(named(noHatch.items, "Black hatching")).toHaveLength(0);
    expect(named(noHatch.items, "Black shadows")).toEqual(named(normal.items, "Black shadows"));
    expect(noHatch.items.filter(i => i.name!.startsWith("Colour"))).toEqual(normal.items.filter(i => i.name!.startsWith("Colour")));
    const grey = await bitmap(64, 48, () => [110, 110, 110, 255]);
    const a = await generate(grey), cross = await generate(grey, { crosshatch: true }), sparse = await generate(grey, { hatchSpacing: 12 });
    expect(length(cross.items, "Black hatching")).toBeGreaterThan(length(a.items, "Black hatching"));
    expect(length(sparse.items, "Black hatching")).toBeLessThan(length(a.items, "Black hatching"));
    const ink = await generate(grey, { output: "ink", direction: "fixed", angle: 0 });
    expect(ink.items.every(i => i.name!.startsWith("Black"))).toBe(true);
    expect(named(ink.items, "Black hatching").every(p => p.points.every(pt => Math.abs(pt.y - p.points[0].y) < 1e-7))).toBe(true);
  });

  it("uses disjoint outline and shadow coverage without duplicate black paths", async () => {
    const { items } = await generate(await bitmap());
    const black = items.filter(i => i.name!.startsWith("Black"));
    const keys = paths(black).map(p => JSON.stringify(p.points));
    expect(new Set(keys).size).toBe(keys.length);
    const outlines = named(items, "Black outlines"), shadows = named(items, "Black shadows");
    for (const outline of outlines) for (const shadow of shadows) {
      const [a, b] = outline.points, [c, d] = shadow.points;
      if (Math.abs(a.y - c.y) < 1e-8) expect(Math.min(b.x, d.x) - Math.max(a.x, c.x)).toBeLessThanOrEqual(1e-8);
    }
  });

  it("applies useful presets and minimum region cleanup", async () => {
    const input = await bitmap(64, 48, (x, y) => x === 32 && y === 24 ? [255, 0, 0, 255] : [90, 90, 90, 255]);
    const normal = await generate(input, { minFeature: 1 }), cleaned = await generate(input, { minFeature: 8 });
    expect(normal.result).not.toEqual(cleaned.result);
    const heavy = await generate(input, { preset: "heavy" }), fine = await generate(input, { preset: "fine" });
    expect(length(heavy.items, "Black outlines")).toBeGreaterThan(length(cleaned.items, "Black outlines"));
    expect(length(fine.items, "Black hatching")).toBeGreaterThan(length(cleaned.items, "Black hatching"));
  });

  it("honours cancellation at start and after measurable processing progress", async () => {
    const input = await bitmap(), controller = new AbortController(); controller.abort();
    await expect(generate(input, {}, { ...context(), signal: controller.signal })).rejects.toThrow(/cancelled/);
    const midway = new AbortController(), runtime = { ...context(), signal: midway.signal, progress: (p: number | null) => { if (p! >= 38) midway.abort(); } };
    await expect(generate(input, {}, runtime)).rejects.toThrow(/cancelled/);
  });

  it("refuses whole output at path, point and execution allowances with actionable errors", async () => {
    const input = await bitmap();
    for (const limits of [{ paths: 3, points: 100000, executionMs: 30000 }, { paths: 10000, points: 4, executionMs: 30000 }]) {
      await expect(generate(input, {}, { ...context(), limits })).rejects.toThrow(/complete comic.*capacity.*Lower.*Extended/);
    }
    await expect(generate(input, {}, { ...context(), limits: { paths: 10000, points: 100000, executionMs: 0.001 } })).rejects.toThrow(/time allowance/);
  });

  it.each([[1, 1], [2, 3], [97, 11]])("handles uniform and very small %s × %s images", async (w, h) => {
    const generated = await generate(await bitmap(w, h, () => [0, 0, 0, 255]));
    expect(paths(generated.items).length).toBeGreaterThan(0);
  });

  it("bounds complete noisy photographs without silently discarding artwork", async () => {
    const input = await bitmap(96, 80, (x, y) => [(x * 73 + y * 41) % 256, (x * 19 + y * 37) % 256, (x * 31 + y * 61) % 256, 255]);
    const { items } = await generate(input, { resolution: 64 });
    expect(paths(items).length).toBeLessThanOrEqual(10000);
    expect(paths(items).reduce((n, p) => n + p.points.length, 0)).toBeLessThanOrEqual(100000);
  });

  it("separates palette size and ink thresholds, and honours zero ink controls in every preset", async () => {
    const input = await bitmap();
    const two = await generate(input, { paletteSize: 2 }), five = await generate(input);
    expect(two.items.filter(i => i.name!.startsWith("Colour")).length).toBeLessThanOrEqual(2);
    expect(five.items.filter(i => i.name!.startsWith("Colour")).length).toBeGreaterThan(2);
    const grey = await bitmap(32, 24, () => [80, 80, 80, 255]);
    const low = await generate(grey, { shadow: 40 }), high = await generate(grey, { shadow: 100 });
    expect(length(high.items, "Black shadows")).toBeGreaterThan(length(low.items, "Black shadows"));
    const denser = await generate(grey, { shadow: 100, blackSpacing: 0.25 });
    expect(length(denser.items, "Black shadows")).toBeGreaterThan(length(high.items, "Black shadows"));
    for (const preset of ["clean", "heavy", "fine"]) {
      const off = await generate(grey, { preset, shadow: 0, density: 0, outline: 0 });
      expect(off.items.every(i => i.name!.startsWith("Colour"))).toBe(true);
    }
  });

  it("composites partial alpha exactly once and rejects unavailable preparation / oversized palettes", async () => {
    const translucent = await bitmap(20, 16, () => [0, 0, 0, 128]);
    const composited = await bitmap(20, 16, () => [127, 127, 127, 255]);
    expect((await generate(translucent)).items).toEqual((await generate(composited)).items);
    const noPreparation = { ...composited, prepared: undefined };
    await expect(run(noPreparation, defaults, context())).rejects.toThrow(/shared bitmap preparation/);
    composited.palette = ["#ff0000", "#00ff00", "#0000ff"].map((color, i) => ({ id: `pen-${i}`, name: `Pen ${i}`, color }));
    await expect(generate(composited, { paletteMode: "pens", paletteSize: 2 })).rejects.toThrow(/more colours than Palette size/);
  });

  it("keeps artistic hatch segments out of known deep shadows and silhouette bands", async () => {
    const input = await bitmap(64, 48, x => x < 32 ? [110, 110, 110, 255] : [20, 20, 20, 255]);
    const { items } = await generate(input, { crosshatch: true, pathTolerance: 1 });
    expect(named(items, "Black hatching").length).toBeGreaterThan(0);
    for (const path of named(items, "Black hatching")) for (const point of path.points) {
      expect(point.x).toBeGreaterThanOrEqual(1); expect(point.x).toBeLessThanOrEqual(31);
      expect(point.y).toBeGreaterThanOrEqual(1); expect(point.y).toBeLessThanOrEqual(47);
    }
  });
});
