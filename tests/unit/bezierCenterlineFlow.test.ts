import { describe, expect, it } from "vitest";
import { createMachineConfig, createVectorObject } from "../helpers/factories";
import { transformCenterline } from "../../src/workers/gcodeEngine/stages/penProfile";
import { parseCanvasLayout } from "../../src/types/layoutValidation";
import { validateProcessedFont } from "../../src/main/fonts/library";
import { validateCenterlineCommands } from "../../src/types/centerlineGeometry";
import { vectorObjectsForImports } from "../../src/renderer/src/store/canvasStore/services/vectorObjects";
import type { CenterlineData } from "../../src/types";

const config = createMachineConfig({ origin: "bottom-left" });
const geometry: CenterlineData = {
  commands: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 }],
  points: [{ x: 0, y: 0, width: 1 }, { x: 5, y: 7.5, width: 3 }, { x: 10, y: 0, width: 1 }],
};
const object = (extra = {}) => createVectorObject({ x: 10, y: 10, originalWidth: 10, originalHeight: 10, centerline: geometry, ...extra });

describe("smooth centreline export geometry and pressure", () => {
  it("plots the actual cubic instead of connecting the sparse pressure samples as a jagged polyline", () => {
    const result = transformCenterline(object(), config);
    expect(result.length).toBeGreaterThan(20);
    expect(result.some(p => Math.hypot(p.x - 11.5625, p.y - 14.375) < 1e-8)).toBe(true);
    expect(result.find(p => Math.abs(p.x - 15) < 1e-8)?.width).toBeCloseTo(3);
    expect(result[0].width).toBe(1);
    expect(result.at(-1)!.width).toBe(1);
  });
  it("keeps a pressure peak in the middle of a straight fitted line", () => {
    const centerline: CenterlineData = { commands: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 }],
      points: [{ x: 0, y: 0, width: 1 }, { x: 5, y: 0, width: 3 }, { x: 10, y: 0, width: 1 }] };
    expect(transformCenterline(object({ centerline }), config).map(p => p.width)).toEqual([1, 3, 1]);
    expect(transformCenterline(object({ centerline, useStrokeWidths: false }), config)).toHaveLength(2);
  });
  it("limits the curve-to-motion approximation to 0.01 physical mm after enlargement", () => {
    const result = transformCenterline(object({ scale: 10, x: 0, y: 0, useStrokeWidths: false }), config);
    const distance = (p: { x: number; y: number }, a: typeof p, b: typeof p) => {
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    };
    for (let index = 0; index <= 100; index++) {
      const t = index / 100, u = 1 - t;
      const point = { x: 100 * (3 * u * t * t + t * t * t), y: 100 - 300 * u * t };
      const deviation = Math.min(...result.slice(1).map((end, i) => distance(point, result[i], end)));
      expect(deviation).toBeLessThanOrEqual(0.01001);
    }
  });
  it("round-trips the same Bézier commands and widths through a layout into G-code objects", () => {
    const item = { id: "text", name: "Smooth text", x: 10, y: 10, scale: 1, rotation: 0, visible: true,
      svgWidth: 10, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
      paths: [{ id: "curve", d: "M0 0 C0 10 10 10 10 0", svgSource: "", visible: true, centerline: geometry }] };
    const layout = parseCanvasLayout(JSON.stringify({ tfVersion: 1, imports: [item], layerGroups: [] }));
    const result = vectorObjectsForImports(layout.imports)[0];
    expect(result.centerline).toEqual(geometry);
    expect(transformCenterline(result, config)).toEqual(transformCenterline(object(), config));
  });
  it("rejects discontinuous or non-finite curve metadata before plotting", () => {
    expect(() => validateCenterlineCommands([{ type: "M", x: 0, y: 0 }, { type: "M", x: 1, y: 1 }])).toThrow(/continuous/);
    expect(() => validateCenterlineCommands([{ type: "M", x: 0, y: 0 }, { type: "C", x1: NaN, y1: 0, x2: 1, y2: 0, x: 1, y: 1 }])).toThrow(/coordinate/);
    expect(() => validateProcessedFont({ version: 1, processingVersion: Infinity, id: "curve", name: "Curve", sourceName: "Curve.ttf",
      createdAt: "2026-10-30", unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0, glyphs: {}, kerning: {}, warnings: [] })).toThrow(/processing version/);
  });
});
