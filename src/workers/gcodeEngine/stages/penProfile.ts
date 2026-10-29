import type { MachineConfig, VectorObject } from "../../../types";
import type { PenProfile } from "../../../types/pens";
import { parsePenProfile } from "../../../types/pens";
import { transformPt, type Pt } from "./geometryFlattening";
import { resolvePageClipRect } from "./clipping";
import { validateCenterlineCommands } from "../../../types/centerlineGeometry";
import { flattenCenterlineCurves } from "./centerlineCurves";

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
  const samples = points.map((point, index) => {
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
  if (!obj.centerline?.commands) return samples;
  const commands = validateCenterlineCommands(obj.centerline.commands);
  const curve = flattenCenterlineCurves(commands, obj, config);
  if (curve.length < 2) throw new Error("Invalid continuous centreline curve.");
  const cumulative = (path: Pt[]) => {
    const lengths = [0];
    for (let i = 1; i < path.length; i++) lengths.push(lengths[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    return lengths;
  };
  const sampleLengths = cumulative(samples), curveLengths = cumulative(curve);
  const total = curveLengths.at(-1)!, sampledTotal = sampleLengths.at(-1)!;
  if (total <= 1e-9 || sampledTotal <= 1e-9) throw new Error("Invalid centreline curve length.");
  // Retain pressure landmarks even on a geometrically straight Bézier: reducing
  // that line to two XY points must not discard a wider/thinner middle sample.
  const targets = obj.useStrokeWidths === false ? curveLengths
    : [...curveLengths, ...sampleLengths.map(length => length / sampledTotal * total)].sort((a, b) => a - b);
  let cursor = 1, geometryCursor = 1, previousTarget = -Infinity;
  const output: Pt[] = [];
  for (const distance of targets) {
    if (distance - previousTarget < 1e-9) continue;
    previousTarget = distance;
    while (geometryCursor < curve.length - 1 && curveLengths[geometryCursor] < distance) geometryCursor++;
    const geometrySpan = curveLengths[geometryCursor] - curveLengths[geometryCursor - 1];
    const geometryRatio = geometrySpan > 1e-12 ? (distance - curveLengths[geometryCursor - 1]) / geometrySpan : 0;
    const a = curve[geometryCursor - 1], b = curve[geometryCursor];
    const point = { x: a.x + (b.x - a.x) * geometryRatio, y: a.y + (b.y - a.y) * geometryRatio };
    const target = distance / total * sampledTotal;
    while (cursor < samples.length - 1 && sampleLengths[cursor] < target) cursor++;
    const span = sampleLengths[cursor] - sampleLengths[cursor - 1];
    const ratio = span > 1e-12 ? Math.max(0, Math.min(1, (target - sampleLengths[cursor - 1]) / span)) : 0;
    output.push({ ...point, width: samples[cursor - 1].width + (samples[cursor].width - samples[cursor - 1].width) * ratio });
  }
  return output;
}
