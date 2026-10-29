import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProcessedFont } from "../../types/fonts";
import { readBoundedFile } from "../files/boundedFile";

const MAX_STORED_BYTES = 20 * 1024 * 1024;
const MAX_FONTS = 50;
function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[a-z0-9-]{1,80}$/i.test(id)) throw new Error("Invalid font library identifier.");
}

function validateOutline(value: unknown): number {
  if (!Array.isArray(value) || value.length > 50_000) throw new Error("Invalid font outline command count.");
  let open = false;
  for (const command of value) {
    if (!command || typeof command !== "object" || Array.isArray(command)) throw new Error("Invalid font outline command.");
    const fields = command.type === "M" || command.type === "L" ? ["x","y"] : command.type === "Q" ? ["x1","y1","x","y"] : command.type === "C" ? ["x1","y1","x2","y2","x","y"] : command.type === "Z" ? [] : null;
    if (!fields || Object.keys(command).some((key) => key !== "type" && !fields.includes(key))) throw new Error("Invalid font outline command.");
    for (const key of fields) if (typeof command[key] !== "number" || !Number.isFinite(command[key]) || Math.abs(command[key]) > 1e7) throw new Error("Invalid font outline coordinate.");
    if (command.type === "M") {
      if (open) throw new Error("Font outline contours must be closed.");
      open = true;
    } else {
      if (!open) throw new Error("Font outline must start with a move command.");
      if (command.type === "Z") open = false;
    }
  }
  if (open) throw new Error("Font outline contours must be closed.");
  return value.length;
}

/** Validate persisted geometry before it reaches the renderer or G-code engine. */
export function validateProcessedFont(value: unknown): ProcessedFont {
  if (!value || typeof value !== "object") throw new Error("Invalid processed font.");
  const font = value as ProcessedFont;
  assertId(font.id);
  if (font.version !== 1 || typeof font.name !== "string" || !font.name || font.name.length > 200 || typeof font.sourceName !== "string" || typeof font.createdAt !== "string") throw new Error("Invalid font metadata.");
  if (font.mode !== undefined && font.mode !== "centerline" && font.mode !== "outline") throw new Error("Invalid font mode.");
  if (!Number.isFinite(font.unitsPerEm) || font.unitsPerEm < 16 || font.unitsPerEm > 16384 || !Number.isFinite(font.ascender) || !Number.isFinite(font.descender) || !Number.isFinite(font.lineGap)) throw new Error("Invalid font metrics.");
  if (!font.glyphs || typeof font.glyphs !== "object" || Array.isArray(font.glyphs) || Object.keys(font.glyphs).length > 768) throw new Error("Invalid font glyph library.");
  let count = 0;
  for (const [character,glyph] of Object.entries(font.glyphs)) {
    if ([...character].length !== 1 || !glyph || !Number.isFinite(glyph.advanceWidth) || !Array.isArray(glyph.paths)) throw new Error("Invalid font glyph.");
    if (font.mode === "outline") {
      if (glyph.paths.length) throw new Error("Standard outline fonts cannot contain centreline strokes.");
      count += validateOutline(glyph.outline);
      if (count > 600_000) throw new Error("Font geometry exceeds library limits.");
    } else if (glyph.outline !== undefined) throw new Error("Centreline fonts cannot contain standard outlines.");
    for (const path of glyph.paths) {
      if (!Array.isArray(path.points) || path.points.length < 2) throw new Error("Invalid font stroke.");
      count += path.points.length;
      if (count > 600_000) throw new Error("Font geometry exceeds library limits.");
      for (const p of path.points) if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.width) || p.width <= 0 || Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7 || p.width > 1e7) throw new Error("Invalid font width or coordinate.");
    }
  }
  if (!font.kerning || typeof font.kerning !== "object" || Object.entries(font.kerning).some(([pair,value]) => [...pair].length !== 2 || !Number.isFinite(value))) throw new Error("Invalid font kerning.");
  if (!Array.isArray(font.warnings) || font.warnings.some((warning) => typeof warning !== "string")) throw new Error("Invalid font warnings.");
  return font;
}

export function createFontLibrary(directory: string) {
  // Serialize read/modify operations so list/remove cannot race an import write.
  let pending: Promise<unknown> = Promise.resolve();
  function transaction<T>(run: () => Promise<T>): Promise<T> {
    const result = pending.then(run,run);
    pending = result.catch(() => {});
    return result;
  }
  const names = async () => {
    await mkdir(directory,{ recursive:true });
    return (await readdir(directory)).filter((name) => /^[a-z0-9-]+\.json$/i.test(name));
  };
  return {
    list: () => transaction(async () => {
      const entries = await names();
      if (entries.length > MAX_FONTS) throw new Error("Font library exceeds its 50-font limit.");
      const fonts: ProcessedFont[] = [];
      for (const name of entries) {
        const bytes = await readBoundedFile(join(directory,name),MAX_STORED_BYTES,"Processed font");
        fonts.push(validateProcessedFont(JSON.parse(bytes.toString("utf8"))));
      }
      return fonts.sort((a,b) => a.name.localeCompare(b.name));
    }),
    save: (value: ProcessedFont) => transaction(async () => {
      const font = validateProcessedFont(value), entries = await names();
      if (entries.length >= MAX_FONTS && !entries.includes(`${font.id}.json`)) throw new Error("The font library is full (50 fonts). Remove a font before importing another.");
      const data = JSON.stringify(font);
      if (Buffer.byteLength(data) > MAX_STORED_BYTES) throw new Error("Processed font exceeds the library file limit.");
      const target = join(directory,`${font.id}.json`), temporary = `${target}.tmp`;
      try { await writeFile(temporary,data,"utf8"); await rename(temporary,target); }
      finally { await unlink(temporary).catch(() => {}); }
    }),
    remove: (id: unknown) => transaction(async () => {
      assertId(id);
      try { await unlink(join(directory,`${id}.json`)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }),
  };
}
