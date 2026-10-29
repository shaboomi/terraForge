import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_BITMAP_PREPARATION, PluginBitmapPreparationCache, preparePluginBitmap,
  validateBitmapPreparationSettings, validatePreparedPluginBitmap } from "../../src/types/pluginBitmapPreparation";
import type { PluginBitmapPreparationSettings } from "../../src/types/pluginBitmapPreparation";
import type { PluginContext, PluginInput, PluginParameters, PluginResult } from "../../src/types";
import { parsePluginSource, validatePluginParameters, validatePluginResult } from "../../src/types/pluginValidation";

const settings = (changes: Partial<PluginBitmapPreparationSettings> = {}): PluginBitmapPreparationSettings => ({ ...DEFAULT_BITMAP_PREPARATION, palette: [], ...changes });
const pixels = (...colors: number[][]) => ({ widthPx: colors.length, heightPx: 1, data: new Uint8Array(colors.flat()) });

beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });

describe("host bitmap preparation", () => {
  it("keeps the full source frame and original straight RGBA, with brightness tones", async () => {
    const source = pixels([0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 128], [44, 88, 132, 0]);
    const original = source.data.slice();
    const prepared = await preparePluginBitmap(source, settings());
    expect(prepared).toMatchObject({ version: 1, widthPx: 4, heightPx: 1, channels: [] });
    expect([...prepared.tones]).toEqual([0, 255, 127, 255]);
    expect(source.data).toEqual(original);
  });

  it("uses explicit levels then gamma then contrast", async () => {
    const source = pixels([64, 64, 64, 255], [128, 128, 128, 255], [192, 192, 192, 255]);
    expect([...(await preparePluginBitmap(source, settings({ blackPoint: 64, whitePoint: 192 }))).tones]).toEqual([0, 128, 255]);
    const lightened = await preparePluginBitmap(source, settings({ gamma: 2 }));
    expect(lightened.tones[1]).toBeGreaterThan(128);
    const contrasted = await preparePluginBitmap(source, settings({ contrast: 2 }));
    expect([...contrasted.tones]).toEqual([0, 129, 255]);
  });

  it("keeps transparent pixels empty even when contrast would darken white", async () => {
    const prepared = await preparePluginBitmap(pixels([0, 0, 0, 0], [0, 0, 0, 128]), settings({ contrast: 0, separation: "cmyk" }));
    expect([...prepared.tones]).toEqual([255, 191]);
    expect(prepared.channels.every((channel) => channel.data[0] === 0)).toBe(true);
  });

  it("smooths only visible RGB and preserves original alpha coverage and edge windows", async () => {
    const source = pixels([0, 0, 0, 255], [255, 0, 0, 0], [255, 255, 255, 255]);
    const prepared = await preparePluginBitmap(source, settings({ smoothing: 1 }));
    expect([...prepared.tones]).toEqual([0, 255, 255]);
    expect([...source.data]).toEqual([0, 0, 0, 255, 255, 0, 0, 0, 255, 255, 255, 255]);
  });

  it("matches a reference two-dimensional alpha-weighted box filter", async () => {
    const source = { widthPx: 7, heightPx: 5, data: Uint8Array.from({ length: 7 * 5 * 4 }, (_, i) => (i * 47 + 31) % 256) };
    const prepared = await preparePluginBitmap(source, settings({ smoothing: 2 }));
    const expected: number[] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 7; x++) {
      let weight = 0; const sums = [0, 0, 0];
      for (let cy = Math.max(0, y - 2); cy <= Math.min(4, y + 2); cy++) for (let cx = Math.max(0, x - 2); cx <= Math.min(6, x + 2); cx++) {
        const index = (cy * 7 + cx) * 4, alpha = source.data[index + 3]; weight += alpha;
        for (let c = 0; c < 3; c++) sums[c] += source.data[index + c] * alpha;
      }
      const alpha = source.data[(y * 7 + x) * 4 + 3] / 255;
      const [r, g, b] = sums.map((sum) => Math.round(sum / weight) / 255 * alpha + 1 - alpha);
      expected.push(Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * 255));
    }
    expect([...prepared.tones]).toEqual(expected);
  });

  it("makes CMYK channels without assigning pens or plot order", async () => {
    const prepared = await preparePluginBitmap(pixels([0, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 255]), settings({ separation: "cmyk" }));
    expect(prepared.channels.map((channel) => channel.label)).toEqual(["Cyan", "Magenta", "Yellow", "Black"]);
    expect(prepared.channels.map((channel) => [...channel.data])).toEqual([[255, 0, 0], [0, 0, 0], [0, 0, 0], [0, 255, 0]]);
    expect(prepared.channels.every((channel) => channel.model === "ink" && !("penId" in channel) && !("plotOrder" in channel))).toBe(true);
  });

  it("defines RGB as additive primary-light amounts with alpha applied once", async () => {
    const prepared = await preparePluginBitmap(pixels([255, 0, 0, 128], [255, 255, 255, 0], [255, 255, 255, 255]), settings({ separation: "rgb" }));
    expect(prepared.channels.map((channel) => [...channel.data])).toEqual([[128, 0, 255], [0, 0, 255], [0, 0, 255]]);
    expect(prepared.channels.every((channel) => channel.model === "light")).toBe(true);
  });

  it("creates palette channels in selected order with zero marks for white", async () => {
    const prepared = await preparePluginBitmap(pixels([255, 0, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255]), settings({ separation: "palette", palette: ["#ff0000", "#0000ff"] }));
    expect(prepared.channels.map((channel) => channel.color)).toEqual(["#ff0000", "#0000ff"]);
    expect([...prepared.channels[0].data]).toEqual([201, 0, 0]);
    expect([...prepared.channels[1].data]).toEqual([0, 237, 0]);
  });

  it.each([
    { blackPoint: 255 }, { blackPoint: 80, whitePoint: 60 }, { contrast: NaN }, { gamma: 0 },
    { smoothing: 1.5 }, { smoothing: 5 }, { separation: "auto" }, { separation: "palette" },
    { palette: ["red"] }, { palette: ["#ff0000", "#FF0000"] }, { palette: Array(9).fill("#000000") },
    { html: "<button>" },
  ])("rejects malformed or unbounded settings %j", (changes) => {
    expect(() => validateBitmapPreparationSettings({ ...settings(), ...changes })).toThrow();
  });

  it("rejects excessive images and shared buffers before preparing", async () => {
    await expect(preparePluginBitmap({ widthPx: 8193, heightPx: 1, data: new Uint8Array(4) }, settings())).rejects.toThrow(/pixel limit/);
    await expect(preparePluginBitmap({ widthPx: 1, heightPx: 1, data: new Uint8Array(new SharedArrayBuffer(4)) }, settings())).rejects.toThrow(/RGBA8/);
    expect(() => validateBitmapPreparationSettings(Object.create(settings()))).toThrow(/plain object/);
  });

  it("bounds aggregate tones and channel bytes before allocation or IPC copying", async () => {
    const configuration = settings({ separation: "cmyk" });
    // The dimensions fit the legacy input budget, but five output planes exceed 32 MiB.
    await expect(preparePluginBitmap({ widthPx: 4096, heightPx: 2048, data: new Uint8Array(0) }, configuration)).rejects.toThrow(/32 MiB.*fewer separation/);
    expect(() => validatePreparedPluginBitmap({ version: 1, widthPx: 4096, heightPx: 2048, settings: configuration }, 4096, 2048)).toThrow(/32 MiB/);
    await expect(new PluginBitmapPreparationCache().prepare({ widthPx: 4096, heightPx: 2048, data: new Uint8Array(0) }, configuration)).rejects.toThrow(/32 MiB/);
  });

  it("detaches validated prepared payloads and checks channel metadata and byte sizes", async () => {
    const prepared = await preparePluginBitmap(pixels([10, 20, 30, 255]), settings({ separation: "cmyk" }));
    const copy = validatePreparedPluginBitmap(prepared, 1, 1);
    copy.tones[0] = 255;
    expect(prepared.tones[0]).not.toBe(255);
    expect(() => validatePreparedPluginBitmap(prepared, 2, 1)).toThrow(/frame/);
    expect(() => validatePreparedPluginBitmap({ ...prepared, channels: [] }, 1, 1)).toThrow(/channels/);
    expect(() => validatePreparedPluginBitmap({ ...prepared, tones: new Uint8Array(2) }, 1, 1)).toThrow(/byte arrays/);
    expect(() => validatePreparedPluginBitmap({ ...prepared, channels: prepared.channels.map((channel) => ({ ...channel, penId: "guess" })) }, 1, 1)).toThrow(/metadata/);
  });

  it("cancels before work and while yielding during preparation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(preparePluginBitmap(pixels([0, 0, 0, 255]), settings(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    const active = new AbortController();
    const running = preparePluginBitmap({ widthPx: 256, heightPx: 256, data: new Uint8Array(256 * 256 * 4) }, settings({ smoothing: 4 }), active.signal);
    setTimeout(() => active.abort(), 0);
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("bounded prepared bitmap cache", () => {
  it("copies outputs and invalidates for actual pixels, dimensions, levels, smoothing and palette order", async () => {
    const cache = new PluginBitmapPreparationCache(), source = pixels([0, 0, 0, 255], [255, 255, 255, 255]);
    const first = await cache.prepare(source, settings());
    first.tones[0] = 255;
    expect([...(await cache.prepare(source, settings())).tones]).toEqual([0, 255]);
    expect(cache.size).toBe(1);
    source.data[0] = 255; await cache.prepare(source, settings());
    await cache.prepare({ ...source, widthPx: 1, heightPx: 2 }, settings());
    await cache.prepare(source, settings({ contrast: 0.5 }));
    await cache.prepare(source, settings({ smoothing: 1 }));
    await cache.prepare(source, settings({ separation: "palette", palette: ["#ff0000", "#000000"] }));
    await cache.prepare(source, settings({ separation: "palette", palette: ["#000000", "#ff0000"] }));
    expect(cache.size).toBe(7);
  });

  it("evicts the least recently used buffer and bypasses entries exceeding its memory limit", async () => {
    const cache = new PluginBitmapPreparationCache(2);
    await cache.prepare(pixels([0, 0, 0, 255]), settings());
    await cache.prepare(pixels([255, 255, 255, 255]), settings());
    await cache.prepare(pixels([0, 0, 0, 255]), settings());
    await cache.prepare(pixels([255, 0, 0, 255]), settings());
    expect(cache.size).toBe(2); expect(cache.byteLength).toBe(2);
    await cache.prepare(pixels([255, 0, 0, 255]), settings({ separation: "cmyk" }));
    expect(cache.size).toBe(2); expect(cache.byteLength).toBe(2);
    cache.clear(); expect(cache.size).toBe(0); expect(cache.byteLength).toBe(0);
  });

  it("takes one private pixel snapshot for hashing and calculation", async () => {
    const cache = new PluginBitmapPreparationCache(), source = pixels([0, 0, 0, 255]);
    const first = cache.prepare(source, settings());
    source.data[0] = source.data[1] = source.data[2] = 255;
    expect([...(await first).tones]).toEqual([0]);
    expect([...(await cache.prepare(source, settings())).tones]).toEqual([255]);
    expect(cache.size).toBe(2);
  });

  it("keys captured dimensions even if the caller changes its object while hashing", async () => {
    const cache = new PluginBitmapPreparationCache(), source = pixels([0, 0, 0, 255], [255, 255, 255, 255]);
    const first = cache.prepare(source, settings());
    source.widthPx = 1; source.heightPx = 2;
    expect(await first).toMatchObject({ widthPx: 2, heightPx: 1 });
    expect(await cache.prepare(source, settings())).toMatchObject({ widthPx: 1, heightPx: 2 });
    expect(cache.size).toBe(2);
  });

  it("does not retain cancelled work", async () => {
    const cache = new PluginBitmapPreparationCache(), controller = new AbortController(); controller.abort();
    await expect(cache.prepare(pixels([0, 0, 0, 255]), settings(), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.size).toBe(0);
  });
});

describe("distributed Prepared Scanlines example", () => {
  const source = readFileSync("docs/examples/prepared-scanlines.tf-plugin.js", "utf8");
  const manifest = parsePluginSource(source);
  const run = new Function(source.replace("export default function run", "return function run"))() as
    (input: PluginInput, parameters: PluginParameters, context: PluginContext) => PluginResult;
  const context = (): PluginContext => ({ runId: "prepared-example", signal: new AbortController().signal, progress: vi.fn(), seed: 1 });
  const input = async (configuration = settings()): Promise<Extract<PluginInput, { kind: "bitmap" }>> => {
    const image = pixels([0, 255, 255, 255], [0, 0, 0, 255], [0, 0, 0, 0], [255, 255, 255, 255]);
    return { ...image, kind: "bitmap", width: 4, height: 1, sourceId: "original", palette: [], page: { widthMM: 100, heightMM: 100 },
      placement: { x: 12, y: 15, scale: 3, scaleX: 2, scaleY: 4, rotation: 31 }, prepared: await preparePluginBitmap(image, configuration) };
  };

  it("opts in and returns complete labelled colour layers without real pen guesses", async () => {
    expect(manifest.bitmapPreparation).toBe(true);
    const bitmap = await input(settings({ separation: "cmyk" }));
    const original = bitmap.data.slice();
    const parameters = validatePluginParameters(manifest, { spacing: 1, threshold: 128 });
    const result = validatePluginResult(run(bitmap, parameters, context()), { runId: "prepared-example", pluginId: manifest.id, input: bitmap, parameters }, manifest);
    expect("items" in result).toBe(true);
    if (!("items" in result)) throw new Error("Expected structured layers");
    expect(result.items.map((item) => item.name)).toEqual(["Cyan", "Black"]);
    expect(result.items.map((item) => item.kind === "vector" && item.paths[0].color)).toEqual(["#00ffff", "#000000"]);
    expect(result.items.every((item) => item.kind === "vector" && item.width === 4 && item.height === 1 && !item.penId && item.paths.every((path) => !path.penId))).toBe(true);
    expect(bitmap.data).toEqual(original);
  });

  it("uses prepared brightness once and rejects cancellation, unavailable preparation and insufficient detail", async () => {
    const bitmap = await input(), parameters = validatePluginParameters(manifest, { spacing: 1, threshold: 128 });
    const result = run(bitmap, parameters, context());
    expect("items" in result && result.items[0].name).toBe("Prepared tones");
    expect(() => run({ ...bitmap, prepared: undefined }, parameters, context())).toThrow(/supporting shared bitmap/);
    const cancelledContext = context(); cancelledContext.signal = AbortSignal.abort();
    expect(() => run(bitmap, parameters, cancelledContext)).toThrow(/Cancelled/);
    expect(() => run(bitmap, parameters, { ...context(), limits: { paths: 1, points: 1, executionMs: 1000 } })).toThrow(/complete scanlines exceed/);
  });
});
