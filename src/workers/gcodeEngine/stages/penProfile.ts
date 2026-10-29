import type { MachineConfig, VectorObject } from "../../../types";
import type { PenProfile } from "../../../types/pens";
import { parsePenProfile } from "../../../types/pens";
import { transformPt, type Pt } from "./geometryFlattening";
import { resolvePageClipRect } from "./clipping";

/** Approach along the entry tangent, so contact happens during a continuous XYZ move. */
export function brushLeadInStart(points: Pt[], config: MachineConfig, distanceMM = 1,
  pageClip?: { widthMM: number; heightMM: number; marginMM: number }): Pt {
  if (!Number.isFinite(distanceMM) || distanceMM < 0.1 || distanceMM > 20) throw new Error("Brush lead-in must be between 0.1 and 20 mm.");
  const first = points[0];
  const next = points.find(point => Math.hypot(point.x - first.x, point.y - first.y) > 1e-8);
  if (!next) throw new Error("Brush stroke needs a direction for its moving lead-in.");
  const length = Math.hypot(next.x - first.x, next.y - first.y);
  const start = { x: first.x - (next.x - first.x) / length * distanceMM, y: first.y - (next.y - first.y) / length * distanceMM };
  const bed = {
    xMin: config.origin === "center" ? -config.bedWidth / 2 : 0,
    xMax: config.origin === "center" ? config.bedWidth / 2 : config.bedWidth,
    yMin: config.origin === "center" ? -config.bedHeight / 2 : 0,
    yMax: config.origin === "center" ? config.bedHeight / 2 : config.bedHeight,
  };
  const page = pageClip ? resolvePageClipRect(config, pageClip) : bed;
  const bounds = { xMin: Math.max(bed.xMin, page.xMin), xMax: Math.min(bed.xMax, page.xMax),
    yMin: Math.max(bed.yMin, page.yMin), yMax: Math.min(bed.yMax, page.yMax) };
  if ([first, start].some(point => point.x < bounds.xMin || point.x > bounds.xMax || point.y < bounds.yMin || point.y > bounds.yMax)) {
    throw new Error("Brush lead-in falls outside the printable area. Move the artwork inward or reduce the brush lead-in distance.");
  }
  return start;
}

/** Validate at export too: layouts and bridge callers need the same guarantees as the editor. */
export function validatePlotPen(profile: PenProfile | undefined, config: MachineConfig, useStrokeWidths = true): void {
  if (!profile) return;
  parsePenProfile(profile);
  if (!useStrokeWidths) return;
  if (profile.type === "brush" && config.penType !== "stepper") {
    throw new Error("Brush height control requires a stepper Z machine. Select a stepper machine or a fixed-width pen.");
  }
  if (profile.type === "brush") {
    // A profile is measured in work Z. Relative lifts or G53 machine Z cannot
    // be compared with that calibration, and may leave the brush in contact.
    const command = config.penUpCommand.replace(/\([^)]*\)|;[^\n]*/g, "").replace(/\s+/g, "");
    const lift = /^(?:G90)?G0?([01])Z([-+]?(?:\d+\.?\d*|\.\d+))(?:F\d+(?:\.\d+)?)?$/i.exec(command);
    if (!lift || Number(lift[2]) <= Math.max(profile.brush!.minZ, profile.brush!.maxZ)) {
      throw new Error("Brush plotting needs an absolute work-Z pen-up command (for example G0 Z5) above both calibrated contact heights. Positive Z must lift the brush.");
    }
  }
}

export function penFeedrate(requested: number, profile?: PenProfile): number {
  if (!Number.isFinite(requested) || requested <= 0) throw new Error("Drawing speed must be a positive finite number.");
  return Math.min(requested, profile?.maxDrawSpeedMMMin ?? requested);
}

export function brushZ(profile: PenProfile | undefined, width?: number, useStrokeWidths = true): number | undefined {
  if (!useStrokeWidths || profile?.type !== "brush") return undefined;
  const calibration = profile.brush;
  if (!calibration) throw new Error("Calibrate the brush width and Z heights in Pens before exporting.");
  const ratio = Math.max(0, Math.min(1, ((width ?? profile.tipWidthMM) - calibration.minWidthMM) / (calibration.maxWidthMM - calibration.minWidthMM)));
  return calibration.minZ + ratio * (calibration.maxZ - calibration.minZ);
}

/** Normal-direction scale handles non-uniform resizing without changing widths on rotation. */
export function transformCenterline(obj: VectorObject, config: MachineConfig): Pt[] {
  const points = obj.centerline?.points ?? [];
  if (points.length < 2 || points.length > 500000) throw new Error("Invalid centreline sample count.");
  const sx = obj.scaleX ?? obj.scale, sy = obj.scaleY ?? obj.scale;
  const closed = points.length > 3 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-8;
  return points.map((point, index) => {
    if (![point.x, point.y, point.width].every(Number.isFinite) || point.width <= 0) throw new Error("Invalid centreline width or coordinate.");
    const before = points[closed && (index === 0 || index === points.length - 1) ? points.length - 2 : Math.max(0, index - 1)];
    const after = points[closed && (index === 0 || index === points.length - 1) ? 1 : Math.min(points.length - 1, index + 1)];
    const dx = after.x - before.x, dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    const tangentScale = length > 1e-9 ? Math.hypot(dx * sx, dy * sy) / length : Math.max(Math.abs(sx), Math.abs(sy));
    const width = point.width * Math.abs(sx * sy) / tangentScale;
    const transformed = transformPt(obj, config, point.x, point.y);
    if (![transformed.x, transformed.y, width].every(Number.isFinite) || width <= 0) throw new Error("Invalid centreline transform.");
    return { ...transformed, width };
  });
}
