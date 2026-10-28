import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginInput, PluginParameters, PluginPolyline, PluginResult } from "../../src/types";
import { PLUGIN_LIMITS, parsePluginSource, pluginResultItems, validatePluginParameters, validatePluginResult, validatePluginRunRequest } from "../../src/types/pluginValidation";

const source = readFileSync(resolve(process.cwd(), "docs/examples/spiral-sawtooth.tf-plugin.js"), "utf8");
const manifest = parsePluginSource(source);
// Execute this repository-owned distributable itself, rather than a separate algorithm fixture.
const run = new Function(source.replace(/export default (?:async )?function run/, "return function run"))() as
  (input: PluginInput, parameters: PluginParameters, context: PluginContext) => PluginResult;
const defaults = validatePluginParameters(manifest, {});
type Bitmap = Extract<PluginInput, { kind: "bitmap" }>;
type Pixel = readonly [number, number, number, number];
const black: Pixel = [0, 0, 0, 255];
const white: Pixel = [255, 255, 255, 255];

function bitmap(width = 80, height = 60, pixel: (x: number, y: number) => Pixel = () => black): Bitmap {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { kind: "bitmap", sourceId: "source", width, height, widthPx: width, heightPx: height, data,
    page: { widthMM: 420, heightMM: 297 },
    placement: { x: 23, y: -14, scale: 0.4, scaleX: 0.31, scaleY: 0.68, rotation: 37 },
    palette: [] };
}

function context(signal = new AbortController().signal): PluginContext {
  return { runId: "spiral-test", signal, progress: vi.fn(), seed: 123 };
}

function generate(input: Bitmap, changes: PluginParameters = {}, runtime = context()) {
  const parameters = validatePluginParameters(manifest, { ...defaults, ...changes });
  const request = validatePluginRunRequest({ runId: runtime.runId, pluginId: manifest.id, input, parameters, seed: runtime.seed });
  const result = validatePluginResult(run(request.input, parameters, runtime), request, manifest);
  const items = pluginResultItems(result);
  expect(items).toHaveLength(1);
  const item = items[0];
  if (item.kind !== "vector") throw new Error("Spiral Sawtooth must return editable vectors.");
  return { result, item, paths: item.paths, runtime };
}

function segments(paths: PluginPolyline[]) {
  return paths.flatMap((path) => path.points.slice(1).map((point, index) => [path.points[index], point] as const));
}

function length(paths: PluginPolyline[]) {
  return segments(paths).reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0);
}

function points(paths: PluginPolyline[]) {
  return paths.flatMap((path) => path.points);
}

