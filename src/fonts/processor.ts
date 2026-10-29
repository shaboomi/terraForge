import { parse, type PathCommand } from "opentype.js";
import type { CenterlineGlyph, FontMode, FontOutlineCommand, ProcessedFont } from "../types/fonts";
import { distanceField, simplifyStroke, thinMask, traceSkeleton } from "./skeleton";

interface Point { x: number; y: number }
export const FONT_PROCESSING_LIMITS = { fileBytes: 20 * 1024 * 1024, glyphs: 768, rasterDimension: 768, points: 600_000 } as const;
const PIXELS_PER_EM = 192;

function flattenOutline(commands: PathCommand[], step: number): Point[][] {
  const contours: Point[][] = [];
  let points: Point[] = [], current = { x: 0, y: 0 };
  const append = (p: Point) => { points.push(p); current = p; };
  const flush = () => { if (points.length > 2) contours.push(points); points = []; };
  for (const command of commands) {
    if (command.type === "M") { flush(); append({ x: command.x, y: command.y }); }
    else if (command.type === "L") append({ x: command.x, y: command.y });
    else if (command.type === "Q" || command.type === "C") {
      const start = current, end = { x: command.x, y: command.y }, a = { x: command.x1, y: command.y1 };
      const b = command.type === "C" ? { x: command.x2, y: command.y2 } : a;
      const polygonLength = Math.hypot(a.x-start.x,a.y-start.y) + Math.hypot(b.x-a.x,b.y-a.y) + Math.hypot(end.x-b.x,end.y-b.y);
      const count = Math.min(2048, Math.max(2, Math.ceil(polygonLength / step)));
      for (let i = 1; i <= count; i++) {
        const t = i/count, u = 1-t;
        append(command.type === "Q"
          ? { x:u*u*start.x+2*u*t*a.x+t*t*end.x, y:u*u*start.y+2*u*t*a.y+t*t*end.y }
          : { x:u*u*u*start.x+3*u*u*t*a.x+3*u*t*t*b.x+t*t*t*end.x, y:u*u*u*start.y+3*u*u*t*a.y+3*u*t*t*b.y+t*t*t*end.y });
      }
    } else if (command.type === "Z") flush();
  }
  flush();
  return contours;
}

/** Scanline fill follows the OpenType nonzero winding rule, preserving counters. */
export function rasterizeContours(contours: Point[][], pixelsPerUnit: number): { mask: Uint8Array; width: number; height: number; minX: number; minY: number; unit: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const contour of contours) for (const p of contour) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) throw new Error("Font contains non-finite outline coordinates.");
    minX = Math.min(minX,p.x); minY = Math.min(minY,p.y); maxX = Math.max(maxX,p.x); maxY = Math.max(maxY,p.y);
  }
  if (!Number.isFinite(minX)) return { mask: new Uint8Array(0), width: 0, height: 0, minX: 0, minY: 0, unit: 1 / pixelsPerUnit };
  const density = Math.min(pixelsPerUnit, (FONT_PROCESSING_LIMITS.rasterDimension-6)/Math.max(1,maxX-minX,maxY-minY));
  const unit = 1/density;
  minX -= 3*unit; minY -= 3*unit;
  const width = Math.ceil((maxX-minX)*density)+3, height = Math.ceil((maxY-minY)*density)+3;
  const mask = new Uint8Array(width*height);
  for (let y = 0; y < height; y++) {
    const scan = minY+(y+0.5)*unit;
    const hits: { x: number; winding: number }[] = [];
    for (const contour of contours) for (let i = 0; i < contour.length; i++) {
      const a = contour[i], b = contour[(i+1)%contour.length];
      if ((a.y <= scan && b.y > scan) || (b.y <= scan && a.y > scan)) hits.push({ x: a.x+(scan-a.y)*(b.x-a.x)/(b.y-a.y), winding: b.y > a.y ? 1 : -1 });
    }
    hits.sort((a,b) => a.x-b.x);
    let winding = 0;
    for (let i = 0; i < hits.length-1; i++) {
      winding += hits[i].winding;
      if (!winding) continue;
      const first = Math.max(0,Math.ceil((hits[i].x-minX)*density-0.5));
      const last = Math.min(width,Math.ceil((hits[i+1].x-minX)*density-0.5));
      mask.fill(1,y*width+first,y*width+last);
    }
  }
  return { mask,width,height,minX,minY,unit };
}

