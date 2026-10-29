import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginInput, PluginParameters, PluginPolyline, PluginResult } from "../../src/types";
import { parsePluginSource, pluginExecutionLimits, validatePluginParameters, validatePluginResult } from "../../src/types/pluginValidation";

const slugs = ["flowing-ribbons", "wave-volume", "organic-contours"];
const input: PluginInput = { kind: "none", page: { widthMM: 210, heightMM: 297 }, palette: [
  { id: "ink-c", name: "First", color: "#0088aa" }, { id: "ink-a", name: "Second", color: "#bb2200" }, { id: "ink-b", name: "Third", color: "#443388" },
] };
function load(slug: string) {
  const source = readFileSync(resolve(`docs/examples/${slug}.tf-plugin.js`), "utf8");
  const manifest = parsePluginSource(source);
  const run = new Function(source.replace("export default async function run", "return async function run"))() as
    (input: PluginInput, p: PluginParameters, context: PluginContext) => Promise<PluginResult>;
  return { source, manifest, run, defaults: validatePluginParameters(manifest, {}) };
}
function context(overrides: Partial<PluginContext> = {}): PluginContext {
  return { runId: "sculptural-unit", signal: new AbortController().signal, seed: 1, progress: vi.fn(), limits: pluginExecutionLimits(), ...overrides };
}
function vector(result: PluginResult) {
  if (!("paths" in result)) throw new Error("Expected legacy vector output");
  return result;
}
function geometry(result: PluginResult) { return vector(result).paths.map(p => ({ points: p.points, closed: p.closed })); }
function area(path: PluginPolyline) {
  return Math.abs(path.points.reduce((sum, p, i, points) => { const n = points[(i + 1) % points.length]; return sum + p.x * n.y - p.y * n.x; }, 0) / 2);
}
const cross = (a: {x: number; y: number}, b: {x: number; y: number}, c: {x: number; y: number}) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function intersects(a: {x: number; y: number}, b: {x: number; y: number}, c: {x: number; y: number}, d: {x: number; y: number}) {
  return cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12;
}
function contains(path: PluginPolyline, point: {x: number; y: number}) {
  let inside = false;
  for (let i = 0, j = path.points.length - 1; i < path.points.length; j = i++) {
    const a = path.points[i], b = path.points[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe("standalone sculptural generator contracts", () => {
  it.each(slugs)("%s: valid bounded manifest, editable integer seed and required preview", async slug => {
    const { manifest, defaults, run } = load(slug);
    expect(manifest).toMatchObject({ input: "none", category: "generator", previewRequired: true, outputs: ["vector"] });
    expect(manifest.controls!.length).toBeLessThanOrEqual(32);
    expect(defaults.randomSeed).toBe(42);
    const ctx = context();
    const result = await run(input, defaults, ctx);
    expect(() => validatePluginResult(result, { runId: "unit", pluginId: manifest.id, input, parameters: defaults }, manifest)).not.toThrow();
    const output = vector(result);
    expect(output).toMatchObject({ width: 180, height: 260 });
    expect(output.paths.length).toBeGreaterThan(100);
    expect(output.paths.reduce((n, p) => n + p.points.length, 0)).toBeLessThan(100000);
    for (const path of output.paths) for (const point of path.points) {
      expect(point.x).toBeGreaterThanOrEqual(12); expect(point.x).toBeLessThanOrEqual(168);
      expect(point.y).toBeGreaterThanOrEqual(12); expect(point.y).toBeLessThanOrEqual(248);
    }
    expect(new Set(output.paths.map(p => JSON.stringify(p.points))).size).toBe(output.paths.length);
    const progress = vi.mocked(ctx.progress).mock.calls.map(call => call[0] as number);
    expect(progress[0]).toBe(0); expect(progress.at(-1)).toBe(100);
    expect(progress.every((v, i) => i === 0 || v >= progress[i - 1])).toBe(true);
    await expect(run(input, { ...defaults, randomSeed: 42.5 }, context())).rejects.toThrow(/integer/);
  }, 15000);

  it.each(slugs)("%s: same seed repeats, another seed changes geometry, colour does not", async slug => {
    const { defaults, run } = load(slug);
    const first = await run(input, defaults, context());
    expect(await run(input, defaults, context())).toEqual(first);
    expect(geometry(await run(input, { ...defaults, randomSeed: 43 }, context()))).not.toEqual(geometry(first));
    expect(geometry(await run(input, { ...defaults, colour: "#cc9900" }, context()))).toEqual(geometry(first));
    const zero = { ...defaults, variation: 0 };
    expect(await run(input, zero, context())).toEqual(await run(input, { ...zero, randomSeed: 123 }, context()));
  }, 20000);

  it.each(slugs)("%s: density resamples a fixed form; tolerance retains its endpoints", async slug => {
    const { defaults, run } = load(slug);
    const dense = vector(await run(input, defaults, context()));
    const thin = vector(await run(input, { ...defaults, ...(slug === "organic-contours" ? { count: 68 } : { spacing: 1.2 }) }, context()));
    expect(thin.paths[0].points).toEqual(dense.paths[0].points);
    if (slug === "organic-contours") expect(thin.paths.at(-1)!.points).toEqual(dense.paths.at(-1)!.points);
    const finer = vector(await run(input, { ...defaults, tolerance: 0.015 }, context()));
    expect(finer.paths.length).toBe(dense.paths.length);
    expect(finer.paths[0].points[0]).toEqual(dense.paths[0].points[0]);
    if (slug !== "organic-contours") expect(finer.paths[0].points.at(-1)).toEqual(dense.paths[0].points.at(-1));
    expect(finer.paths.reduce((n, p) => n + p.points.length, 0)).toBeGreaterThan(dense.paths.reduce((n, p) => n + p.points.length, 0));
  }, 15000);

  it.each(slugs)("%s: rejects limits with useful guidance, never returns a partial result", async slug => {
    const { defaults, run } = load(slug);
    for (const limits of [{ paths: 3, points: 100000, executionMs: 30000 }, { paths: 10000, points: 100, executionMs: 30000 }]) {
      const ctx = context({ limits });
      await expect(run(input, defaults, ctx)).rejects.toThrow(/capacity.*(Increase|Reduce).*No partial/);
      expect(ctx.progress).not.toHaveBeenCalledWith(100);
    }
    await expect(run(input, { ...defaults, margin: 100 }, context())).rejects.toThrow(/Margin/);
    await expect(run({ ...input, page: { widthMM: 100, heightMM: 100 } }, defaults, context())).rejects.toThrow(/page/);
  });

  it.each(slugs)("%s: honours cancellation before and during work", async slug => {
    const { defaults, run } = load(slug);
    const controller = new AbortController(); controller.abort();
    await expect(run(input, defaults, context({ signal: controller.signal }))).rejects.toThrow(/cancelled/);
    const during = new AbortController();
    await expect(run(input, defaults, context({ signal: during.signal, progress(value) { if (value !== null && value >= 10) during.abort(); } }))).rejects.toThrow(/cancelled/);
  });

  it.each(slugs)("%s: explicit primary pen IDs come only from the supplied palette", async slug => {
    const { defaults, run } = load(slug);
    const paths = vector(await run(input, { ...defaults, penIndex: 2, spacing: 2, count: 20 }, context())).paths;
    expect(paths.every(p => p.penId === "ink-a" && p.color === "#bb2200")).toBe(true);
    await expect(run(input, { ...defaults, penIndex: 4 }, context())).rejects.toThrow(/pen.*unavailable/);
  });

  it("uses independent ribbon and family pens in the existing palette order", async () => {
    const { defaults, run } = load("flowing-ribbons");
    const p = { ...defaults, crossweave: 0, spacing: 2, penMode: "ribbons" };
    const paths = vector(await run(input, p, context())).paths;
    const groupSize = Math.ceil(Number(p.ribbonWidth) / 2) + 1;
    expect([paths[0].penId, paths[groupSize].penId, paths[groupSize * 2].penId]).toEqual(["ink-c", "ink-a", "ink-b"]);
    const families = vector(await run(input, { ...p, penMode: "families", crossweave: 0.2, penIndex: 3, crossPenIndex: 2 }, context())).paths;
    expect(new Set(families.map(p => p.penId))).toEqual(new Set(["ink-b", "ink-a"]));
    expect(families[0].penId).toBe("ink-b"); expect(families[groupSize].penId).toBe("ink-a");
    await expect(run({ ...input, palette: [] }, p, context())).rejects.toThrow(/configured pens/);
  });

  it("makes a braid with independent strands and no frame-edge clamping", async () => {
    const { defaults, run } = load("flowing-ribbons");
    const result = vector(await run(input, { ...defaults, preset: "braid", crossweave: 0 }, context()));
    expect(result.paths.length).toBe(3 * (Math.ceil(Number(defaults.ribbonWidth) / Number(defaults.spacing)) + 1));
    expect(result.paths.every(p => !p.closed && p.points.length > 20)).toBe(true);
    expect(result.paths.every(p => p.points.every(v => v.x > 12 && v.x < 168))).toBe(true);
  });

  it("volume has long exact vertical strands and separated upper/lower surfaces at extremes", async () => {
    const { defaults, run } = load("wave-volume");
    for (const azimuth of [-130, -35, 0, 35, 110, 180]) {
      const result = vector(await run(input, { ...defaults, azimuth, upper: false, lower: false, separation: 20, amplitude: 100, spacing: 5 }, context()));
      expect(result.paths.length).toBe(Math.ceil(112 / 5) + Math.ceil(78 / 5) + 1);
      for (const p of result.paths) {
        expect(p.points).toHaveLength(2);
        expect(p.points[0].x).toBeCloseTo(p.points[1].x, 10);
        expect(p.points[1].y - p.points[0].y).toBeGreaterThan(1);
      }
    }
    const families = vector(await run(input, { ...defaults, penMode: "families", penIndex: 1, surfacePenIndex: 2, strandPenIndex: 3, spacing: 4 }, context()));
    expect(new Set(families.paths.map(p => p.penId))).toEqual(new Set(["ink-c", "ink-a", "ink-b"]));
    await expect(run(input, { ...defaults, upper: false, lower: false, strands: false }, context())).rejects.toThrow(/Enable/);
  });

  it("hollow volume splits grid paths exactly at the elliptical hole", async () => {
    const { defaults, run } = load("wave-volume");
    // Azimuth=0 exposes footprint x directly; at centre y=0 the hole excludes x=(-28,28).
    const output = vector(await run(input, { ...defaults, opening: 50, azimuth: 0, upper: true, lower: false, strands: false, spacing: 6.5 }, context()));
    const endpoints = output.paths.flatMap(p => [p.points[0], p.points.at(-1)!]);
    expect(endpoints.some(v => Math.abs(v.x - (90 - 28)) < 1e-8)).toBe(true);
    expect(output.paths.length).toBeGreaterThan(Math.ceil(112 / 6.5) + Math.ceil(78 / 6.5) + 2);
    expect(output.paths.every(p => !p.closed)).toBe(true);
  });

  it("default organic contours are smooth, non-collapsed, nested and free of self-intersections", async () => {
    const { defaults, run } = load("organic-contours");
    for (const seed of [42, 43]) {
      const paths = vector(await run(input, { ...defaults, randomSeed: seed }, context())).paths;
      expect(paths.every(p => p.closed)).toBe(true);
      expect(area(paths[0])).toBeGreaterThan(1);
      for (let i = 1; i < paths.length; i++) expect(area(paths[i])).toBeGreaterThan(area(paths[i - 1]));
      for (const index of [0, 30, 67, 100, 134]) {
        const ring = paths[index], vertices = ring.points;
        for (let i = 0; i < vertices.length; i++) for (let j = i + 2; j < vertices.length; j++) {
          if (i === 0 && j === vertices.length - 1) continue;
          expect(intersects(vertices[i], vertices[(i + 1) % vertices.length], vertices[j], vertices[(j + 1) % vertices.length])).toBe(false);
        }
        if (index) expect(paths[index - 1].points.every(point => contains(ring, point))).toBe(true);
      }
    }
  }, 15000);

  it("supports Extended capacity explicitly and fails Standard rather than truncating contours", async () => {
    const { defaults, run, manifest } = load("organic-contours");
    const p = { ...defaults, count: 700, tolerance: 0.015 };
    await expect(run(input, p, context())).rejects.toThrow(/capacity/);
    const result = await run(input, p, context({ limits: pluginExecutionLimits("extended") }));
    expect(vector(result).paths.length).toBe(700);
    expect(() => validatePluginResult(result, { runId: "extended", pluginId: manifest.id, input, parameters: p, detailBudget: "extended" }, manifest)).not.toThrow();
  }, 15000);

  it("clips crossing segments without edge clamping or joining disconnected pieces", () => {
    const { source, defaults } = load("flowing-ribbons");
    const create = new Function(source.replace("export default async function run", "async function run") + "\nreturn sculptureEnvironment;")();
    const e = create(input, defaults, context(), "test", "Reduce detail.");
    e.emit([{ x: 0, y: 10 }, { x: 20, y: 50 }, { x: -20, y: 80 }, { x: 20, y: 120 }], false, { color: "#000000" });
    const paths = e.finish().paths;
    expect(paths).toHaveLength(2);
    expect(paths[0].points[0]).toEqual({ x: 12, y: 34 });
    expect(paths[0].points.at(-1)).toEqual({ x: 12, y: 56 });
    expect(paths[1].points[0]).toEqual({ x: 12, y: 112 });
    expect(paths.every((p: PluginPolyline) => p.points.every(v => v.x >= 12 && v.x <= 168))).toBe(true);
  });

  it("adaptive sampling reaches tolerance and enforces its runtime budget", () => {
    const { source, defaults } = load("flowing-ribbons");
    const create = new Function(source.replace("export default async function run", "async function run") + "\nreturn sculptureEnvironment;")();
    const e = create(input, defaults, context(), "test", "Reduce detail.");
    const curve = (t: number) => ({ x: t * 150 + 15, y: 130 + 35 * Math.sin(t * Math.PI * 8) });
    const points = e.sample(curve, 0, 1, 32) as { x: number; y: number }[];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1], x = (a.x + b.x) / 2;
      expect(Math.abs(curve((x - 15) / 150).y - (a.y + b.y) / 2) * (b.x - a.x) / Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThanOrEqual(Number(defaults.tolerance) * 1.05);
    }
    const now = vi.spyOn(Date, "now").mockReturnValueOnce(0).mockReturnValue(100);
    try { expect(() => create(input, defaults, context({ limits: { paths: 10000, points: 100000, executionMs: 50 } }), "test", "Reduce detail.")).toThrow(/time budget/); }
    finally { now.mockRestore(); }
  });

  it.each(slugs)("%s: rotated geometry clips inside the declared margins and the border remains independent", async slug => {
    const { defaults, run, manifest } = load(slug);
    const parameters = { ...defaults, width: 140, height: 180, margin: 10, rotation: 37, spacing: 3, count: 30, border: true, borderMode: "frame" };
    const result = vector(await run(input, parameters, context()));
    const request = { runId: "rotated", pluginId: manifest.id, input, parameters };
    expect(() => validatePluginResult(result, request, manifest)).not.toThrow();
    expect(result.paths.at(-1)).toMatchObject({ closed: true, points: [{ x: 10, y: 10 }, { x: 130, y: 10 }, { x: 130, y: 170 }, { x: 10, y: 170 }] });
    for (const path of result.paths) for (const point of path.points) {
      expect(point.x).toBeGreaterThanOrEqual(10); expect(point.x).toBeLessThanOrEqual(130);
      expect(point.y).toBeGreaterThanOrEqual(10); expect(point.y).toBeLessThanOrEqual(170);
    }
    expect(result.paths.slice(0, -1).some(p => !p.closed)).toBe(true);
  });

  it("omits exact repeated same-ink strokes while preserving crossings and distinct pen assignments", () => {
    const { source, defaults } = load("flowing-ribbons");
    const create = new Function(source.replace("export default async function run", "async function run") + "\nreturn sculptureEnvironment;")();
    const e = create(input, defaults, context(), "test", "Reduce detail.");
    const line = [{ x: 20, y: 20 }, { x: 80, y: 100 }], ink = { color: "#000000" };
    e.emit(line, false, ink); e.emit([...line].reverse(), false, ink);
    const triangle = [{ x: 30, y: 30 }, { x: 70, y: 30 }, { x: 60, y: 80 }];
    e.emit(triangle, true, ink); e.emit([triangle[1], triangle[0], triangle[2]], true, ink);
    e.emit([{ x: 20, y: 100 }, { x: 80, y: 20 }], false, ink);
    e.emit(line, false, { color: "#0088aa", penId: "ink-c" });
    expect(e.finish().paths).toHaveLength(4);
  });

  it.each(slugs)("%s: border follows visible artwork bounds with an exact gap and preserves the artwork", async slug => {
    const { defaults, run, manifest } = load(slug);
    const p = { ...defaults, spacing: 3, count: 30, rotation: 37, penIndex: 2 };
    const art = vector(await run(input, p, context()));
    const points = art.paths.flatMap(path => path.points);
    const bounds = {
      minX: Math.min(...points.map(v => v.x)), minY: Math.min(...points.map(v => v.y)),
      maxX: Math.max(...points.map(v => v.x)), maxY: Math.max(...points.map(v => v.y)),
    };
    for (const gap of [0, 3, 7]) {
      const parameters = { ...p, border: true, borderMode: "artwork", borderGap: gap };
      const result = vector(await run(input, parameters, context()));
      expect(result.paths.slice(0, -1)).toEqual(art.paths);
      expect(result).toMatchObject({ width: art.width, height: art.height });
      expect(result.paths.at(-1)).toEqual({ closed: true, color: "#bb2200", penId: "ink-a", points: [
        { x: bounds.minX - gap, y: bounds.minY - gap }, { x: bounds.maxX + gap, y: bounds.minY - gap },
        { x: bounds.maxX + gap, y: bounds.maxY + gap }, { x: bounds.minX - gap, y: bounds.maxY + gap },
      ] });
      expect(() => validatePluginResult(result, { runId: "border", pluginId: manifest.id, input, parameters }, manifest)).not.toThrow();
    }
    const ctx = context();
    await expect(run(input, { ...p, border: true, borderGap: 200 }, ctx)).rejects.toThrow(/Border gap does not fit.*increase Margin.*no partial/);
    expect(ctx.progress).not.toHaveBeenCalledWith(100);
    const oldSettings = { ...defaults };
    delete oldSettings.borderGap; delete oldSettings.borderMode;
    expect(validatePluginParameters(manifest, oldSettings)).toMatchObject({ borderGap: 5, borderMode: "artwork", randomSeed: 42 });
  }, 15000);

  it("border points count towards capacity and an empty scene cannot return only a border", () => {
    const { source, defaults } = load("flowing-ribbons");
    const create = new Function(source.replace("export default async function run", "async function run") + "\nreturn sculptureEnvironment;")();
    const e = create(input, { ...defaults, border: true }, context({ limits: { paths: 2, points: 5, executionMs: 30000 } }), "test", "Reduce detail.");
    e.emit([{ x: 20, y: 20 }, { x: 80, y: 100 }], false, { color: "#000000" });
    expect(() => e.finish()).toThrow(/capacity/);
    const empty = create(input, { ...defaults, border: true }, context(), "test", "Reduce detail.");
    expect(() => empty.finish()).toThrow(/No visible paths/);
  });
});
