/** Host-owned bitmap preparation. Independent implementation inspired by PR #128's shared tones.
 * No source is copied from the upstream renderer contract; this is an additive TerraForge contract.
 */
export interface PluginBitmapPreparationSettings {
  blackPoint: number;
  whitePoint: number;
  gamma: number;
  contrast: number;
  /** Box-filter radius in source pixels; zero disables smoothing. */
  smoothing: number;
  separation: "none" | "cmyk" | "rgb" | "palette";
  /** Ordered RGB colours, independent of real pen identifiers and plotting order. */
  palette: string[];
}

export const DEFAULT_BITMAP_PREPARATION: Readonly<PluginBitmapPreparationSettings> = Object.freeze({
  blackPoint: 0, whitePoint: 255, gamma: 1, contrast: 1, smoothing: 0,
  separation: "none", palette: Object.freeze([]) as unknown as string[],
});

export interface PreparedPluginBitmap {
  version: 1;
  widthPx: number;
  heightPx: number;
  settings: PluginBitmapPreparationSettings;
  /** sRGB luminance: 0 black/ink, 255 white/no ink. Transparency is already composited over white. */
  tones: Uint8Array;
  channels: Array<{
    id: string;
    label: string;
    color: string;
    /** CMYK/palette values are ink coverage; RGB values are additive light intensity. */
    model: "ink" | "light";
    data: Uint8Array;
  }>;
}

type Pixels = { widthPx: number; heightPx: number; data: Uint8Array };
const MAX_PIXELS = 16 * 1024 * 1024;
export const BITMAP_PREPARATION_MAX_BYTES = 32 * 1024 * 1024;
const KEYS = ["blackPoint", "whitePoint", "gamma", "contrast", "smoothing", "separation", "palette"];
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const byte = (value: number) => Math.round(clamp(value) * 255);

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error(`${label} must be a plain object.`);
  return value as Record<string, unknown>;
}

export function validateBitmapPreparationSettings(value: unknown): PluginBitmapPreparationSettings {
  const item = record(value, "Bitmap preparation settings");
  if (Object.keys(item).some((key) => !KEYS.includes(key))) throw new Error("Bitmap preparation settings contain unsupported fields.");
  const number = (key: string, min: number, max: number, integer = false): number => {
    const v = item[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      throw new Error(`Bitmap preparation ${key} must be ${integer ? "an integer " : ""}between ${min} and ${max}.`);
    }
    return v;
  };
  const blackPoint = number("blackPoint", 0, 254), whitePoint = number("whitePoint", 1, 255);
  if (blackPoint >= whitePoint) throw new Error("Bitmap preparation whitePoint must exceed blackPoint.");
  if (!["none", "cmyk", "rgb", "palette"].includes(String(item.separation))) throw new Error("Unsupported bitmap colour separation.");
  if (!Array.isArray(item.palette) || item.palette.length > 8 || item.palette.some((color) => typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) {
    throw new Error("Bitmap preparation palette must contain at most eight six-digit RGB colours.");
  }
  const palette = item.palette.map((color: string) => color.toLowerCase());
  if (new Set(palette).size !== palette.length) throw new Error("Bitmap preparation palette colours must be unique.");
  if (item.separation === "palette" && !palette.length) throw new Error("Choose at least one colour for palette separation.");
  return { blackPoint, whitePoint, gamma: number("gamma", 0.1, 5), contrast: number("contrast", 0, 3),
    smoothing: number("smoothing", 0, 4, true), separation: item.separation as PluginBitmapPreparationSettings["separation"], palette };
}

function pixelCount(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > MAX_PIXELS) {
    throw new Error("Bitmap preparation exceeds the input pixel limit.");
  }
  return width * height;
}

function bytes(value: unknown, length: number): Uint8Array {
  if (!(value instanceof Uint8Array) || !(value.buffer instanceof ArrayBuffer) || value.length !== length || value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
    throw new Error("Prepared bitmap data must be tightly sized, non-shared byte arrays.");
  }
  return new Uint8Array(value);
}

