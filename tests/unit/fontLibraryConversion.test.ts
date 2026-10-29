import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { convertOutlineFont } from "../../src/fonts/processor";
import { createFontLibrary, validateProcessedFont } from "../../src/main/fonts/library";
import type { FontOutlineCommand, ProcessedFont } from "../../src/types/fonts";

const rectangle: FontOutlineCommand[] = [{ type: "M", x: -50, y: -100 }, { type: "L", x: 50, y: -100 },
  { type: "L", x: 50, y: 700 }, { type: "L", x: -50, y: 700 }, { type: "Z" }];
const counter: FontOutlineCommand[] = [{ type: "M", x: 0, y: 0 }, { type: "L", x: 600, y: 0 },
  { type: "L", x: 600, y: 700 }, { type: "L", x: 0, y: 700 }, { type: "Z" },
  { type: "M", x: 100, y: 100 }, { type: "L", x: 100, y: 600 }, { type: "L", x: 500, y: 600 },
  { type: "L", x: 500, y: 100 }, { type: "Z" }];
const source: ProcessedFont = {
  version: 1, mode: "outline", id: "source-outline", name: "Native Font", sourceName: "Native.otf", createdAt: "2026-10-30T00:00:00.000Z",
  unitsPerEm: 1000, ascender: 820, descender: -210, lineGap: 120,
  glyphs: { " ": { advanceWidth: 280, paths: [], outline: [] },
    I: { advanceWidth: 260, paths: [], outline: rectangle }, O: { advanceWidth: 650, paths: [], outline: counter } },
  kerning: { II: -25, IO: -15 }, warnings: ["Complex-script shaping, ligatures and variable-font axes are not applied."],
};
const identity = { id: "derived-centreline", createdAt: "2026-10-30T01:00:00.000Z" };
const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) {
    if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith("terraforge-font-conversion-")) throw new Error("Unexpected conversion test cleanup path.");
    await rm(directory, { recursive: true, force: true });
  }
});

describe("converting a saved native font to centrelines", () => {
  it("derives measured strokes while preserving native metrics, spacing, kerning and the original outlines", () => {
    const before = JSON.stringify(source);
    const result = validateProcessedFont(convertOutlineFont(source, identity));
    expect(source).toEqual(JSON.parse(before));
    expect(result).toMatchObject({ ...identity, mode: "centerline", sourceFontId: source.id, name: source.name, sourceName: source.sourceName,
      unitsPerEm: 1000, ascender: 820, descender: -210, lineGap: 120, kerning: source.kerning });
    expect(result.glyphs).not.toBe(source.glyphs);
    expect(result.kerning).not.toBe(source.kerning);
    expect(Object.keys(result.glyphs)).toEqual(Object.keys(source.glyphs));
    for (const [character, glyph] of Object.entries(result.glyphs)) {
      expect(glyph.advanceWidth).toBe(source.glyphs[character].advanceWidth);
      expect(glyph.outline).toBeUndefined();
      expect(glyph.paths.flatMap((stroke) => stroke.points).every((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.width > 0)).toBe(true);
    }
    expect(result.glyphs[" "].paths).toEqual([]);
    expect(result.glyphs.I.paths).toHaveLength(1);
    expect(Math.min(...result.glyphs.I.paths[0].points.map((point) => point.y))).toBeLessThan(0);
    expect(result.warnings.join(" ")).toMatch(/raster|approximation/i);
    expect(result.warnings).toEqual(expect.arrayContaining(source.warnings));
  });
  it("keeps the O counter as one continuous closed stroke with no bridge across the hole", () => {
    const result = convertOutlineFont(source, identity), paths = result.glyphs.O.paths;
    expect(paths).toHaveLength(1);
    expect(paths[0].points[0]).toEqual(paths[0].points.at(-1));
    for (let i = 1; i < paths[0].points.length; i++) {
      const a = paths[0].points[i - 1], b = paths[0].points[i];
      const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      expect(middle.x < 100 || middle.x > 500 || middle.y < 100 || middle.y > 600).toBe(true);
    }
  });
  it("persists the new linked font separately and keeps the original file unchanged", async () => {
    const directory = await mkdtemp(join(tmpdir(), "terraforge-font-conversion-")); directories.push(directory);
    const library = createFontLibrary(directory);
    await library.save(source);
    const before = await readFile(join(directory, `${source.id}.json`), "utf8");
    const restoredSource = (await createFontLibrary(directory).list())[0];
    const derived = convertOutlineFont(restoredSource, identity);
    await library.save(derived);
    const reopened = await createFontLibrary(directory).list();
    expect(reopened).toEqual(expect.arrayContaining([source, derived]));
    expect(await readFile(join(directory, `${source.id}.json`), "utf8")).toBe(before);
    await library.remove(derived.id);
    expect(await library.list()).toEqual([source]);
  });
  it("rejects conversion of fonts that have no saved native outline geometry", () => {
    const derived = convertOutlineFont(source, identity);
    expect(() => convertOutlineFont(derived, { id: "another-centreline" })).toThrow(/outline|standard/i);
    expect(() => convertOutlineFont({ ...derived, mode: undefined }, { id: "legacy-centreline" })).toThrow(/outline|standard/i);
    const missing = structuredClone(source); delete missing.glyphs.I.outline;
    expect(() => convertOutlineFont(missing, identity)).toThrow(/missing.*outlines/i);
  });
  it("validates the source link while retaining compatibility with unlinked older font libraries", () => {
    const derived = convertOutlineFont(source, identity);
    expect(() => validateProcessedFont({ ...derived, sourceFontId: derived.id })).toThrow(/reference/);
    expect(() => validateProcessedFont({ ...derived, sourceFontId: "../outside" })).toThrow(/identifier/);
    expect(() => validateProcessedFont({ ...source, sourceFontId: "another-outline" })).toThrow(/reference/);
    const unlinked = { ...derived }; delete unlinked.sourceFontId;
    expect(validateProcessedFont(unlinked)).toEqual(unlinked);
  });
});
