import type { BitmapRendererSettings } from "../../../../types";
import type { SpineStrand } from "./toneSpine/engine";
import { amplitudeField, defineToneSpineRenderer, toothWidthField } from "./toneSpine/defineToneSpineRenderer";
import { clipLineToRect } from "./toneSpine/lineFamily";
import type { RendererContext } from "./types";

export const RADIAL_BURST_RENDERER_ID = "radial-burst";

/**
 * One ray's base points, straight from the origin out to the image edge in
 * direction `dir`, with the tangential (perpendicular-to-ray) direction as
 * its normal — the same "amplitude displaces perpendicular to the spine"
 * convention every other tone-spine renderer uses, applied to a ray instead
 * of a ring or line family. A ray radiating outward with no perpendicular
 * wave would just be a straight spoke; this is what lets tone still modulate
 * it visibly.
 */
function rayStrand(
  originX: number,
  originY: number,
  dir: { x: number; y: number },
  normal: { x: number; y: number },
  length: number,
  targetSegmentLength: number,
): SpineStrand {
  const steps = Math.max(1, Math.ceil(length / Math.max(targetSegmentLength, 0.01)));
  const points: SpineStrand = [];
  for (let i = 0; i <= steps; i++) {
    const t = (length * i) / steps;
    points.push({ x: originX + t * dir.x, y: originY + t * dir.y, nx: normal.x, ny: normal.y });
  }
  return points;
}

/**
 * Straight rays fanning out from the origin at `rayCount` evenly spaced
 * angles, each clipped to the image bounds and tone-modulated tangentially —
 * `angleDeg` rotates where the first ray points.
 */
export const radialBurstRenderer = defineToneSpineRenderer({
  id: RADIAL_BURST_RENDERER_ID,
  label: "Radial burst",
  revision: 1,
  fields: [
    { type: "number", key: "rayCount", label: "Ray count", min: 3, max: 180, step: 1 },
    toothWidthField(),
    amplitudeField(),
  ],
  defaults: { rayCount: 36, toothWidthMM: 4, amplitudeMM: 1.5 },
  *strands({ originX, originY, angleRad, targetSegmentLength, width, height }, settings) {
    const rayCount = Math.round(settings.rayCount as number);
    for (let i = 0; i < rayCount; i++) {
      const theta = angleRad + (i / rayCount) * Math.PI * 2;
      const dir = { x: Math.cos(theta), y: Math.sin(theta) };
      const normal = { x: -Math.sin(theta), y: Math.cos(theta) };
      const tRange = clipLineToRect({ x: originX, y: originY }, dir, width, height);
      if (!tRange) continue;
      // Only the outward half from the origin — the family already covers the
      // opposite direction as a separate ray at theta + π.
      const length = Math.max(0, tRange[1]);
      if (length <= 0) continue;
      yield rayStrand(originX, originY, dir, normal, length, targetSegmentLength);
    }
  },
});

export const radialBurstDefaults: BitmapRendererSettings = radialBurstRenderer.defaults;

export function generateRadialBurstPath(context: RendererContext): string {
  return radialBurstRenderer.render(context);
}