export function centerlineFromOutline(commands: PathCommand[], unitsPerEm: number): CenterlineGlyph["paths"] {
  if (commands.length > 50_000) throw new Error("Glyph outline exceeds the processing complexity limit.");
  const raster = rasterizeContours(flattenOutline(commands,unitsPerEm/PIXELS_PER_EM/2),PIXELS_PER_EM/unitsPerEm);
  if (!raster.mask.length) return [];
  const { mask,width,height,minX,minY,unit } = raster;
  const distances = distanceField(mask,width,height);
  const skeleton = thinMask(mask,width,height);
  return traceSkeleton(skeleton,width,height,(index) => ({
    x: minX+(index%width+0.5)*unit,
    y: minY+(Math.floor(index/width)+0.5)*unit,
    width: Math.max(unit,2*(Math.sqrt(distances[index])-0.5)*unit),
  })).map((path) => ({ points: simplifyStroke(path.points,unit*0.6).map((p) => ({ x:round(p.x),y:round(p.y),width:round(p.width) })) }));
}

function round(value: number): number { return Math.round(value*1000)/1000; }
function supportedCodepoint(code: number): boolean {
  return code >= 0x20 && code <= 0x24f || code >= 0x2000 && code <= 0x206f || code >= 0x20a0 && code <= 0x20cf;
}

export interface FontIdentity { id: string; sourceName: string; createdAt?: string; characters?: string; mode?: FontMode }

/** Derive centrelines from a saved font without needing its original TTF/OTF file again. */
export function convertOutlineFont(font: ProcessedFont, identity: { id: string; createdAt?: string }): ProcessedFont {
  if (font.mode !== "outline") throw new Error("Select a standard outline font to generate centrelines.");
  const glyphs: ProcessedFont["glyphs"] = {};
  let totalPoints = 0;
  for (const [character, glyph] of Object.entries(font.glyphs)) {
    if (!glyph.outline) throw new Error("The saved font is missing its original outlines. Import it again.");
    const paths = centerlineFromOutline(glyph.outline, font.unitsPerEm);
    totalPoints += paths.reduce((sum, path) => sum + path.points.length, 0);
    if (totalPoints > FONT_PROCESSING_LIMITS.points) throw new Error("Converted font exceeds the geometry limit. Choose a less detailed font.");
    glyphs[character] = { advanceWidth: glyph.advanceWidth, paths };
  }
  return {
    version: 1, id: identity.id, mode: "centerline", sourceFontId: font.id,
    name: font.name, sourceName: font.sourceName, createdAt: identity.createdAt ?? new Date().toISOString(),
    unitsPerEm: font.unitsPerEm, ascender: font.ascender, descender: font.descender, lineGap: font.lineGap,
    glyphs, kerning: { ...font.kerning }, warnings: [...new Set([...font.warnings,
      "Centreline and stroke widths are raster approximations at 192 pixels per em. Inspect fine details before plotting.",
    ])],
  };
}

/** Copy native contours without flattening, rasterizing or changing their winding. */
function copyOutline(commands: PathCommand[]): FontOutlineCommand[] {
  if (commands.length > 50_000) throw new Error("Glyph outline exceeds the processing complexity limit.");
  return commands.map((command) => {
    switch (command.type) {
      case "M": case "L": return { type:command.type,x:command.x,y:command.y };
      case "Q": return { type:"Q",x1:command.x1,y1:command.y1,x:command.x,y:command.y };
      case "C": return { type:"C",x1:command.x1,y1:command.y1,x2:command.x2,y2:command.y2,x:command.x,y:command.y };
      case "Z": return { type:"Z" };
      default: throw new Error("Font contains an unsupported outline command.");
    }
  });
}

