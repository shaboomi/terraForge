import type { SvgImport, SvgPath } from "../../../../types";
import type { ProcessedFont } from "../../../../types/fonts";

export interface TextSettings {
  text: string;
  fontSizeMM: number;
  letterSpacingMM: number;
  lineSpacing: number;
  alignment: "left" | "center" | "right";
}

export const DEFAULT_TEXT_SETTINGS: TextSettings = {
  text: "Terra Forge", fontSizeMM: 12, letterSpacingMM: 0, lineSpacing: 1.2, alignment: "left",
};
export const MAX_TEXT_CHARACTERS = 2000;
const MAX_TEXT_POINTS = 250_000;

export interface TextLayout {
  width: number;
  height: number;
  paths: SvgPath[];
  missingCharacters: string[];
  minStrokeWidth: number;
  maxStrokeWidth: number;
}

/** Layout in millimetres with top-left/Y-down coordinates, retaining each width sample. */
export function layoutText(font: ProcessedFont, settings: TextSettings): TextLayout {
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm <= 0 ||
      ![font.ascender, font.descender, font.lineGap].every(Number.isFinite)) {
    throw new Error("The selected font has invalid metrics. Import it again.");
  }
  const { fontSizeMM, letterSpacingMM, lineSpacing, alignment } = settings;
  if (!Number.isFinite(fontSizeMM) || fontSizeMM < 1 || fontSizeMM > 1000) throw new Error("Font size must be between 1 and 1000 mm.");
  if (!Number.isFinite(letterSpacingMM) || letterSpacingMM < -fontSizeMM / 2 || letterSpacingMM > 1000) {
    throw new Error("Letter spacing must be between minus half the font size and 1000 mm.");
  }
  if (!Number.isFinite(lineSpacing) || lineSpacing < 0.5 || lineSpacing > 5) throw new Error("Line spacing must be between 0.5 and 5.");
  if (!["left", "center", "right"].includes(alignment)) throw new Error("Choose a valid text alignment.");
  if ([...settings.text].length > MAX_TEXT_CHARACTERS) throw new Error(`Text is limited to ${MAX_TEXT_CHARACTERS} characters.`);

  const scale = fontSizeMM / font.unitsPerEm;
  const missing = new Set<string>();
  const lines = settings.text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n");
  const measured = lines.map((line) => {
    let advance = 0;
    let previous = "";
    const glyphs = [...line].map((character, index) => {
      const glyph = font.glyphs[character];
      if (!glyph && character !== " ") missing.add(character);
      if (index > 0) advance += letterSpacingMM + (font.kerning?.[previous + character] ?? 0) * scale;
      const x = advance;
      advance += (glyph?.advanceWidth ?? font.glyphs[" "]?.advanceWidth ?? font.unitsPerEm / 3) * scale;
      previous = character;
      return { character, glyph, x };
    });
    return { glyphs, advance };
  });
  const maxAdvance = Math.max(0, ...measured.map((line) => line.advance));
  const fontHeight = Math.max(font.unitsPerEm, font.ascender - font.descender);
  const baselineStep = Math.max(font.unitsPerEm, font.ascender - font.descender + font.lineGap) * scale * lineSpacing;
  let minX = 0, minY = 0, maxX = maxAdvance, maxY = fontHeight * scale + (lines.length - 1) * baselineStep;
  let minStrokeWidth = Infinity, maxStrokeWidth = 0, pointCount = 0;
  const paths: SvgPath[] = [];
  measured.forEach(({ glyphs, advance }, lineIndex) => {
    const offset = alignment === "center" ? (maxAdvance - advance) / 2 : alignment === "right" ? maxAdvance - advance : 0;
    const baseline = font.ascender * scale + lineIndex * baselineStep;
    for (const { character, glyph, x } of glyphs) {
      for (const stroke of glyph?.paths ?? []) {
        pointCount += stroke.points.length;
        if (pointCount > MAX_TEXT_POINTS) throw new Error("This text is too detailed. Shorten it or use a simpler font.");
        if (stroke.points.length < 2) continue;
        const points = stroke.points.map((point) => {
          if (![point.x, point.y, point.width].every(Number.isFinite) || point.width <= 0) throw new Error("The selected font has invalid stroke data. Import it again.");
          const placed = { x: offset + x + point.x * scale, y: baseline - point.y * scale, width: point.width * scale };
          minX = Math.min(minX, placed.x - placed.width / 2);
          minY = Math.min(minY, placed.y - placed.width / 2);
          maxX = Math.max(maxX, placed.x + placed.width / 2);
          maxY = Math.max(maxY, placed.y + placed.width / 2);
          minStrokeWidth = Math.min(minStrokeWidth, placed.width);
          maxStrokeWidth = Math.max(maxStrokeWidth, placed.width);
          return placed;
        });
        paths.push({ id: `text-stroke-${paths.length}`, d: "", svgSource: "", visible: true,
          label: character, sourceOutlineVisible: true, outlineVisible: true, strokeEnabled: true,
          sourceColor: "#000000", strokeColor: "#000000", hasFill: false, centerline: { points } });
      }
    }
  });
  for (const path of paths) {
    for (const point of path.centerline!.points) { point.x -= minX; point.y -= minY; }
    path.d = path.centerline!.points.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(6)} ${point.y.toFixed(6)}`).join(" ");
    path.svgSource = `<path d="${path.d}" fill="none" stroke="#000000"/>`;
  }
  return { width: Math.max(0.01, maxX - minX), height: Math.max(0.01, maxY - minY), paths,
    missingCharacters: [...missing], minStrokeWidth: Number.isFinite(minStrokeWidth) ? minStrokeWidth : 0, maxStrokeWidth };
}

export function createTextImport(font: ProcessedFont, settings: TextSettings, layout: TextLayout, id: string): SvgImport {
  if (layout.missingCharacters.length) throw new Error("Choose a font that contains every character in the text.");
  if (!layout.paths.length) throw new Error("Enter text with at least one drawable character.");
  return {
    id, kind: "vector", name: `Text: ${settings.text.replace(/\s+/g, " ").trim().slice(0, 50)}`,
    x: 10, y: 10, scale: 1, rotation: 0, visible: true, svgWidth: layout.width, svgHeight: layout.height,
    viewBoxX: 0, viewBoxY: 0, paths: layout.paths.map((path, index) => ({ ...path, id: `${id}-stroke-${index}` })),
    hatchEnabled: false, strokeEnabled: true, strokeWidthMM: 0.25,
    textSource: { fontId: font.id, fontName: font.name, ...settings },
  };
}
