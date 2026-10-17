import type { BitmapColorData } from "./bitmapImage";
import type { RendererSource } from "../../../../types";

export interface SeparatedChannel {
  label: string;
  color: string;
  luminance: RendererSource;
}

export interface CustomPaletteSwatch {
  label: string;
  color: string;
}

/**
 * Renderers read `RendererSource` as standard photographic luminance — 0 is
 * black/needs-ink, 255 is white/no-ink (see `toneSpine/sampling`'s `luminanceAt`).
 * Separation instead reasons in ink "density" (0 = no ink, 255 = full ink)
 * since that's how each mode below is naturally expressed, so every mode
 * converts through this at the end to hand renderers the convention they
 * already expect — unmodified, whether in-tree or an external plugin.
 *
 * Inverts in place and hands back the same buffer. Each caller builds its
 * density array purely to convert it, and at full-resolution these arrays are
 * megabytes each — a separate output buffer per channel doubled the memory a
 * separation touched for no gain. The density array must not be read after
 * being passed here.
 */
function densityToLuminanceInPlace(
  density: Uint8Array,
  width: number,
  height: number,
): RendererSource {
  for (let i = 0; i < density.length; i++) density[i] = 255 - density[i];
  return { width, height, values: density };
}

/**
 * Red, green and blue as light inks on dark paper — additive, like light:
 * each ink's density is how much of its primary the pixel has, so white
 * gets all three at full strength and black gets none. Right for light,
 * metallic or gel inks on black card; on white paper it inverts the image,
 * which is what `separateRGBOnWhite` is for.
 */
export function separateRGB(image: BitmapColorData): SeparatedChannel[] {
  const pixelCount = image.width * image.height;
  const channels: [string, string, number][] = [
    ["Red", "#ff0000", 0],
    ["Green", "#00ff00", 1],
    ["Blue", "#0000ff", 2],
  ];
  return channels.map(([label, color, offset]) => {
    const density = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) density[i] = image.rgba[i * 4 + offset];
    return { label, color, luminance: densityToLuminanceInPlace(density, image.width, image.height) };
  });
}

/**
 * Red, green and blue pens on white paper. On paper an ink works by
 * absorbing light: a red pen reflects red and absorbs green and blue. So
 * each primary the pixel is missing has to be absorbed by the two inks that
 * absorb it — missing green by red and blue ink, and so on — which solves
 * to each ink's density being half of (the two primaries it absorbs, less
 * the one it doesn't). White needs no ink, a pure red only the red pen, and
 * black all three at half strength.
 *
 * Red, green and blue pens cannot mix every colour on paper: a yellow, for
 * instance, comes out as a dull mix of red and green. For the widest range on
 * white paper, CMY/CMYK remain the better choice.
 */
export function separateRGBOnWhite(image: BitmapColorData): SeparatedChannel[] {
  const pixelCount = image.width * image.height;
  const red = new Uint8Array(pixelCount);
  const green = new Uint8Array(pixelCount);
  const blue = new Uint8Array(pixelCount);
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const missingRed = 255 - image.rgba[offset];
    const missingGreen = 255 - image.rgba[offset + 1];
    const missingBlue = 255 - image.rgba[offset + 2];
    red[i] = clamp((missingGreen + missingBlue - missingRed) / 2);
    green[i] = clamp((missingRed + missingBlue - missingGreen) / 2);
    blue[i] = clamp((missingRed + missingGreen - missingBlue) / 2);
  }
  return [
    { label: "Red", color: "#ff0000", luminance: densityToLuminanceInPlace(red, image.width, image.height) },
    { label: "Green", color: "#00ff00", luminance: densityToLuminanceInPlace(green, image.width, image.height) },
    { label: "Blue", color: "#0000ff", luminance: densityToLuminanceInPlace(blue, image.width, image.height) },
  ];
}

/** Standard subtractive complement of RGB: density(C) = 255-R, etc. */
export function separateCMY(image: BitmapColorData): SeparatedChannel[] {
  const pixelCount = image.width * image.height;
  const cyan = new Uint8Array(pixelCount);
  const magenta = new Uint8Array(pixelCount);
  const yellow = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const r = image.rgba[offset];
    const g = image.rgba[offset + 1];
    const b = image.rgba[offset + 2];
    cyan[i] = 255 - r;
    magenta[i] = 255 - g;
    yellow[i] = 255 - b;
  }
  return [
    { label: "Cyan", color: "#00ffff", luminance: densityToLuminanceInPlace(cyan, image.width, image.height) },
    { label: "Magenta", color: "#ff00ff", luminance: densityToLuminanceInPlace(magenta, image.width, image.height) },
    { label: "Yellow", color: "#ffff00", luminance: densityToLuminanceInPlace(yellow, image.width, image.height) },
  ];
}

/** CMY plus a naive 100% under-colour-removal black: K = min(C,M,Y), then
 * subtract K from each of C/M/Y. A simple, well-known approximation — not a
 * colour-managed separation. */
export function separateCMYK(image: BitmapColorData): SeparatedChannel[] {
  const pixelCount = image.width * image.height;
  const cyan = new Uint8Array(pixelCount);
  const magenta = new Uint8Array(pixelCount);
  const yellow = new Uint8Array(pixelCount);
  const black = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const offset = i * 4;
    const cRaw = 255 - image.rgba[offset];
    const mRaw = 255 - image.rgba[offset + 1];
    const yRaw = 255 - image.rgba[offset + 2];
    const k = Math.min(cRaw, mRaw, yRaw);
    black[i] = k;
    cyan[i] = cRaw - k;
    magenta[i] = mRaw - k;
    yellow[i] = yRaw - k;
  }
  return [
    { label: "Cyan", color: "#00ffff", luminance: densityToLuminanceInPlace(cyan, image.width, image.height) },
    { label: "Magenta", color: "#ff00ff", luminance: densityToLuminanceInPlace(magenta, image.width, image.height) },
    { label: "Yellow", color: "#ffff00", luminance: densityToLuminanceInPlace(yellow, image.width, image.height) },
    { label: "Black", color: "#000000", luminance: densityToLuminanceInPlace(black, image.width, image.height) },
  ];
}

const MAX_RGB_DISTANCE = Math.sqrt(3 * 255 * 255);

function parseHexColor(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const expanded = normalized.length === 3
    ? normalized.split("").map((c) => c + c).join("")
    : normalized;
  const num = parseInt(expanded, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/**
 * Assigns each pixel a per-swatch ink density proportional to how close its
 * colour is to that swatch (closer = more ink), independently per swatch.
 * A simple proximity model, not a solved multi-ink mixing optimisation —
 * intentionally so; see the plan for why this stays simple in the first pass.
 */
export function separateCustomPalette(
  image: BitmapColorData,
  palette: CustomPaletteSwatch[],
): SeparatedChannel[] {
  const pixelCount = image.width * image.height;
  return palette.map((swatch) => {
    const [sr, sg, sb] = parseHexColor(swatch.color);
    const density = new Uint8Array(pixelCount);
    for (let i = 0; i < pixelCount; i++) {
      const offset = i * 4;
      const dr = image.rgba[offset] - sr;
      const dg = image.rgba[offset + 1] - sg;
      const db = image.rgba[offset + 2] - sb;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      density[i] = Math.max(0, Math.round(255 * (1 - distance / MAX_RGB_DISTANCE)));
    }
    return {
      label: swatch.label,
      color: swatch.color,
      luminance: densityToLuminanceInPlace(density, image.width, image.height),
    };
  });
}