/** Preserve TTF/OTF contours or convert them into centreline geometry. */
export function processFont(bytes: ArrayBuffer, identity: FontIdentity): ProcessedFont {
  const mode = identity.mode ?? "centerline";
  if (mode !== "centerline" && mode !== "outline") throw new Error("Choose centreline or standard outline font mode.");
  if (bytes.byteLength > FONT_PROCESSING_LIMITS.fileBytes || bytes.byteLength < 12) throw new Error("Choose a nonempty TTF or OTF font smaller than 20 MiB.");
  const signature = new DataView(bytes).getUint32(0);
  if (signature !== 0x00010000 && signature !== 0x4f54544f && signature !== 0x74727565) throw new Error("This file is not a supported TTF or OTF font.");
  const font = parse(bytes);
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm < 16 || font.unitsPerEm > 16384) throw new Error("Font has invalid em metrics.");
  if (!Number.isFinite(font.ascender) || !Number.isFinite(font.descender)) throw new Error("Font has invalid vertical metrics.");
  const cmap = font.tables.cmap.glyphIndexMap as Record<string,number>;
  const available = Object.keys(cmap).map(Number).filter((code) =>
    code <= 0x10ffff && code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && !(code >= 0xd800 && code <= 0xdfff) && cmap[code] > 0,
  ).sort((a,b) => a-b);
  const availableSet = new Set(available);
  const requested = [...(identity.characters ?? "")].map((character) => character.codePointAt(0)!).filter((code) => availableSet.has(code));
  const codes = [...new Set([...requested,...available.filter(supportedCodepoint),...available])].slice(0,FONT_PROCESSING_LIMITS.glyphs);
  if (!codes.length) throw new Error("This font has no mapped printable glyphs.");
  const glyphs: ProcessedFont["glyphs"] = {}, kerning: Record<string,number> = {}, warnings: string[] = [];
  if (codes.length < available.length) warnings.push(`Processed ${codes.length} of ${available.length} mapped characters (768-character limit). Text entered before import takes priority, followed by Latin and punctuation. Reimport with the required text to include other characters.`);
  if (mode === "centerline") warnings.push("Centreline and stroke widths are raster approximations at 192 pixels per em. Inspect fine details before plotting.");
  warnings.push("Complex-script shaping, ligatures and variable-font axes are not applied.");
  const cache = new Map<number,CenterlineGlyph>();
  let totalPoints = 0;
  for (const code of codes) {
    const character = String.fromCodePoint(code), glyph = font.charToGlyph(character);
    if (!cache.has(glyph.index)) {
      const outline = mode === "outline" ? copyOutline(glyph.path.commands) : undefined;
      const paths = mode === "centerline" ? centerlineFromOutline(glyph.path.commands,font.unitsPerEm) : [];
      totalPoints += outline?.length ?? paths.reduce((sum,path) => sum+path.points.length,0);
      if (totalPoints > FONT_PROCESSING_LIMITS.points) throw new Error("Processed font exceeds the geometry limit. Choose a less detailed font.");
      cache.set(glyph.index,{ advanceWidth: glyph.advanceWidth ?? font.unitsPerEm/2,paths,...(outline === undefined ? {} : {outline}) });
    }
    glyphs[character] = cache.get(glyph.index)!;
  }
  // Kerning is useful for the supported Latin repertoire and bounded by its size.
  const characters = Object.keys(glyphs);
  for (const left of characters) for (const right of characters) {
    const value = font.getKerningValue(font.charToGlyph(left),font.charToGlyph(right));
    if (Number.isFinite(value) && value) kerning[left+right] = value;
  }
  // The parser resolves the platform-specific OpenType name tables for us.
  const name = font.getEnglishName("fullName") || font.getEnglishName("fontFamily") || identity.sourceName;
  return {
    version:1,mode,id:identity.id,name:name.slice(0,200),sourceName:identity.sourceName.slice(0,255),createdAt:identity.createdAt ?? new Date().toISOString(),
    unitsPerEm:font.unitsPerEm,ascender:font.ascender,descender:font.descender,lineGap:font.tables.hhea?.lineGap ?? 0,glyphs,kerning,warnings,
  };
}
