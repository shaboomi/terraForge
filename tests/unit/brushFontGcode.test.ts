import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VectorObject } from "../../src/types";
import type { PenProfile } from "../../src/types/pens";
import { createGcodeOptions, createMachineConfig, createVectorObject } from "../helpers/factories";
import { clipSubpathsToRect } from "../../src/workers/gcodeEngine";
import { brushZ, transformCenterline } from "../../src/workers/gcodeEngine/stages/penProfile";
import { parseCanvasLayout, serializeCanvasLayout } from "../../src/types/layoutValidation";
import { vectorObjectsForImports, vectorObjectsForGroup } from "../../src/renderer/src/store/canvasStore/services/vectorObjects";

const profile: PenProfile = { id: "brush", name: "Round", color: "#000000", type: "brush", tipWidthMM: 1,
  maxDrawSpeedMMMin: 600, brush: { minWidthMM: 1, maxWidthMM: 3, minZ: -1, maxZ: -3 } };
const config = createMachineConfig({ penType: "stepper", origin: "bottom-left", penUpCommand: "G0 Z5", penDownCommand: "G0 Z0", drawSpeed: 3000 });
const post = vi.fn();
vi.stubGlobal("postMessage", post);
let dispatch: (event: { data: unknown }) => void;
beforeAll(async () => { await import("../../src/workers/svgWorker"); dispatch = globalThis.onmessage as unknown as typeof dispatch; });
afterEach(() => post.mockClear());

async function generate(objects: VectorObject[], overrides = {}, machine = config) {
  const taskId = crypto.randomUUID();
  dispatch({ data: { type: "generate", taskId, objects, config: machine, options: createGcodeOptions(overrides) } });
  await vi.waitFor(() => expect(post.mock.calls.some(([msg]) => msg.taskId === taskId && ["complete", "error"].includes(msg.type))).toBe(true));
  return post.mock.calls.map(([msg]) => msg).find(msg => msg.taskId === taskId && ["complete", "error"].includes(msg.type)) as { type: string; gcode: string; error: string };
}

function object(overrides: Partial<VectorObject> = {}) {
  return createVectorObject({ x: 10, y: 10, originalWidth: 20, originalHeight: 10, path: "M0 0 L10 0 L20 0",
    penId: "round", penProfile: profile, centerline: { points: [{ x: 0, y: 0, width: 1 }, { x: 10, y: 0, width: 2 }, { x: 20, y: 0, width: 3 }] }, ...overrides });
}

