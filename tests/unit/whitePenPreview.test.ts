import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGcodeOptions, createMachineConfig, createSvgImport } from "../helpers/factories";
import { parseGcode, type GcodeToolpath } from "../../src/renderer/src/utils/gcodeParser";
import { drawToolpathLayer } from "../../src/renderer/src/features/canvas/utils/toolpathOverlayDraw";
import { vectorObjectsForGroup, vectorObjectsForImportLayer, vectorObjectsForImports } from "../../src/renderer/src/store/canvasStore/services/vectorObjects";

const postSpy = vi.fn();
let dispatch: (data: unknown) => void;
beforeAll(async () => {
  vi.stubGlobal("postMessage", postSpy);
  await import("../../src/workers/svgWorker");
  const handler = (globalThis as Record<string, unknown>).onmessage as (event: { data: unknown }) => void;
  dispatch = (data) => handler({ data });
});
afterEach(() => postSpy.mockClear());
afterAll(() => vi.unstubAllGlobals());

function paint(toolpath: GcodeToolpath) {
  const strokes: Array<{ color: string; dash: number[] }> = [];
  let dash: number[] = [];
  const ctx = {
    save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), beginPath: vi.fn(),
    rect: vi.fn(), clip: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    setLineDash: (value: number[]) => { dash = value; },
    strokeStyle: "", lineWidth: 1, globalAlpha: 1,
    stroke() { strokes.push({ color: this.strokeStyle, dash: [...dash] }); },
  };
  drawToolpathLayer({ ctx: ctx as unknown as CanvasRenderingContext2D, gcodeToolpath: toolpath,
    toolpathSelected: true, useMetadataColors: true, toolpathOpacity: 1,
    plotProgressCuts: null, plotProgressRapids: null, ppCutsCache: { text: "", path: null },
    ppRapidsCache: { text: "", path: null }, transform: { a: 1, d: 1, e: 100, f: 100, sx: 1 },
    physW: 1000, physH: 1000, vpZoom: 1, bedXMin: -100, bedXMax: 900, bedYMin: -100, bedYMax: 900 });
  return strokes;
}

describe("white pen G-code preview", () => {
  it.each(["all artwork", "per pen", "per SVG layer"])("keeps assigned white ink through %s generation and preview", async (mode) => {
    const artwork = createSvgImport({ id: "artwork", svgWidth: 20, svgHeight: 20, scale: 1,
      paths: [{ id: "outline", d: "M0 0L10 0L10 10Z", svgSource: "", visible: true,
        strokeColor: "#222222", fillColor: "#999999", sourceColor: "#222222", layer: "layer",
        hatchLines: ["M1 1L8 1", "M1 2L8 2"] }],
      layers: [{ id: "layer", name: "Layer", visible: true }] });
    const pen = { id: "white", name: "White", color: "#ffffff", importIds: [artwork.id] };
    const objects = mode === "all artwork" ? vectorObjectsForImports([artwork], [pen])
      : mode === "per pen" ? vectorObjectsForGroup([artwork], [pen], pen.id)
        : vectorObjectsForImportLayer(artwork, "layer", pen.color);
    expect(objects.length).toBeGreaterThan(0);
    expect(objects.every((object) => object.sourceColor === "#ffffff")).toBe(true);
    const taskId = `white-${mode}`;
    dispatch({ type: "generate", taskId, objects,
      config: createMachineConfig({ bedWidth: 200, bedHeight: 200, origin: "bottom-left" }),
      options: createGcodeOptions({ optimisePaths: false }) });
    await vi.waitFor(() => expect(postSpy.mock.calls.some(([message]) => message.type === "complete" && message.taskId === taskId)).toBe(true));
    const complete = postSpy.mock.calls.find(([message]) => message.type === "complete" && message.taskId === taskId)![0] as { gcode: string };
    expect(complete.gcode).toContain("color=%23ffffff");
    const preview = parseGcode(complete.gcode);
    expect(preview.cutPaths.length).toBeGreaterThan(0);
    expect(preview.cutPathColors?.every((color) => color === "#ffffff")).toBe(true);
    const inkStrokes = paint(preview).filter((stroke) => stroke.dash.length === 0);
    expect(inkStrokes.length).toBeGreaterThan(0);
    expect(inkStrokes.every((stroke) => stroke.color === "#ffffff")).toBe(true);
  });

  it("draws a white stroke above an overlapping uncoloured grey travel guide", () => {
    const preview = parseGcode("G90\nG0 X10 Y0\n;@tf v=1 color=%23ffffff\nG1 X0 Y0\n");
    const strokes = paint(preview);
    expect(strokes).toHaveLength(2);
    expect(strokes[0]).toEqual({ color: "#4a5568", dash: [2, 1] });
    expect(strokes[1]).toEqual({ color: "#ffffff", dash: [] });
  });
});
