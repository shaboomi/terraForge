import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { VectorObject } from "../../src/types";
import type { PenProfile } from "../../src/types/pens";
import { createGcodeOptions, createMachineConfig, createVectorObject } from "../helpers/factories";
import { clipSubpathsToRect } from "../../src/workers/gcodeEngine";
import { brushZ, transformCenterline } from "../../src/workers/gcodeEngine/stages/penProfile";
import { parseCanvasLayout } from "../../src/types/layoutValidation";
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
    expect(result.gcode).toContain("G1 Z-1.000 ; Brush contact");
    expect(result.gcode).toContain("G1 X20.000 Y20.000 Z-2.000");
    expect(result.gcode).toContain("G1 X30.000 Y20.000 Z-3.000");
    expect(result.gcode).not.toContain("G0 Z0 ; Pen down");
  });
  it("preserves and interpolates widths at a clipped boundary", async () => {
    const result = await generate([object({ x: -5 })]);
    expect(result.gcode).toContain("G0 X0.000 Y20.000");
    expect(result.gcode).toContain("G1 Z-1.500 ; Brush contact");
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
    expect(result.gcode).toContain("G0 X21.000 Y20.000");
    expect(result.gcode).toContain("G1 Z-3.000 ; Brush contact");
    expect(result.gcode.match(/; Brush contact/g)).toHaveLength(2);
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
});