function preparationBudget(count: number, settings: PluginBitmapPreparationSettings): void {
  if (count * (1 + channelDefinitions(settings).length) > BITMAP_PREPARATION_MAX_BYTES) {
    throw new Error("Prepared tones and colour channels exceed the 32 MiB limit. Reduce the source image resolution or choose fewer separation channels.");
  }
}

/** Validate and detach preparation at an IPC boundary, without accepting executable UI or pen assignments. */
export function validatePreparedPluginBitmap(value: unknown, widthPx: number, heightPx: number): PreparedPluginBitmap {
  const item = record(value, "Prepared bitmap");
  if (Object.keys(item).some((key) => !["version", "widthPx", "heightPx", "settings", "tones", "channels"].includes(key)) ||
      item.version !== 1 || item.widthPx !== widthPx || item.heightPx !== heightPx) throw new Error("Prepared bitmap has an unsupported contract or mismatched frame.");
  const count = pixelCount(widthPx, heightPx), settings = validateBitmapPreparationSettings(item.settings);
  preparationBudget(count, settings);
  const expected = channelDefinitions(settings);
  if (!Array.isArray(item.channels) || item.channels.length !== expected.length) throw new Error("Prepared bitmap channels do not match its separation settings.");
  const channels = item.channels.map((value, index) => {
    const channel = record(value, "Prepared bitmap channel"), definition = expected[index];
    if (Object.keys(channel).some((key) => !["id", "label", "color", "model", "data"].includes(key)) ||
        channel.id !== definition.id || channel.label !== definition.label || channel.color !== definition.color || channel.model !== definition.model) {
      throw new Error("Prepared bitmap channel metadata is invalid.");
    }
    return { ...definition, data: bytes(channel.data, count) };
  });
  return { version: 1, widthPx, heightPx, settings, tones: bytes(item.tones, count), channels };
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Bitmap preparation cancelled.", "AbortError");
}

