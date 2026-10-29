import { describe, expect, it } from "vitest";
import type { FontOutlineCommand, ProcessedFont } from "../../../../types/fonts";
import { generateHatchPaths } from "../../utils/hatchFill";
import { createTextImport, DEFAULT_TEXT_SETTINGS, layoutText } from "./textLayout";

const ring: FontOutlineCommand[] = [
  { type: "M", x: 0, y: 0 }, { type: "L", x: 600, y: 0 }, { type: "L", x: 600, y: 700 }, { type: "L", x: 0, y: 700 }, { type: "Z" },
  { type: "M", x: 100, y: 100 }, { type: "L", x: 100, y: 600 }, { type: "L", x: 500, y: 600 }, { type: "L", x: 500, y: 100 }, { type: "Z" },
];
const font: ProcessedFont = { version: 1, mode: "outline", id: "outline-test", name: "Outline test", sourceName: "test.otf", createdAt: "2026-10-30T00:00:00Z",
  unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0, glyphs: { O: { advanceWidth: 700, paths: [], outline: ring }, " ": { advanceWidth: 300, paths: [], outline: [] } }, kerning: {}, warnings: [] };
const settings = { ...DEFAULT_TEXT_SETTINGS, text: "O", fontSizeMM: 10 };
const coordinates = (d: string) => d.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)!.map(Number);

describe("standard outline text and plotted infill", () => {
  it("keeps compound glyph contours and native quadratic/cubic curves without centrelines", () => {
    const outlined = layoutText(font, settings);
    expect(outlined.paths).toHaveLength(1);
    expect(outlined.paths[0].d.match(/M/g)).toHaveLength(2);
    expect(outlined.paths[0].d.match(/Z/g)).toHaveLength(2);
    expect(outlined.paths[0].centerline).toBeUndefined();
    const curves: FontOutlineCommand[] = [{ type: "M", x: 0, y: 0 }, { type: "Q", x1: 100, y1: 100, x: 300, y: 700 },
      { type: "C", x1: 400, y1: 700, x2: 500, y2: 100, x: 600, y: 0 }, { type: "L", x: 0, y: 0 }, { type: "Z" }];
    const curved = layoutText({ ...font, glyphs: { O: { advanceWidth: 700, paths: [], outline: curves } } }, settings);
    expect(curved.paths[0].d).toContain("Q1.000000 7.000000 3.000000 1.000000");
    expect(curved.paths[0].d).toContain("C4.000000 1.000000 5.000000 7.000000 6.000000 8.000000");
  });

  it("creates actual Solid plot strokes clipped around the O counter", () => {
    const result = layoutText(font, { ...settings, infill: "solid", fillSpacingMM: 1, fillAngleDeg: 0 });
    expect(result.outlineCount).toBe(1);
    expect(result.fillCount).toBeGreaterThan(7);
    for (const path of result.paths.slice(1)) {
      const [x1, y1, x2, y2] = coordinates(path.d);
      expect(y1).toBe(y2);
      if (y1 > 2 && y1 < 7) expect(x2 <= 1 || x1 >= 5).toBe(true);
      expect(path.hasFill).toBe(false);
      expect(path.hatchLines).toBeUndefined();
    }
    const dense = layoutText(font, { ...settings, infill: "solid", fillSpacingMM: 0.2 });
    const coarse = layoutText(font, { ...settings, infill: "solid", fillSpacingMM: 0.4 });
    expect(dense.fillCount).toBeGreaterThan(coarse.fillCount);
    const item = createTextImport(font, { ...settings, infill: "solid" }, dense, "outlined-text");
    expect(item.useStrokeWidths).toBe(false);
    expect(item.hatchEnabled).toBe(false);
    expect(item.textSource?.mode).toBe("outline");
  });

  it("uses a lighter crossing pair of clipped stroke sets for Sketch", () => {
    const result = layoutText(font, { ...settings, infill: "sketch", fillSpacingMM: 0.5, fillAngleDeg: 0 });
    const segments = result.paths.slice(1).map((path) => coordinates(path.d));
    expect(segments.some(([x1, , x2]) => Math.abs(x1 - x2) < 0.001)).toBe(true);
    expect(segments.some(([, y1, , y2]) => Math.abs(y1 - y2) < 0.001)).toBe(true);
    const solid = layoutText(font, { ...settings, infill: "solid", fillSpacingMM: 0.5, fillAngleDeg: 0 });
    expect(result.fillCount).toBeLessThanOrEqual(solid.fillCount * 1.25);
  });

  it("uses nonzero winding for overlapping font contours while existing SVG fills remain even-odd", () => {
    const overlap = "M0 0L4 0L4 7L0 7Z M2 0L6 0L6 7L2 7Z";
    const length = (lines: string[]) => lines.reduce((total, d) => { const [x1, , x2] = coordinates(d); return total + Math.abs(x2 - x1); }, 0);
    expect(length(generateHatchPaths(overlap, 1, 0, "nonzero"))).toBe(42);
    expect(generateHatchPaths(overlap, 1, 0, "nonzero")).toHaveLength(7);
    expect(generateHatchPaths("M0 0L4 0L4 7L0 7Z M4 0L8 0L8 7L4 7Z", 1, 0, "nonzero")).toHaveLength(7);
    expect(length(generateHatchPaths(overlap, 1, 0))).toBe(28);
  });

  it("blocks excessive fill work before hatching and rejects invalid settings", () => {
    const complex = { ...font, glyphs: { O: { advanceWidth: 700, paths: [], outline: [...ring, ...ring, ...ring] } } };
    expect(() => layoutText(complex, { ...settings, infill: "solid", fontSizeMM: 1000, fillSpacingMM: 0.05 })).toThrow(/infill is too detailed/);
    expect(() => layoutText(font, { ...settings, fillSpacingMM: 0 })).toThrow(/Fill spacing/);
    expect(() => layoutText(font, { ...settings, fillAngleDeg: NaN })).toThrow(/Fill angle/);
  });
});
