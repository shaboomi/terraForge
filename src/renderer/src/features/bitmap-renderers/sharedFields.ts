import type {
  BitmapRendererBooleanFieldSchema,
  BitmapRendererFieldSchema,
  BitmapRendererNumberFieldSchema,
} from "../../../../types";

/** Rotates a renderer's pattern — a spine's start angle, a halftone screen
 * angle — around its origin. Generic across every renderer family. */
export function angleField(): BitmapRendererNumberFieldSchema {
  return { type: "number", key: "angleDeg", label: "Angle (°)", min: 0, max: 360, step: 1 };
}

/** Where a renderer's pattern is centred/anchored, as a percentage of the
 * image bounds (50/50 is the image centre). Returned as a pair so callers
 * can spread it directly into a `fields` array. */
export function originFields(): BitmapRendererFieldSchema[] {
  return [
    { type: "number", key: "originXPct", label: "Origin X (%)", min: 0, max: 100, step: 1 },
    { type: "number", key: "originYPct", label: "Origin Y (%)", min: 0, max: 100, step: 1 },
  ];
}

/** Whether a renderer's output stays within the image rectangle (clamping
 * a wobbled point back in, breaking the path around a point that's fully
 * outside) or is left free to overflow by up to the amplitude setting. Both
 * have a real visual cost — clamping can flatten a sharp waveform peak
 * (most visible on sawtooth) into a flat edge wherever the render's outer
 * reach meets the image boundary, which every circular/spiral renderer does
 * by design; leaving it unclipped lets the pattern bleed past the image on
 * a non-square source. Exposed as a setting rather than picked once. */
export function clipToImageField(): BitmapRendererBooleanFieldSchema {
  return { type: "boolean", key: "clipToImage", label: "Clip to image" };
}

/** A different feature from `clipToImageField` despite the similar name:
 * this shapes the waveform itself, independent of the image boundary, the
 * way audio clipping/distortion does. 100% (the default) is today's exact
 * shape; below that, each peak reaches full height sooner and holds flat
 * there instead of coming to a point — e.g. a sawtooth's tip reads as
 * chopped rather than sharp. */
export function peakClipField(): BitmapRendererNumberFieldSchema {
  return { type: "number", key: "peakClipPct", label: "Peak clip (%)", min: 1, max: 100, step: 1 };
}

export const DEFAULT_ANGLE_DEG = 0;
export const DEFAULT_ORIGIN_PCT = 50;
export const DEFAULT_CLIP_TO_IMAGE = true;
export const DEFAULT_PEAK_CLIP_PCT = 100;
