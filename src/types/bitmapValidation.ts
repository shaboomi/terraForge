import type { BitmapAsset, BitmapAssetTable } from "./index";

export const BITMAP_LIMITS = Object.freeze({
  sourceBytes: 20 * 1024 * 1024,
  decodedPixels: 16 * 1024 * 1024,
  totalDecodedPixels: 32 * 1024 * 1024,
  dimensionPx: 8192,
  encodedAssetBytes: 32 * 1024 * 1024,
  totalAssetBytes: 64 * 1024 * 1024,
  layoutBytes: 96 * 1024 * 1024,
});

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) crc = CRC_TABLE[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function bitmapEncodedBytes(data: string): number {
  return data.length / 4 * 3 - (data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0);
}

function validatePng(bytes: Uint8Array, width: number, height: number): void {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 57 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error("Bitmap asset is not a complete PNG image.");
  const view = new DataView(bytes.buffer);
  if (view.getUint32(8) !== 13 || String.fromCharCode(...bytes.subarray(12, 16)) !== "IHDR" || view.getUint32(16) !== width || view.getUint32(20) !== height) throw new Error("PNG header dimensions do not match the bitmap asset.");
  let offset = 8;
  let idat = false;
  let ended = false;
  let chunks = 0;
  while (offset + 12 <= bytes.length) {
    if (++chunks > 100000) throw new Error("PNG contains too many chunks.");
    const length = view.getUint32(offset);
    const next = offset + 12 + length;
    if (next > bytes.length) throw new Error("PNG chunk is truncated.");
    if (view.getUint32(next - 4) !== crc32(bytes, offset + 4, next - 4)) throw new Error("PNG chunk checksum is invalid.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === "IHDR" && offset !== 8) throw new Error("PNG has duplicate image headers.");
    if (type === "IDAT") idat = true;
    if (type === "IEND") {
      if (length !== 0 || next !== bytes.length) throw new Error("PNG end chunk is invalid.");
      ended = true;
      break;
    }
    offset = next;
  }
  if (!idat || !ended) throw new Error("PNG image data or end chunk is missing.");
}

export function validateBitmapAsset(value: unknown): BitmapAsset {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Bitmap asset must be an object.");
  const asset = value as Record<string, unknown>;
  if (Object.keys(asset).some((key) => !["id", "mimeType", "data", "widthPx", "heightPx"].includes(key))) throw new Error("Bitmap asset contains unsupported fields.");
  if (typeof asset.id !== "string" || !/^(?:sha256-)?[a-f0-9]{64}$/i.test(asset.id)) throw new Error("Bitmap asset ID must be a SHA-256 identifier.");
  if (asset.mimeType !== "image/png") throw new Error("Embedded bitmap assets must be normalized PNG images.");
  const width = asset.widthPx;
  const height = asset.heightPx;
  if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > BITMAP_LIMITS.dimensionPx || height > BITMAP_LIMITS.dimensionPx || width * height > BITMAP_LIMITS.decodedPixels) throw new Error("Bitmap exceeds the image dimension or decoded-pixel limit.");
  if (typeof asset.data !== "string" || asset.data.length > Math.ceil(BITMAP_LIMITS.encodedAssetBytes / 3) * 4 || asset.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.data) || bitmapEncodedBytes(asset.data) > BITMAP_LIMITS.encodedAssetBytes) throw new Error("Bitmap asset contains invalid or oversized base64 data.");
  const binary = atob(asset.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  validatePng(bytes, width, height);
  return Object.freeze({ id: asset.id, mimeType: "image/png", data: asset.data, widthPx: width, heightPx: height });
}

export function assertBitmapAssetBudget(assets: BitmapAssetTable): void {
  let encoded = 0;
  let pixels = 0;
  for (const asset of Object.values(assets)) {
    encoded += bitmapEncodedBytes(asset.data);
    pixels += asset.widthPx * asset.heightPx;
  }
  if (encoded > BITMAP_LIMITS.totalAssetBytes) throw new Error("Bitmap assets exceed the 64 MiB budget, including undo history and clipboard. Use smaller images.");
  if (pixels > BITMAP_LIMITS.totalDecodedPixels) throw new Error("Bitmap assets exceed the 32 megapixel document/history budget. Use smaller images.");
}