describe("Spiral Sawtooth distributable", () => {
  it("declares the Stage 3 bitmap/vector contract and understandable defaults", () => {
    expect(manifest).toMatchObject({ id: "terraforge.spiral-sawtooth", name: "Spiral Sawtooth", version: "1.0.0",
      apiVersion: 1, category: "bitmap-processor", input: "bitmap", outputs: ["vector"] });
    expect(defaults).toMatchObject({ ringSpacing: 4, amplitude: 0.9, detail: 1, centreX: 50, centreY: 50,
      extent: 100, direction: "clockwise", contrast: 1, gamma: 1, invert: false, skipLight: true,
      lightThreshold: 95, connected: true, colourMode: "single", colour: "#000000" });
    expect(manifest.controls!.length).toBeLessThanOrEqual(PLUGIN_LIMITS.controls);
    expect(manifest.controls!.some((control) => /velocity|feed|speed/i.test(control.key))).toBe(false);
  });

  it("returns finite editable paths within the complete rectangular source frame", () => {
    const input = bitmap(97, 41);
    const { item, paths } = generate(input);
    expect(item).toMatchObject({ kind: "vector", width: 97, height: 41 });
    expect(paths.length).toBeGreaterThan(0);
    expect(paths.length).toBeLessThanOrEqual(PLUGIN_LIMITS.paths);
    expect(points(paths).length).toBeLessThanOrEqual(PLUGIN_LIMITS.points);
    for (const path of paths) {
      expect(path.points.length).toBeGreaterThanOrEqual(2);
      expect(path.closed ?? false).toBe(false);
      expect(path.color).toBe("#000000");
      expect(path.penId).toBeUndefined();
    }
    for (const point of points(paths)) {
      expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(97);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeLessThanOrEqual(41);
    }
  });

  it("makes opaque black denser than mid-grey and white with skipping disabled", () => {
    const dark = generate(bitmap(), { skipLight: false });
    const grey = generate(bitmap(80, 60, () => [128, 128, 128, 255]), { skipLight: false });
    const light = generate(bitmap(80, 60, () => white), { skipLight: false });
    expect(length(dark.paths)).toBeGreaterThan(length(grey.paths) * 1.1);
    expect(length(grey.paths)).toBeGreaterThan(length(light.paths) * 1.1);
  });

  it("reports blank white output without returning an incomplete or empty result", () => {
    expect(() => generate(bitmap(80, 60, () => white))).toThrow(/no .*|empty|nothing|white|threshold/i);
    expect(generate(bitmap(80, 60, () => white), { invert: true }).paths.length).toBeGreaterThan(0);
    expect(() => generate(bitmap(), { invert: true })).toThrow(/no .*|empty|nothing|white|threshold/i);
  });

  it("reproduces a gradient with more mark length in the dark half", () => {
    const input = bitmap(96, 64, (x) => {
      const value = Math.round(x * 255 / 95);
      return [value, value, value, 255];
    });
    const { paths } = generate(input, { skipLight: false });
    let darkLength = 0;
    let lightLength = 0;
    for (const [a, b] of segments(paths)) {
      const middle = (a.x + b.x) / 2;
      const distance = Math.hypot(b.x - a.x, b.y - a.y);
      if (middle < 48) darkLength += distance;
      else lightLength += distance;
    }
    expect(darkLength).toBeGreaterThan(lightLength * 1.15);
    expect(generate(input, { gamma: 1.8, contrast: 1.4 }).result).not.toEqual(generate(input).result);
  });

  it("adjusts ring spacing, tooth detail and amplitude independently", () => {
    const input = bitmap(96, 80);
    const normal = generate(input);
    expect(length(generate(input, { ringSpacing: 2 }).paths)).toBeGreaterThan(length(normal.paths));
    expect(points(generate(input, { detail: 2 }).paths).length).toBeGreaterThan(points(normal.paths).length);
    expect(length(generate(input, { amplitude: 0.3 }).paths)).toBeLessThan(length(normal.paths));
  });

  it("keeps source pixels, palette, position, rotation and unequal scales untouched", () => {
    const input = bitmap();
    input.palette = [{ id: "black-pen", name: "Black", color: "#000000" }];
    const before = structuredClone({ ...input, data: Array.from(input.data) });
    run(input, defaults, context());
    const local = generate(input).result;
    const moved = { ...input, placement: { x: 120, y: 75, scale: 0.5, scaleX: 1.7, scaleY: 0.2, rotation: 123 } };
    expect(generate(moved).result).toEqual(local);
    expect({ ...input, data: Array.from(input.data) }).toEqual(before);
  });

  it("retains empty transparent margins instead of cropping the output frame", () => {
    const input = bitmap(96, 70, (x, y) => x >= 24 && x < 72 && y >= 18 && y < 52 ? black : [0, 0, 0, 0]);
    const { item, paths } = generate(input);
    expect(item).toMatchObject({ width: 96, height: 70 });
    for (const point of points(paths)) {
      expect(point.x).toBeGreaterThan(22);
      expect(point.x).toBeLessThan(74);
      expect(point.y).toBeGreaterThan(16);
      expect(point.y).toBeLessThan(54);
    }
  });

  it.each([{ invert: false, skipLight: false }, { invert: true, skipLight: false }, { invert: true, skipLight: true }])(
    "never draws fully transparent pixels even with inversion and settings %j", (settings) => {
      const input = bitmap(64, 48, () => [0, 0, 0, 0]);
      expect(() => generate(input, settings)).toThrow(/no .*|empty|nothing|transparent|threshold/i);
    },
  );

  it("composites partial alpha over white consistently for tone sampling", () => {
    const opaque = generate(bitmap(), { skipLight: false });
    const partial = generate(bitmap(80, 60, () => [0, 0, 0, 128]), { skipLight: false });
    const composited = generate(bitmap(80, 60, () => [127, 127, 127, 255]), { skipLight: false });
    expect(length(partial.paths)).toBeLessThan(length(opaque.paths));
    expect(points(partial.paths).length).toBe(points(composited.paths).length);
    expect(length(partial.paths)).toBeCloseTo(length(composited.paths), 7);
  });

  it.each(["light", "transparent"])("splits connected paths at a one-pixel %s exclusion", (kind) => {
    const input = bitmap(64, 56, (x) => x === 31 ? (kind === "light" ? white : [0, 0, 0, 0]) : black);
    const { paths } = generate(input, { ringSpacing: 3, amplitude: 1.8 });
    expect(paths.length).toBeGreaterThan(2);
    for (const [a, b] of segments(paths)) {
      // The inner part of the excluded pixel cannot be crossed by a connecting stroke.
      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      expect(minX < 31.2 && maxX > 31.8).toBe(false);
    }
  });

  it("makes the light-area threshold adjustable without altering geometry density controls", () => {
    const input = bitmap(80, 60, () => [200, 200, 200, 255]);
    expect(generate(input, { lightThreshold: 95 }).paths.length).toBeGreaterThan(0);
    expect(() => generate(input, { lightThreshold: 50 })).toThrow(/no .*|empty|nothing|threshold/i);
  });

  it("uses real pen IDs sampled from original colours and preserves supplied pen ordering", () => {
    const input = bitmap(80, 60, (x) => x < 40 ? [255, 0, 0, 255] : [0, 0, 255, 255]);
    input.palette = [{ id: "blue-real", name: "Blue", color: "#0000ff" }, { id: "red-real", name: "Red", color: "#ff0000" }];
    const before = structuredClone(input.palette);
    run(input, { ...defaults, colourMode: "pens", invert: true, skipLight: false }, context());
    const { paths } = generate(input, { colourMode: "pens", invert: true, skipLight: false });
    expect(new Set(paths.map((path) => path.penId))).toEqual(new Set(["red-real", "blue-real"]));
    for (const path of paths) {
      expect(path.color).toBe(path.penId === "red-real" ? "#ff0000" : "#0000ff");
      for (const [a, b] of segments([path])) {
        const midpoint = (a.x + b.x) / 2;
        if (midpoint < 38) expect(path.penId).toBe("red-real");
        if (midpoint > 42) expect(path.penId).toBe("blue-real");
      }
    }
    expect(input.palette).toEqual(before);
  });

  it("uses the selected single colour without inventing pen identities", () => {
    const input = bitmap();
    input.palette = [{ id: "red-real", name: "Red", color: "#ff0000" }];
    const { paths } = generate(input, { colour: "#26814f" });
    expect(paths.every((path) => path.color === "#26814f" && path.penId === undefined)).toBe(true);
  });

  it("explains a missing pen palette and keeps palette order as the colour-match tie breaker", () => {
    const input = bitmap();
    expect(() => generate(input, { colourMode: "pens" })).toThrow(/configured pen|add pens/i);
    input.palette = [{ id: "first", name: "First black", color: "#000000" }, { id: "second", name: "Second black", color: "#000000" }];
    expect(generate(input, { colourMode: "pens" }).paths.every((path) => path.penId === "first")).toBe(true);
    input.palette.reverse();
    expect(generate(input, { colourMode: "pens" }).paths.every((path) => path.penId === "second")).toBe(true);
  });

  it("matches fractional alpha colours independently even when their rounded RGB is identical", () => {
    const input = bitmap(80, 60, (x) => x < 40 ? [130, 0, 130, 1] : [130, 0, 140, 1]);
    input.palette = [{ id: "warm", name: "Warm white", color: "#fffefe" },
      { id: "cool", name: "Cool white", color: "#fefeff" }];
    const { paths } = generate(input, { colourMode: "pens", skipLight: false });
    expect(new Set(paths.map((path) => path.penId))).toEqual(new Set(["warm", "cool"]));
    for (const path of paths) for (const [a, b] of segments([path])) {
      expect(path.penId).toBe((a.x + b.x) / 2 < 40 ? "warm" : "cool");
    }
  });

  it("retains continuity inside the frame and disconnects teeth when requested", () => {
    const input = bitmap(96, 96);
    const connected = generate(input, { extent: 45 });
    const disconnected = generate(input, { extent: 45, connected: false });
    expect(connected.paths).toHaveLength(1);
    expect(disconnected.paths.length).toBeGreaterThan(connected.paths.length);
    expect(length(disconnected.paths)).toBeCloseTo(length(connected.paths), 6);
  });

  it("changes spiral direction and extent while keeping an off-centre spiral in frame", () => {
    const input = bitmap(101, 59);
    const short = generate(input, { centreX: 18, centreY: 72, extent: 35 });
    const full = generate(input, { centreX: 18, centreY: 72, extent: 100 });
    expect(length(full.paths)).toBeGreaterThan(length(short.paths));
    const direction = manifest.controls!.find((control) => control.key === "direction");
    if (direction?.type !== "select") throw new Error("Expected direction choice.");
    const reverse = direction.options.find((option) => option.value !== defaults.direction)!.value;
    expect(generate(input, { direction: reverse }).result).not.toEqual(generate(input).result);
    const centred = bitmap(96, 96);
    const winding = (paths: PluginPolyline[]) => segments(paths).reduce((sum, [a, b]) =>
      sum + (a.x - 48) * (b.y - 48) - (a.y - 48) * (b.x - 48), 0);
    expect(winding(generate(centred, { extent: 45 }).paths)).toBeGreaterThan(0);
    expect(winding(generate(centred, { extent: 45, direction: reverse }).paths)).toBeLessThan(0);
    for (const point of points(full.paths)) {
      expect(point.x >= 0 && point.x <= 101 && point.y >= 0 && point.y <= 59).toBe(true);
    }
  });

  it("clips crossing segments rather than clamping outside points onto the frame edges", () => {
    const input = bitmap(103, 43);
    const { paths } = generate(input, { centreX: 17, centreY: 73, amplitude: 1.8 });
    let boundaryEndpoints = 0;
    const atEdge = (point: { x: number; y: number }) => point.x === 0 || point.x === input.width || point.y === 0 || point.y === input.height;
    for (const path of paths) {
      boundaryEndpoints += Number(atEdge(path.points[0])) + Number(atEdge(path.points[path.points.length - 1]));
      expect(path.points.slice(1, -1).some(atEdge)).toBe(false);
      for (const [a, b] of segments([path])) {
        const sameVerticalEdge = a.x === b.x && (a.x === 0 || a.x === input.width);
        const sameHorizontalEdge = a.y === b.y && (a.y === 0 || a.y === input.height);
        expect((sameVerticalEdge || sameHorizontalEdge) && Math.hypot(b.x - a.x, b.y - a.y) > 1e-7).toBe(false);
      }
    }
    expect(boundaryEndpoints).toBeGreaterThan(0);
  });

  it("is deterministic and reports bounded monotonic progress through completion", () => {
    const input = bitmap();
    const first = generate(input);
    expect(generate(input).result).toEqual(first.result);
    const updates = vi.mocked(first.runtime.progress).mock.calls.map(([value]) => value).filter((value): value is number => value !== null);
    expect(updates.length).toBeGreaterThan(0);
    expect(updates[updates.length - 1]).toBe(100);
    expect(updates.every((value, index) => value >= 0 && value <= 100 && (index === 0 || value >= updates[index - 1]))).toBe(true);
    expect(updates.length).toBeLessThan(500);
  });

  it("cancels before generation and cooperatively during a run without changing input", () => {
    const input = bitmap(128, 96);
    const before = new Uint8Array(input.data);
    const stopped = new AbortController();
    stopped.abort();
    expect(() => generate(input, {}, context(stopped.signal))).toThrow(/cancel|abort/i);
    const controller = new AbortController();
    const runtime = context(controller.signal);
    runtime.progress = vi.fn((value) => { if (value !== null && value >= 10) controller.abort(); });
    expect(() => generate(input, {}, runtime)).toThrow(/cancel|abort/i);
    expect(vi.mocked(runtime.progress).mock.calls.some(([value]) => value !== null && value >= 10)).toBe(true);
    expect(input.data).toEqual(before);
  });

  it("refuses an elapsed runtime deadline instead of returning the spiral calculated so far", () => {
    let elapsed = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => elapsed);
    const runtime = context();
    runtime.progress = vi.fn((value) => { if (value !== null && value >= 10) elapsed = PLUGIN_LIMITS.executionMs; });
    try {
      expect(() => generate(bitmap(128, 96), {}, runtime)).toThrow(/time budget.*no partial/i);
      expect(vi.mocked(runtime.progress).mock.calls.some(([value]) => value !== null && value >= 10)).toBe(true);
      expect(vi.mocked(runtime.progress).mock.calls.some(([value]) => value === 100)).toBe(false);
    } finally {
      clock.mockRestore();
    }
  });

  it.each([
    { width: 512, height: 512, parameters: { ringSpacing: 4, detail: 2, connected: true } },
    { width: 256, height: 256, parameters: { ringSpacing: 4, detail: 1, connected: false } },
  ])("refuses actual output overflow without delivering an incomplete result: %j", ({ width, height, parameters }) => {
    const runtime = context();
    expect(() => generate(bitmap(width, height), parameters, runtime)).toThrow(/detail budget.*no partial/i);
    // These moderate requests must begin traversal, reaching the actual point/path
    // accounting rather than the early estimate used for extreme configurations.
    expect(vi.mocked(runtime.progress).mock.calls.some(([value]) => value !== null && value > 0)).toBe(true);
    expect(vi.mocked(runtime.progress).mock.calls.some(([value]) => value === 100)).toBe(false);
  });

  it("rejects excessive work with an actionable error instead of truncating the spiral", () => {
    const spacing = manifest.controls!.find((control) => control.key === "ringSpacing");
    const detail = manifest.controls!.find((control) => control.key === "detail");
    if (!spacing || !detail || !("min" in spacing) || !("max" in detail)) throw new Error("Expected detail bounds.");
    expect(() => generate(bitmap(512, 512), { ringSpacing: spacing.min, detail: detail.max })).toThrow(/limit|budget|too .*|increase|reduce/i);
  });
});