async function checkpoint(row: number, signal?: AbortSignal): Promise<void> {
  if (row % 64) return;
  cancelled(signal);
  await new Promise<void>((resolve) => {
    if (typeof MessageChannel === "undefined") { setTimeout(resolve, 0); return; }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
  cancelled(signal);
}

const rgb = (color: string) => [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255);

function channelDefinitions(settings: PluginBitmapPreparationSettings): Array<Omit<PreparedPluginBitmap["channels"][number], "data">> {
  if (settings.separation === "none") return [];
  const ink = settings.separation !== "rgb";
  const colors = settings.separation === "cmyk" ? ["#00ffff", "#ff00ff", "#ffff00", "#000000"]
    : settings.separation === "rgb" ? ["#ff0000", "#00ff00", "#0000ff"] : settings.palette;
  const labels = settings.separation === "cmyk" ? ["Cyan", "Magenta", "Yellow", "Black"]
    : settings.separation === "rgb" ? ["Red light", "Green light", "Blue light"] : colors;
  return colors.map((color, index) => ({ id: `${settings.separation}-${index}`, label: labels[index], color, model: ink ? "ink" : "light" }));
}

/**
 * Order: levels → gamma → contrast on straight RGB → alpha-weighted box smoothing → composite over white
 * → sRGB luminance and optional separation. Original RGBA is never overwritten or substituted.
 */
export async function preparePluginBitmap(pixels: Pixels, supplied: PluginBitmapPreparationSettings, signal?: AbortSignal): Promise<PreparedPluginBitmap> {
  const settings = validateBitmapPreparationSettings(supplied), { widthPx, heightPx, data } = pixels;
  const count = pixelCount(widthPx, heightPx);
  preparationBudget(count, settings);
  if (!(data instanceof Uint8Array) || data.length !== count * 4 || !(data.buffer instanceof ArrayBuffer)) throw new Error("Bitmap preparation requires RGBA8 pixels.");
  cancelled(signal);
  const colors = new Uint8Array(count * 3), lut = new Uint8Array(256);
  for (let index = 0; index < 256; index++) lut[index] = byte((Math.pow(clamp((index - settings.blackPoint) / (settings.whitePoint - settings.blackPoint)), 1 / settings.gamma) - 0.5) * settings.contrast + 0.5);
  for (let y = 0; y < heightPx; y++) {
    await checkpoint(y, signal);
    for (let x = 0; x < widthPx; x++) {
      const pixel = y * widthPx + x;
      for (let component = 0; component < 3; component++) colors[pixel * 3 + component] = lut[data[pixel * 4 + component]];
    }
  }
  const preparedColors = settings.smoothing ? await smooth(colors, data, widthPx, heightPx, settings.smoothing, signal) : colors;
  const result: PreparedPluginBitmap = { version: 1, widthPx, heightPx, settings, tones: new Uint8Array(count),
    channels: channelDefinitions(settings).map((channel) => ({ ...channel, data: new Uint8Array(count) })) };
  const paletteColors = settings.palette.map(rgb);
  for (let y = 0; y < heightPx; y++) {
    await checkpoint(y, signal);
    for (let x = 0; x < widthPx; x++) {
      const pixel = y * widthPx + x, alpha = data[pixel * 4 + 3] / 255;
      const r = preparedColors[pixel * 3] / 255 * alpha + 1 - alpha;
      const g = preparedColors[pixel * 3 + 1] / 255 * alpha + 1 - alpha;
      const b = preparedColors[pixel * 3 + 2] / 255 * alpha + 1 - alpha;
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      result.tones[pixel] = byte(luminance);
      separate(result, pixel, r, g, b, luminance, paletteColors, alpha);
    }
  }
  cancelled(signal);
  return result;
}

function separate(result: PreparedPluginBitmap, pixel: number, r: number, g: number, b: number, luminance: number, paletteColors: number[][], alpha: number): void {
  const channels = result.channels;
  if (result.settings.separation === "rgb") {
    // Additive RGB is intended for a dark substrate. Remove the white matte; apply alpha once.
    channels[0].data[pixel] = byte(r - 1 + alpha);
    channels[1].data[pixel] = byte(g - 1 + alpha);
    channels[2].data[pixel] = byte(b - 1 + alpha);
  } else if (result.settings.separation === "cmyk") {
    const k = 1 - Math.max(r, g, b), scale = 1 - k;
    channels[0].data[pixel] = scale === 0 ? 0 : byte((1 - r - k) / scale);
    channels[1].data[pixel] = scale === 0 ? 0 : byte((1 - g - k) / scale);
    channels[2].data[pixel] = scale === 0 ? 0 : byte((1 - b - k) / scale);
    channels[3].data[pixel] = byte(k);
  } else if (result.settings.separation === "palette") {
    let nearest = 0, distance = Infinity;
    for (let index = 0; index < paletteColors.length; index++) {
      const color = paletteColors[index], candidate = (r - color[0]) ** 2 + (g - color[1]) ** 2 + (b - color[2]) ** 2;
      if (candidate < distance) { nearest = index; distance = candidate; }
    }
    channels[nearest].data[pixel] = byte(1 - luminance);
  }
}

/** Small bounded radius; alpha-weighted neighbours prevent invisible RGB from bleeding into visible marks. */
async function smooth(colors: Uint8Array, rgba: Uint8Array, width: number, height: number, radius: number, signal?: AbortSignal): Promise<Uint8Array> {
  const output = new Uint8Array(colors.length);
  // Vertical sums, then a sliding horizontal window: O(pixels), independent of the radius.
  const columns = new Float64Array(width * 4);
  const addRow = (row: number, direction: number) => {
    for (let x = 0; x < width; x++) {
      const index = row * width + x, alpha = rgba[index * 4 + 3] * direction, column = x * 4;
      columns[column] += colors[index * 3] * alpha;
      columns[column + 1] += colors[index * 3 + 1] * alpha;
      columns[column + 2] += colors[index * 3 + 2] * alpha;
      columns[column + 3] += alpha;
    }
  };
  for (let row = 0; row <= Math.min(height - 1, radius); row++) addRow(row, 1);
  for (let y = 0; y < height; y++) {
    await checkpoint(y, signal);
    if (y > 0) {
      if (y - radius - 1 >= 0) addRow(y - radius - 1, -1);
      if (y + radius < height) addRow(y + radius, 1);
    }
    let red = 0, green = 0, blue = 0, weight = 0;
    const addColumn = (x: number, direction: number) => {
      const offset = x * 4;
      red += columns[offset] * direction; green += columns[offset + 1] * direction;
      blue += columns[offset + 2] * direction; weight += columns[offset + 3] * direction;
    };
    for (let column = 0; column <= Math.min(width - 1, radius); column++) addColumn(column, 1);
    for (let x = 0; x < width; x++) {
      if (x > 0) {
        if (x - radius - 1 >= 0) addColumn(x - radius - 1, -1);
        if (x + radius < width) addColumn(x + radius, 1);
      }
      const offset = (y * width + x) * 3;
      output[offset] = weight ? Math.round(red / weight) : 255;
      output[offset + 1] = weight ? Math.round(green / weight) : 255;
      output[offset + 2] = weight ? Math.round(blue / weight) : 255;
    }
  }
  return output;
}

function detached(value: PreparedPluginBitmap): PreparedPluginBitmap {
  return { ...value, settings: { ...value.settings, palette: [...value.settings.palette] }, tones: new Uint8Array(value.tones),
    channels: value.channels.map((channel) => ({ ...channel, data: new Uint8Array(channel.data) })) };
}

/** Bounded LRU; hash actual bytes so an asset ID, source name or mutable array can never cause a stale hit. */
export class PluginBitmapPreparationCache {
  private entries = new Map<string, { value: PreparedPluginBitmap; bytes: number }>();
  private retained = 0;
  readonly maxBytes: number;
  constructor(maxBytes = 32 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Bitmap cache budget must be a nonnegative integer.");
    this.maxBytes = maxBytes;
  }
  get byteLength(): number { return this.retained; }
  get size(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); this.retained = 0; }
  async prepare(pixels: Pixels, supplied: PluginBitmapPreparationSettings, signal?: AbortSignal): Promise<PreparedPluginBitmap> {
    const settings = validateBitmapPreparationSettings(supplied);
    const count = pixelCount(pixels.widthPx, pixels.heightPx);
    preparationBudget(count, settings);
    if (!(pixels.data instanceof Uint8Array) || pixels.data.byteLength !== count * 4 || !(pixels.data.buffer instanceof ArrayBuffer)) throw new Error("Bitmap preparation requires RGBA8 pixels.");
    cancelled(signal);
    const owned = { ...pixels, data: new Uint8Array(pixels.data) };
    const hash = await crypto.subtle.digest("SHA-256", owned.data);
    cancelled(signal);
    const key = `${owned.widthPx}x${owned.heightPx}:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}:${JSON.stringify(settings)}`;
    const cached = this.entries.get(key);
    if (cached) { this.entries.delete(key); this.entries.set(key, cached); return detached(cached.value); }
    const value = await preparePluginBitmap(owned, settings, signal);
    const bytes = value.tones.byteLength + value.channels.reduce((sum, channel) => sum + channel.data.byteLength, 0);
    if (bytes <= this.maxBytes) {
      while (this.retained + bytes > this.maxBytes) {
        const oldest = this.entries.keys().next().value;
        if (oldest === undefined) break;
        this.retained -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
      }
      const prior = this.entries.get(key);
      if (prior) this.retained -= prior.bytes;
      this.entries.set(key, { value, bytes }); this.retained += bytes;
      return detached(value);
    }
    return value;
  }
}