describe("centreline brush plotting", () => {
  it("emits continuous coordinated XYZ strokes at the calibrated capped speed", async () => {
    const result = await generate([object()], { drawSpeedOverride: 9000 });
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("F600");
    expect(result.gcode).toContain("G0 X9.000 Y20.000");
    expect(result.gcode).toContain("G1 X10.000 Y20.000 Z-1.000 ; Brush moving lead-in");
    expect(result.gcode.indexOf("F600")).toBeLessThan(result.gcode.indexOf("; Brush moving lead-in"));
    expect(result.gcode).toContain("G1 X20.000 Y20.000 Z-2.000");
    expect(result.gcode).toContain("G1 X30.000 Y20.000 Z-3.000");
    expect(result.gcode).not.toContain("G0 Z0 ; Pen down");
    expect(result.gcode).not.toMatch(/^G1\s+Z/m);
  });
  it("preserves and interpolates widths at a clipped boundary", async () => {
    const result = await generate([object({ x: config.bedWidth - 5 })]);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain(`G0 X${(config.bedWidth - 6).toFixed(3)} Y20.000`);
    expect(result.gcode).toContain(`G1 X${config.bedWidth.toFixed(3)} Y20.000 Z-1.500`);
    expect(clipSubpathsToRect([[{ x: -10, y: 0, width: 1 }, { x: 10, y: 0, width: 3 }]], 0, 5, -1, 1)[0]).toEqual([
      { x: 0, y: 0, width: 2 }, { x: 5, y: 0, width: 2.5 },
    ]);
  });
  it("scales diameters perpendicular to a non-uniformly resized stroke", () => {
    const points = transformCenterline(object({ scaleX: 2, scaleY: 3, rotation: 45 }), config);
    expect(points.map(p => p.width)).toEqual([3, 6, 9]);
    expect(brushZ(profile, 100)).toBe(-3);
    expect(brushZ(profile, 0.01)).toBe(-1);
    const loop = transformCenterline(object({ scaleX: 2, scaleY: 3, centerline: { points: [
      { x: 0, y: 0, width: 1 }, { x: 10, y: 0, width: 1 }, { x: 10, y: 10, width: 1 }, { x: 0, y: 0, width: 1 },
    ] } }), config);
    expect(loop[0].width).toBe(loop.at(-1)!.width);
  });
  it("keeps widths paired with points when optimising reverses a stroke", async () => {
    const result = await generate([
      object({ centerline: { points: [{ x: 0, y: 0, width: 1 }, { x: 10, y: 0, width: 1 }] } }),
      object({ id: "second", centerline: { points: [{ x: 50, y: 0, width: 1 }, { x: 11, y: 0, width: 3 }] } }),
    ], { optimisePaths: true, joinPaths: true, joinTolerance: 100 });
    expect(result.gcode).toContain("G0 X20.000 Y20.000");
    expect(result.gcode).toContain("G1 X21.000 Y20.000 Z-3.000 ; Brush moving lead-in");
    expect(result.gcode).toContain("G1 X60.000 Y20.000 Z-1.000");
    expect(result.gcode.match(/; Brush moving lead-in/g)).toHaveLength(2);
  });
  it("uses the configured physical lead-in length along the first non-zero stroke tangent", async () => {
    const result = await generate([object({ brushLeadInMM: 2.5, centerline: { points: [
      { x: 0, y: 0, width: 1 }, { x: 0, y: 0, width: 1 }, { x: 3, y: 4, width: 2 },
    ] } })], { drawSpeedOverride: 9000 });
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G0 X8.500 Y22.000");
    expect(result.gcode).toContain("G1 X10.000 Y20.000 Z-1.000 ; Brush moving lead-in");
    expect(result.gcode).toContain("F600");
    expect(result.gcode).not.toMatch(/^G1\s+Z/m);
  });
  it("keeps a moving brush free of contact and pre-lift dwells even when configured", async () => {
    const result = await generate([object()], { penDownDelayMsOverride: 500, penUpDelayMsOverride: 700 });
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("; Brush moving lead-in");
    expect(result.gcode).not.toContain("; Pen settle delay");
    expect(result.gcode).not.toContain("; Pen lift delay");
    expect(result.gcode).not.toMatch(/^G4\s/m);
  });
  it("keeps configured contact commands and dwells when variable brush widths are off", async () => {
    const result = await generate([object({ useStrokeWidths: false, brushLeadInMM: 2.5 })],
      { penDownDelayMsOverride: 500, penUpDelayMsOverride: 700 });
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G0 X10.000 Y20.000");
    expect(result.gcode).toContain("G0 Z0 ; Pen down");
    expect(result.gcode).toContain("G4 P0.5 ; Pen settle delay");
    expect(result.gcode).toContain("G4 P0.7 ; Pen lift delay");
    expect(result.gcode).not.toContain("; Brush moving lead-in");
  });
  it("rejects brush approaches outside the bed or selected page instead of falling back to stationary contact", async () => {
    const atBedEdge = await generate([object({ x: 0 })]);
    expect(atBedEdge.type).toBe("error");
    expect(atBedEdge.error).toMatch(/outside the printable area.*inward.*reduce/i);
    const atPageMargin = await generate([object({ x: 3 })], { pageClip: { widthMM: 100, heightMM: 100, marginMM: 3 } });
    expect(atPageMargin.type).toBe("error");
    expect(atPageMargin.error).toMatch(/outside the printable area/i);
  });
  it("retains intentional stationary brush point taps", async () => {
    const result = await generate([object({ path: "", centerline: undefined, pointTap: { x: 5, y: 5 } })]);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G1 Z-1.000 ; Brush contact");
    expect(result.gcode).not.toContain("; Brush moving lead-in");
  });
  it("rejects unsupported brush hardware and invalid brush data", async () => {
    expect((await generate([object()], {}, { ...config, penType: "servo" })).error).toMatch(/stepper Z/);
    expect((await generate([object({ penProfile: { ...profile, brush: undefined } })])).error).toMatch(/Brush measurements/);
    expect((await generate([object({ centerline: { points: [{ x: 0, y: 0, width: NaN }, { x: 10, y: 0, width: 1 }] } })])).error).toMatch(/Invalid centreline/);
    expect((await generate([object()], {}, { ...config, penUpCommand: "G91 G0 Z5" })).error).toMatch(/absolute work-Z/);
    expect((await generate([object()], {}, { ...config, penUpCommand: "G0 Z-2" })).error).toMatch(/above both/);
  });
  it("caps fixed pens too, keeping different pen limits separate through optimisation", async () => {
    const fixed = { ...profile, type: "fineliner" as const, brush: undefined };
    const result = await generate([object({ penProfile: fixed }), object({ id: "other", penId: "other", penProfile: { ...fixed, id: "other", maxDrawSpeedMMMin: 900 } })], { optimisePaths: true });
    expect(result.gcode).toContain("F600"); expect(result.gcode).toContain("F900");
    expect(result.gcode).not.toMatch(/G1[^\n]* Z/);
  });
  it("plots centreline widths at the configured constant pen height when widths are switched off", async () => {
    const result = await generate([object({ useStrokeWidths: false })]);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G0 Z0 ; Pen down");
    expect(result.gcode).toContain("G1 X20.000 Y20.000");
    expect(result.gcode).toContain("G1 X30.000 Y20.000");
    expect(result.gcode).toContain("F600");
    expect(result.gcode).not.toContain("; Brush contact");
    expect(result.gcode).not.toContain("; Brush moving lead-in");
    expect(result.gcode).not.toMatch(/G1[^\n]*\bZ/);
  });
  it("retains coordinated brush heights when stroke widths are explicitly enabled", async () => {
    const result = await generate([object({ useStrokeWidths: true })]);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G1 X10.000 Y20.000 Z-1.000 ; Brush moving lead-in");
    expect(result.gcode).toContain("G1 X20.000 Y20.000 Z-2.000");
    expect(result.gcode).toContain("G1 X30.000 Y20.000 Z-3.000");
  });
  it("uses fixed-width pen commands even when a centreline retains enabled width measurements", async () => {
    const fixed: PenProfile = { ...profile, type: "fineliner", brush: undefined };
    const result = await generate([object({ penProfile: fixed, useStrokeWidths: true })]);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G0 Z0 ; Pen down");
    expect(result.gcode).toContain("F600");
    expect(result.gcode).not.toContain("; Brush contact");
    expect(result.gcode).not.toContain("; Brush moving lead-in");
    expect(result.gcode).not.toMatch(/G1[^\n]*\bZ/);
  });
  it("permits a brush profile on servo hardware when stroke widths are disabled", async () => {
    const machine = { ...config, penType: "servo" as const, penUpCommand: "M3 S0", penDownCommand: "M3 S90" };
    const result = await generate([object({ useStrokeWidths: false })], {}, machine);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("M3 S90 ; Pen down");
    expect(result.gcode).toContain("M3 S0 ; Pen up");
    expect(result.gcode).toContain("F600");
    expect(result.gcode).not.toContain("; Brush contact");
    expect(result.gcode).not.toContain("; Brush moving lead-in");
    expect(result.gcode).not.toMatch(/G1[^\n]*\bZ/);
  });
  it("keeps enabled and disabled width choices separate for the same brush during optimisation", async () => {
    const result = await generate([
      object({ id: "width-off", useStrokeWidths: false }),
      object({ id: "width-on", x: 50, useStrokeWidths: true }),
    ], { optimisePaths: true, joinPaths: true, joinTolerance: 100 });
    expect(result.type).toBe("complete");
    expect(result.gcode.match(/; Pen down/g)).toHaveLength(1);
    expect(result.gcode.match(/; Brush moving lead-in/g)).toHaveLength(1);
    expect(result.gcode).toContain("G1 X20.000 Y20.000\n");
    expect(result.gcode).toContain("G1 X60.000 Y20.000 Z-2.000");
  });
  it("also ignores brush height measurements for point taps with widths disabled", async () => {
    const result = await generate([object({ path: "", centerline: undefined, pointTap: { x: 5, y: 5 }, useStrokeWidths: false })]);
    expect(result.type).toBe("complete");
    expect(result.gcode).toContain("G0 Z0 ; Point tap");
    expect(result.gcode).not.toContain("; Brush contact");
    expect(result.gcode).not.toContain("; Brush moving lead-in");
  });
  it("still validates a stored pen profile and respects its speed cap when widths are disabled", async () => {
    const invalid = await generate([object({ useStrokeWidths: false, penProfile: { ...profile, maxDrawSpeedMMMin: -1 } })]);
    expect(invalid.type).toBe("error");
    expect(invalid.error).toMatch(/Maximum drawing speed/);
  });
  it("rejects incompatible knife and uncalibrated brush service modes", async () => {
    expect((await generate([object()], { vinylCutting: { bladeOffsetMM: 0.2, cornerAngleThresholdDeg: 30, microJogMagnitudeMM: 0.1 } })).error).toMatch(/pen plotting mode/);
    expect((await generate([object()], { inkService: { mode: "brush-dip", triggerTravelMM: 100, stations: [{ id: "dip", name: "Dip", type: "dip", x: 1, y: 1, dwellMs: 0 }] } })).error).toMatch(/separately calibrated station/);
  });
  it("round-trips centreline text and profile snapshots through saved layouts to grouped exports", () => {
    const item = { id: "text", name: "Text", x: 10, y: 10, scale: 1, rotation: 0, visible: true, svgWidth: 20, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
      paths: [{ id: "s", d: "M0 0 L10 0 L20 0", svgSource: "", visible: true, centerline: object().centerline }],
      textSource: { fontId: "font", fontName: "Font", text: "A", fontSizeMM: 12, letterSpacingMM: 0, lineSpacing: 1.2, alignment: "left" } };
    const layout = parseCanvasLayout(JSON.stringify({ tfVersion: 1, savedAt: new Date().toISOString(), imports: [item], layerGroups: [{ id: "round", name: "Round", color: "#000000", importIds: ["text"], penProfile: profile }] }));
    for (const vectors of [vectorObjectsForImports(layout.imports, layout.layerGroups), vectorObjectsForGroup(layout.imports, layout.layerGroups ?? [], "round")]) {
      expect(vectors[0].centerline).toEqual(item.paths[0].centerline); expect(vectors[0].penProfile).toEqual(profile);
    }
    expect(() => parseCanvasLayout(JSON.stringify({ tfVersion: 1, imports: [{ ...item, paths: [{ ...item.paths[0], centerline: { points: [{ x: 0, y: 0, width: -1 }] } }] }] }))).toThrow();
  });
  it("round-trips the disabled width choice without discarding measurements or pen specifications", () => {
    const item = { id: "text", name: "Text", x: 10, y: 10, scale: 1, rotation: 0, visible: true, svgWidth: 20, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
      useStrokeWidths: false, brushLeadInMM: 2.75,
      paths: [{ id: "s", d: "M0 0 L10 0 L20 0", svgSource: "", visible: true, centerline: object().centerline }],
      textSource: { fontId: "font", fontName: "Font", text: "A", fontSizeMM: 12, letterSpacingMM: 0, lineSpacing: 1.2, alignment: "left", useStrokeWidths: false, brushLeadInMM: 2.75 } };
    const layout = parseCanvasLayout(JSON.stringify({ tfVersion: 2, savedAt: new Date().toISOString(), imports: [item],
      layerGroups: [{ id: "round", name: "Round", color: "#000000", importIds: ["text"], penProfile: profile }] }));
    const reopened = parseCanvasLayout(serializeCanvasLayout(layout));
    expect(reopened.imports[0]).toMatchObject({ useStrokeWidths: false, brushLeadInMM: 2.75, textSource: { useStrokeWidths: false, brushLeadInMM: 2.75 } });
    for (const vectors of [vectorObjectsForImports(reopened.imports, reopened.layerGroups), vectorObjectsForGroup(reopened.imports, reopened.layerGroups ?? [], "round")]) {
      expect(vectors[0].useStrokeWidths).toBe(false);
      expect(vectors[0].brushLeadInMM).toBe(2.75);
      expect(vectors[0].centerline).toEqual(item.paths[0].centerline);
      expect(vectors[0].penProfile).toEqual(profile);
    }
  });
  it("uses saved text settings as the width fallback and gives an explicit artwork choice precedence", () => {
    const source = { fontId: "font", fontName: "Font", text: "A", fontSizeMM: 12, letterSpacingMM: 0, lineSpacing: 1.2, alignment: "left", useStrokeWidths: false, brushLeadInMM: 2.75 };
    const item = { id: "text", name: "Text", x: 10, y: 10, scale: 1, rotation: 0, visible: true, svgWidth: 20, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
      paths: [{ id: "s", d: "M0 0 L10 0 L20 0", svgSource: "", visible: true, centerline: object().centerline }], textSource: source };
    for (const useStrokeWidths of [undefined, true]) {
      const brushLeadInMM = useStrokeWidths === true ? 3.5 : undefined;
      const layout = parseCanvasLayout(JSON.stringify({ tfVersion: 2, savedAt: new Date().toISOString(), imports: [{ ...item, useStrokeWidths, brushLeadInMM }], layerGroups: [] }));
      expect(vectorObjectsForImports(layout.imports)[0].useStrokeWidths).toBe(useStrokeWidths ?? false);
      expect(vectorObjectsForImports(layout.imports)[0].brushLeadInMM).toBe(brushLeadInMM ?? 2.75);
    }
  });
  it.each(["false", 0, null, {}])("rejects invalid saved stroke width choices: %j", (useStrokeWidths) => {
    expect(() => parseCanvasLayout(JSON.stringify({ tfVersion: 2, savedAt: new Date().toISOString(), imports: [{
      id: "text", name: "Text", x: 0, y: 0, scale: 1, rotation: 0, visible: true, svgWidth: 20, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
      useStrokeWidths, paths: [{ id: "s", d: "M0 0 L10 0", svgSource: "", visible: true }],
    }], layerGroups: [] }))).toThrow();
  });
});
