/** Font geometry uses native font units and a baseline with Y up. */
export type FontMode = "centerline" | "outline";
export type FontOutlineCommand =
  | { type: "M" | "L"; x: number; y: number }
  | { type: "Q"; x1: number; y1: number; x: number; y: number }
  | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { type: "Z" };
export interface CenterlinePoint { x: number; y: number; width: number }
export interface CenterlineStroke { points: CenterlinePoint[] }
export interface CenterlineGlyph {
  advanceWidth: number;
  paths: CenterlineStroke[];
  /** Original quadratic/cubic glyph contours, present for standard outline fonts. */
  outline?: FontOutlineCommand[];
}
export interface ProcessedFont {
  version: 1;
  /** Absent in older saved libraries, which contain centreline geometry. */
  mode?: FontMode;
  id: string;
  name: string;
  sourceName: string;
  createdAt: string;
  unitsPerEm: number;
  ascender: number;
  descender: number;
  lineGap: number;
  glyphs: Record<string, CenterlineGlyph>;
  /** Keys are two Unicode characters, values are adjustments in font units. */
  kerning: Record<string, number>;
  warnings: string[];
}
export interface FontsApi {
  list: () => Promise<ProcessedFont[]>;
  /** Prioritize characters from the text being composed when processing large fonts. */
  importFont: (characters?: string, mode?: FontMode) => Promise<ProcessedFont | null>;
  remove: (id: string) => Promise<void>;
}
