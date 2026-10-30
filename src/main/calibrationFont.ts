import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { CalibrationFontData } from "../types";

/** Only known system fonts are exposed; callers cannot supply a filesystem path. */
export function calibrationFontCandidates(platform = process.platform): [string, string][] {
  if (platform === "win32") {
    const fonts = join(process.env.WINDIR ?? "C:\\Windows", "Fonts");
    return [["Arial", join(fonts, "arial.ttf")], ["Segoe UI", join(fonts, "segoeui.ttf")]];
  }
  if (platform === "darwin") return [
    ["Arial", "/System/Library/Fonts/Supplemental/Arial.ttf"],
    ["Arial", "/Library/Fonts/Arial.ttf"],
  ];
  return [
    ["Arial", "/usr/share/fonts/truetype/msttcorefonts/Arial.ttf"],
    ["Arial", "/usr/share/fonts/truetype/msttcorefonts/arial.ttf"],
    ["Liberation Sans", "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"],
    ["Liberation Sans", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"],
    ["Liberation Sans", "/usr/share/fonts/liberation-sans/LiberationSans-Regular.ttf"],
    ["DejaVu Sans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"],
    ["DejaVu Sans", "/usr/share/fonts/TTF/DejaVuSans.ttf"],
  ];
}

export async function readCalibrationFont(): Promise<CalibrationFontData> {
  for (const [family, path] of calibrationFontCandidates()) {
    try {
      const info = await stat(path);
      if (!info.isFile() || info.size > 16 * 1024 * 1024) continue;
      return { family, bytes: new Uint8Array(await readFile(path)) };
    } catch { /* Try the next standard sans-serif font installed on this system. */ }
  }
  throw new Error("No supported system font was found. Install Arial, Liberation Sans or DejaVu Sans to label calibration sheets.");
}
