import type { SvgImport, SvgPath } from "../../../../types";
import type { CenterlineGlyph, ProcessedFont } from "../../../../types/fonts";
import { createOutlineTemplate, outlinePathData, type OutlineTemplate, type TextInfill } from "./outlineText";

export interface TextSettings {
  text: string;
  fontSizeMM: number;
  letterSpacingMM: number;
  lineSpacing: number;
  alignment: "left" | "center" | "right";
  useStrokeWidths?: boolean;
  infill?: TextInfill;
  fillSpacingMM?: number;
  fillAngleDeg?: number;
  brushLeadInMM?: number;
}

export const DEFAULT_TEXT_SETTINGS: TextSettings = {
  text: "Terra Forge", fontSizeMM: 12, letterSpacingMM: 0, lineSpacing: 1.2, alignment: "left",
  useStrokeWidths: false, infill: "outline", fillSpacingMM: 0.3, fillAngleDeg: 45,
  brushLeadInMM: 1,
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
  outlineCount: number;
  fillCount: number;
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
  const infill = settings.infill ?? "outline", fillSpacing = settings.fillSpacingMM ?? 0.3, fillAngle = settings.fillAngleDeg ?? 45;
  if (!["outline", "solid", "sketch"].includes(infill)) throw new Error("Choose a valid text infill.");
  if (!Number.isFinite(fillSpacing) || fillSpacing < 0.05 || fillSpacing > 20) throw new Error("Fill spacing must be between 0.05 and 20 mm.");
  if (!Number.isFinite(fillAngle) || fillAngle < -360 || fillAngle > 360) throw new Error("Fill angle must be between -360 and 360 degrees.");
  if (settings.brushLeadInMM !== undefined && (!Number.isFinite(settings.brushLeadInMM) || settings.brushLeadInMM < 0.1 || settings.brushLeadInMM > 20)) throw new Error("Brush lead-in must be between 0.1 and 20 mm.");

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
  let outlineWork = 0, fillCount = 0;
  const outlined: { template: OutlineTemplate; x: number; baseline: number; character: string }[] = [];
  const templates = new Map<CenterlineGlyph, OutlineTemplate>();
  const paths: SvgPath[] = [];
  measured.forEach(({ glyphs, advance }, lineIndex) => {
    const offset = alignment === "center" ? (maxAdvance - advance) / 2 : alignment === "right" ? maxAdvance - advance : 0;
    const baseline = font.ascender * scale + lineIndex * baselineStep;
    for (const { character, glyph, x } of glyphs) {
      if (font.mode === "outline") {
        if (!glyph?.outline?.length) continue;
        let template = templates.get(glyph);
        if (!template) {
          template = createOutlineTemplate(glyph.outline, scale, infill, fillSpacing, fillAngle);
          templates.set(glyph, template); outlineWork += template.work;
          if (outlineWork > 12_000_000) throw new Error("This text infill is too detailed. Increase fill spacing or shorten the text.");
        }
        pointCount += glyph.outline.length + template.fills.length * 2;
        if (pointCount > MAX_TEXT_POINTS) throw new Error("This text is too detailed. Shorten it or increase fill spacing.");
        minX = Math.min(minX, offset + x + template.minX); maxX = Math.max(maxX, offset + x + template.maxX);
        minY = Math.min(minY, baseline + template.minY); maxY = Math.max(maxY, baseline + template.maxY);
        outlined.push({ template, x: offset + x, baseline, character });
        continue;
      }
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
  const addOutlinePath = (d: string, label: string) => {
    paths.push({ id: `text-stroke-${paths.length}`, d, svgSource: `<path d="${d}" fill="none" stroke="#000000"/>`,
      visible: true, label, sourceOutlineVisible: true, outlineVisible: true, strokeEnabled: true,
      sourceColor: "#000000", strokeColor: "#000000", hasFill: false });
  };
  for (const { template, x, baseline, character } of outlined) {
    addOutlinePath(outlinePathData(template.commands, scale, x - minX, baseline - minY), character);
    for (const fill of template.fills) {
      addOutlinePath(`M${(fill.x1 + x - minX).toFixed(6)} ${(fill.y1 + baseline - minY).toFixed(6)} L${(fill.x2 + x - minX).toFixed(6)} ${(fill.y2 + baseline - minY).toFixed(6)}`, `${infill === "sketch" ? "Sketch" : "Solid"} fill: ${character}`);
      fillCount++;
    }
  }
  return { width: Math.max(0.01, maxX - minX), height: Math.max(0.01, maxY - minY), paths,
    missingCharacters: [...missing], minStrokeWidth: Number.isFinite(minStrokeWidth) ? minStrokeWidth : 0, maxStrokeWidth,
    outlineCount: outlined.length, fillCount };
}

export function createTextImport(font: ProcessedFont, settings: TextSettings, layout: TextLayout, id: string): SvgImport {
  if (layout.missingCharacters.length) throw new Error("Choose a font that contains every character in the text.");
  if (!layout.paths.length) throw new Error("Enter text with at least one drawable character.");
  const mode = font.mode ?? "centerline";
  const useStrokeWidths = mode === "centerline" && (settings.useStrokeWidths ?? true);
  return {
    id, kind: "vector", name: `Text: ${settings.text.replace(/\s+/g, " ").trim().slice(0, 50)}`,
    x: 10, y: 10, scale: 1, rotation: 0, visible: true, svgWidth: layout.width, svgHeight: layout.height,
    viewBoxX: 0, viewBoxY: 0, paths: layout.paths.map((path, index) => ({ ...path, id: `${id}-stroke-${index}` })),
    hatchEnabled: false, strokeEnabled: true, strokeWidthMM: 0.25, useStrokeWidths,
    ...(useStrokeWidths ? { brushLeadInMM: settings.brushLeadInMM ?? 1 } : {}),
    textSource: { fontId: font.id, fontName: font.name, ...settings, mode, useStrokeWidths },
  };
}
