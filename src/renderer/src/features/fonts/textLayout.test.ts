import { describe, expect, it } from "vitest";
import type { ProcessedFont } from "../../../../types/fonts";
import { createTextImport, DEFAULT_TEXT_SETTINGS, layoutText } from "./textLayout";

const glyph = { advanceWidth: 600, paths: [{ points: [{ x: 100, y: 0, width: 100 }, { x: 500, y: 700, width: 200 }] }] };
const font: ProcessedFont = { id: "test-font", version: 1, name: "Test", sourceName: "test.ttf", createdAt: "2026-10-29T00:00:00Z",
  unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0, glyphs: { A: glyph, V: glyph, " ": { advanceWidth: 300, paths: [] } },
  kerning: { AV: -100 }, warnings: [] };
const settings = { ...DEFAULT_TEXT_SETTINGS, text: "AV", fontSizeMM: 10 };

describe("centre-line text layout", () => {
  it("scales outline widths and uses font kerning without breaking continuous strokes", () => {
    const result = layoutText(font, settings);
    expect(result.width).toBe(11);
    expect(result.height).toBe(10);
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0].centerline!.points).toEqual([{ x: 1, y: 8, width: 1 }, { x: 5, y: 1, width: 2 }]);
    expect(result.paths[1].centerline!.points[0]).toEqual({ x: 6, y: 8, width: 1 });
    expect(result.paths[0].d).toBe("M1.000000 8.000000 L5.000000 1.000000");
    expect(result.minStrokeWidth).toBe(1);
    expect(result.maxStrokeWidth).toBe(2);
  });

  it("lays out line alignment, line height, whitespace and tracking independently", () => {
    const centered = layoutText(font, { ...settings, text: "AA\nA", alignment: "center", letterSpacingMM: 1 });
    expect(centered.width).toBe(13);
    expect(centered.paths[2].centerline!.points[0]).toEqual({ x: 4.5, y: 20, width: 1 });
    expect(centered.height).toBe(22);
    const right = layoutText(font, { ...settings, text: "AA\r\nA", alignment: "right" });
    expect(right.paths[2].centerline!.points[0].x).toBe(7);
    expect(layoutText(font, { ...settings, text: "A\tA" }).width).toBe(24);
    expect(layoutText(font, { ...settings, text: "A A", letterSpacingMM: 1 }).width).toBe(17);
  });

  it("reports missing Unicode characters and prevents incomplete or blank text from being committed", () => {
    const result = layoutText(font, { ...settings, text: "A🦊🦊Z" });
    expect(result.missingCharacters).toEqual(["🦊", "Z"]);
    expect(() => createTextImport(font, settings, result, "text-1")).toThrow(/every character/);
    expect(() => createTextImport(font, settings, layoutText(font, { ...settings, text: " \n " }), "text-1")).toThrow(/drawable/);
  });

  it("expands the source frame around overhanging strokes, keeping sampled geometry inside it", () => {
    const overhang: ProcessedFont = { ...font, glyphs: { A: { ...glyph, paths: [{ points: [
      { x: -100, y: 950, width: 200 }, { x: 700, y: -250, width: 100 },
    ] }] } } };
    const result = layoutText(overhang, { ...settings, text: "A" });
    for (const point of result.paths[0].centerline!.points) {
      expect(point.x - point.width / 2).toBeGreaterThanOrEqual(0);
      expect(point.y - point.width / 2).toBeGreaterThanOrEqual(0);
      expect(point.x + point.width / 2).toBeLessThanOrEqual(result.width);
      expect(point.y + point.width / 2).toBeLessThanOrEqual(result.height);
    }
  });

  it("stores editable text settings and unique path identities in ordinary vector artwork", () => {
    const item = createTextImport(font, settings, layoutText(font, settings), "text-1");
    expect(item.textSource).toEqual({ fontId: font.id, fontName: font.name, ...settings, mode: "centerline" });
    expect(item.paths.map((path) => path.id)).toEqual(["text-1-stroke-0", "text-1-stroke-1"]);
    expect(item.paths.every((path) => !!path.centerline && path.hasFill === false)).toBe(true);
    expect(item.hatchEnabled).toBe(false);
  });

  it("rejects invalid sizes, unbounded input and corrupt stored stroke data", () => {
    expect(() => layoutText(font, { ...settings, fontSizeMM: NaN })).toThrow(/Font size/);
    expect(() => layoutText(font, { ...settings, lineSpacing: 0 })).toThrow(/Line spacing/);
    expect(() => layoutText(font, { ...settings, letterSpacingMM: -10 })).toThrow(/Letter spacing/);
    expect(() => layoutText(font, { ...settings, text: "A".repeat(2001) })).toThrow(/2000/);
    const corrupt: ProcessedFont = { ...font, glyphs: { A: { ...glyph, paths: [{ points: [{ x: 0, y: 0, width: -1 }, { x: 1, y: 1, width: 1 }] }] } } };
    expect(() => layoutText(corrupt, { ...settings, text: "A" })).toThrow(/invalid stroke/);
  });

  it("keeps measured width samples when disabled and saves brush lead-in when enabled", () => {
    const geometry = layoutText(font, settings);
    const fixed = createTextImport(font, settings, geometry, "fixed-text");
    const brush = createTextImport(font, { ...settings, useStrokeWidths: true, brushLeadInMM: 2.5 }, geometry, "brush-text");
    expect(fixed.useStrokeWidths).toBe(false);
    expect(fixed.paths[0].centerline).toEqual(brush.paths[0].centerline);
    expect(brush.useStrokeWidths).toBe(true);
    expect(brush.brushLeadInMM).toBe(2.5);
    expect(brush.textSource).toMatchObject({ useStrokeWidths: true, brushLeadInMM: 2.5 });
    expect(() => layoutText(font, { ...settings, brushLeadInMM: 0 })).toThrow(/Brush lead-in/);
    const { useStrokeWidths: _omitted, ...legacy } = settings;
    expect(createTextImport(font, legacy, geometry, "legacy").useStrokeWidths).toBe(true);
  });

  it("retains smooth cubic geometry, shared tangents and pressure samples in the same source frame", () => {
    const fitted: ProcessedFont = { ...font, processingVersion: 2, glyphs: { A: { advanceWidth: 600, paths: [{
      commands: [{ type: "M", x: 100, y: 0 },
        { type: "C", x1: 100, y1: 100, x2: 200, y2: 200, x: 300, y: 300 },
        { type: "C", x1: 400, y1: 400, x2: 500, y2: 500, x: 500, y: 700 }],
      points: [{ x: 100, y: 0, width: 100 }, { x: 300, y: 300, width: 150 }, { x: 500, y: 700, width: 200 }],
    }] } } };
    const result = layoutText(fitted, { ...settings, text: "A" });
    expect(result.paths).toHaveLength(1);
    const path = result.paths[0];
    expect(path.d).toBe("M1.000000 8.000000 C1.000000 7.000000 2.000000 6.000000 3.000000 5.000000 C4.000000 4.000000 5.000000 3.000000 5.000000 1.000000");
    expect(path.svgSource).toContain(`d="${path.d}"`);
    expect(path.centerline?.commands).toEqual([{ type: "M", x: 1, y: 8 },
      { type: "C", x1: 1, y1: 7, x2: 2, y2: 6, x: 3, y: 5 },
      { type: "C", x1: 4, y1: 4, x2: 5, y2: 3, x: 5, y: 1 }]);
    expect(path.centerline?.points).toEqual([{ x: 1, y: 8, width: 1 }, { x: 3, y: 5, width: 1.5 }, { x: 5, y: 1, width: 2 }]);
    const first = path.centerline!.commands![1], second = path.centerline!.commands![2];
    if (first.type !== "C" || second.type !== "C") throw new Error("Missing fitted curves.");
    expect([first.x - first.x2, first.y - first.y2]).toEqual([second.x1 - first.x, second.y1 - first.y]);
    const item = createTextImport(fitted, { ...settings, text: "A", useStrokeWidths: true }, result, "smooth-text");
    expect(item.paths[0].centerline).toEqual(path.centerline);
    expect(item.useStrokeWidths).toBe(true);
  });
});
