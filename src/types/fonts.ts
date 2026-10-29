/** Processed centreline geometry uses native font units and a baseline with Y up. */
export interface CenterlinePoint { x: number; y: number; width: number }
export interface CenterlineStroke { points: CenterlinePoint[] }
export interface CenterlineGlyph { advanceWidth: number; paths: CenterlineStroke[] }
export interface ProcessedFont {
  version: 1;
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
  importFont: (characters?: string) => Promise<ProcessedFont | null>;
  remove: (id: string) => Promise<void>;
}
