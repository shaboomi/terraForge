import { describe, expect, it, vi, afterEach } from "vitest";
import { bitmapInitialPlacement, inspectBitmapSource, normaliseBitmapAsset } from "./bitmapImport";
import { BITMAP_LIMITS } from "../../../../../types/bitmapValidation";

function png(width = 12, height = 8): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([73, 72, 68, 82], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}
function jpeg(width = 12, height = 8, marker = 0xc0): Uint8Array {
  const bytes = new Uint8Array([0xff,0xd8,0xff,0xe0,0,4,0,0,0xff,marker,0,8,8,0,0,0,0,1]);
  const view = new DataView(bytes.buffer);
  view.setUint16(13, height);
  view.setUint16(15, width);
  return bytes;
}

afterEach(() => vi.unstubAllGlobals());

describe("bitmap source inspection before decoding", () => {
  it("reads PNG dimensions and accepts uppercase extensions", () => {
    expect(inspectBitmapSource(png(), "IMAGE.PNG")).toEqual({ mimeType: "image/png", widthPx: 12, heightPx: 8 });
  });
  it.each([0xc0, 0xc1, 0xc2])("finds JPEG frame dimensions after metadata for marker %i", (marker) => {
    expect(inspectBitmapSource(jpeg(23, 14, marker), "photo.JpEg")).toEqual({ mimeType: "image/jpeg", widthPx: 23, heightPx: 14 });
  });
  it("uses the correct byte offset for a sliced buffer", () => {
    const full = new Uint8Array(40);
    full.set(png(), 7);
    expect(inspectBitmapSource(full.subarray(7), "image.png").widthPx).toBe(12);
  });
  it("requires signatures to match the declared file format", () => {
    expect(() => inspectBitmapSource(jpeg(), "wrong.png")).toThrow(/valid PNG/);
    expect(() => inspectBitmapSource(png(), "wrong.jpg")).toThrow(/valid JPEG/);
    expect(() => inspectBitmapSource(png(), "image.webp")).toThrow(/Unsupported bitmap/);
  });
  it("rejects missing, truncated and invalid PNG headers", () => {
    expect(() => inspectBitmapSource(new Uint8Array(), "x.png")).toThrow();
    expect(() => inspectBitmapSource(png().subarray(0, 24), "x.png")).toThrow();
    const invalid = png(); invalid[12] = 0;
    expect(() => inspectBitmapSource(invalid, "x.png")).toThrow();
    expect(() => inspectBitmapSource(png(0, 12), "x.png")).toThrow(/dimensions/);
  });
  it("rejects truncated JPEG segments and a scan without a frame", () => {
    expect(() => inspectBitmapSource(new Uint8Array([0xff,0xd8,0xff,0xe1,0xff,0xff]), "x.jpg")).toThrow(/incomplete/);
    expect(() => inspectBitmapSource(new Uint8Array([0xff,0xd8,0xff,0xda]), "x.jpg")).toThrow(/frame header/);
    expect(() => inspectBitmapSource(new Uint8Array([0xff,0xd8,0xff]), "x.jpg")).toThrow(/valid JPEG/);
  });
  it("rejects oversized dimensions and pixel products in both formats", () => {
    expect(() => inspectBitmapSource(png(8193, 1), "x.png")).toThrow(/too large/);
    expect(() => inspectBitmapSource(png(5000, 5000), "x.png")).toThrow(/too large/);
    expect(() => inspectBitmapSource(jpeg(8193, 1), "x.jpg")).toThrow(/too large/);
    expect(() => inspectBitmapSource(jpeg(5000, 5000), "x.jpg")).toThrow(/too large/);
  });
  it("rejects the encoded-source budget before attempting a decoder", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    await expect(normaliseBitmapAsset(new Uint8Array(BITMAP_LIMITS.sourceBytes + 1), "x.png")).rejects.toThrow(/20 MiB/);
    await expect(normaliseBitmapAsset(png(8193, 1), "x.png")).rejects.toThrow(/too large/);
    expect(decode).not.toHaveBeenCalled();
  });
  it("does not decode an already cancelled import", async () => {
    const decode = vi.fn(); vi.stubGlobal("createImageBitmap", decode);
    const controller = new AbortController(); controller.abort();
    await expect(normaliseBitmapAsset(png(), "x.png", controller.signal)).rejects.toThrow(/cancelled/);
    expect(decode).not.toHaveBeenCalled();
  });
});

describe("initial bitmap placement", () => {
  const frame = { pageW: 220, pageH: 220, bedW: 220, bedH: 220, marginMM: 0, origin: "bottom-left" };
  it("uses 96 PPI without enlarging small images", () => {
    expect(bitmapInitialPlacement(96, 48, frame)).toEqual({ scale: 25.4 / 96, x: 0, y: 0 });
  });
  it("fits large images uniformly within active page margins and bed", () => {
    const value = bitmapInitialPlacement(2000, 1000, { ...frame, pageW: 100, pageH: 80, marginMM: 10 });
    expect(value).toEqual({ scale: 0.04, x: 10, y: 10 });
    expect(2000 * value.scale).toBe(80);
    expect(1000 * value.scale).toBe(40);
  });
  it("retains the existing right/top-origin placement convention", () => {
    const value = bitmapInitialPlacement(96, 48, { ...frame, origin: "top-right", marginMM: 10 });
    expect(value.x).toBeCloseTo(220 - 10 - 25.4);
    expect(value.y).toBeCloseTo(-10 - 12.7);
  });
  it("rejects margins that leave no import area", () => {
    expect(() => bitmapInitialPlacement(20, 20, { ...frame, marginMM: 110 })).toThrow(/no room/);
  });
});
