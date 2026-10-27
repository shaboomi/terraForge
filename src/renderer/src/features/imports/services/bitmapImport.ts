import type { BitmapAsset } from "../../../../../types";
import { BITMAP_LIMITS } from "../../../../../types/bitmapValidation";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
export interface BitmapSourceInfo {
  mimeType: "image/png" | "image/jpeg";
  widthPx: number;
  heightPx: number;
}

function checkDimensions(widthPx: number, heightPx: number): void {
  if (!Number.isInteger(widthPx) || !Number.isInteger(heightPx) || widthPx < 1 || heightPx < 1) {
    throw new Error("The image does not contain valid pixel dimensions.");
  }
  if (widthPx > BITMAP_LIMITS.dimensionPx || heightPx > BITMAP_LIMITS.dimensionPx ||
      widthPx * heightPx > BITMAP_LIMITS.decodedPixels) {
    throw new Error("The image is too large: use at most 8192 pixels per side and 16 megapixels in total.");
  }
}

function inspectPng(data: Uint8Array): BitmapSourceInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 33 || !PNG_SIGNATURE.every((byte, index) => data[index] === byte) ||
      view.getUint32(8) !== 13 || String.fromCharCode(...data.subarray(12, 16)) !== "IHDR") {
    throw new Error("The selected file is not a valid PNG image.");
  }
  const widthPx = view.getUint32(16);
  const heightPx = view.getUint32(20);
  checkDimensions(widthPx, heightPx);
  return { mimeType: "image/png", widthPx, heightPx };
}

function inspectJpeg(data: Uint8Array): BitmapSourceInfo {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) throw new Error("The selected file is not a valid JPEG image.");
  let offset = 2;
  while (offset < data.length) {
    if (data[offset++] !== 0xff) throw new Error("The JPEG image contains an invalid header.");
    while (offset < data.length && data[offset] === 0xff) offset++;
    if (offset >= data.length) break;
    const marker = data[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0x00 || marker === 0xd8 || offset + 2 > data.length) throw new Error("The JPEG image contains an invalid header.");
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > data.length) throw new Error("The JPEG image header is incomplete.");
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (length < 8) throw new Error("The JPEG image has an invalid frame header.");
      const heightPx = view.getUint16(offset + 3);
      const widthPx = view.getUint16(offset + 5);
      checkDimensions(widthPx, heightPx);
      return { mimeType: "image/jpeg", widthPx, heightPx };
    }
    offset += length;
  }
  throw new Error("The JPEG image does not contain a supported frame header.");
}

/** Inspect encoded headers before asking a browser decoder to allocate pixels. */
export function inspectBitmapSource(data: Uint8Array, filename: string): BitmapSourceInfo {
  if (data.byteLength > BITMAP_LIMITS.sourceBytes) throw new Error("The image file exceeds the 20 MiB import limit.");
  const extension = filename.split(".").pop()?.toLowerCase();
  if (extension === "png") return inspectPng(data);
  if (extension === "jpg" || extension === "jpeg") return inspectJpeg(data);
  throw new Error("Unsupported bitmap format. Choose a PNG, JPG or JPEG image.");
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Bitmap import cancelled.", "AbortError");
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob); else reject(new Error("The image could not be encoded for saving."));
  }, "image/png"));
}

function base64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  }
  return btoa(parts.join(""));
}

/** Decode EXIF orientation once, then store portable lossless PNG pixels. */
export async function normaliseBitmapAsset(
  source: Uint8Array,
  filename: string,
  signal?: AbortSignal,
  progress: (value: number) => void = () => {},
): Promise<BitmapAsset> {
  const info = inspectBitmapSource(source, filename);
  checkCancelled(signal);
  progress(20);
  const owned = new Uint8Array(source.length);
  owned.set(source);
  const bitmap = await createImageBitmap(new Blob([owned.buffer], { type: info.mimeType }), {
    imageOrientation: "from-image", premultiplyAlpha: "none", colorSpaceConversion: "default",
  });
  const canvas = document.createElement("canvas");
  try {
    checkCancelled(signal);
    checkDimensions(bitmap.width, bitmap.height);
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("Image decoding is unavailable on this system.");
    context.drawImage(bitmap, 0, 0);
    progress(60);
    const blob = await encodePng(canvas);
    checkCancelled(signal);
    if (blob.size > BITMAP_LIMITS.encodedAssetBytes) throw new Error("The normalised PNG exceeds the 32 MiB asset limit. Use a smaller image.");
    const encoded = await blob.arrayBuffer();
    checkCancelled(signal);
    progress(85);
    const hash = await crypto.subtle.digest("SHA-256", encoded);
    checkCancelled(signal);
    const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { id, mimeType: "image/png", data: base64(new Uint8Array(encoded)), widthPx: bitmap.width, heightPx: bitmap.height };
  } catch (error) {
    if (signal?.aborted) throw new DOMException("Bitmap import cancelled.", "AbortError");
    throw error;
  } finally {
    bitmap.close();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function bitmapInitialPlacement(widthPx: number, heightPx: number, options: {
  pageW: number; pageH: number; bedW: number; bedH: number; marginMM: number; origin: string;
}) {
  const margin = Math.max(0, options.marginMM);
  const availableW = Math.min(options.pageW, options.bedW) - margin * 2;
  const availableH = Math.min(options.pageH, options.bedH) - margin * 2;
  if (availableW <= 0 || availableH <= 0) throw new Error("The page margins leave no room for this image. Reduce them before importing.");
  const scale = Math.min(25.4 / 96, availableW / widthPx, availableH / heightPx);
  const right = options.origin === "bottom-right" || options.origin === "top-right";
  const top = options.origin === "top-left" || options.origin === "top-right";
  return { scale, x: right ? options.bedW - margin - widthPx * scale : margin,
    y: top ? -margin - heightPx * scale : margin };
}
