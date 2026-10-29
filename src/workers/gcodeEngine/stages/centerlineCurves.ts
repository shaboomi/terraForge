import type { MachineConfig, VectorObject } from "../../../types";
import type { FontOutlineCommand } from "../../../types/fonts";
import { transformPt, type Pt } from "./geometryFlattening";

/** Flatten only for machine motion, in physical mm rather than font/pixel units. */
export function flattenCenterlineCurves(commands: FontOutlineCommand[], obj: VectorObject, config: MachineConfig): Pt[] {
  const output: Pt[] = [];
  let current: Pt = { x: 0, y: 0 }, start = current;
  const append = (point: Pt) => {
    if (output.length > 500_000) throw new Error("Centreline curve exceeds the plotting detail limit.");
    if (!output.length || Math.hypot(point.x - current.x, point.y - current.y) > 1e-10) output.push(point);
    current = point;
  };
  const middle = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const deviation = (point: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
    const t = squared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared)) : 0;
    return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
  };
  const cubic = (a: Pt, b: Pt, c: Pt, d: Pt, depth = 0) => {
    if (depth >= 18 || Math.max(deviation(b, a, d), deviation(c, a, d)) <= 0.01) { append(d); return; }
    const ab = middle(a, b), bc = middle(b, c), cd = middle(c, d), abc = middle(ab, bc), bcd = middle(bc, cd), midpoint = middle(abc, bcd);
    cubic(a, ab, abc, midpoint, depth + 1); cubic(midpoint, bcd, cd, d, depth + 1);
  };
  for (const command of commands) {
    if (command.type === "Z") { append(start); continue; }
    const end = transformPt(obj, config, command.x, command.y);
    if (command.type === "M") { append(end); start = end; }
    else if (command.type === "L") append(end);
    else if (command.type === "C") cubic(current, transformPt(obj, config, command.x1, command.y1), transformPt(obj, config, command.x2, command.y2), end);
    else if (command.type === "Q") {
      const control = transformPt(obj, config, command.x1, command.y1);
      cubic(current, { x: current.x + (control.x - current.x) * 2 / 3, y: current.y + (control.y - current.y) * 2 / 3 },
        { x: end.x + (control.x - end.x) * 2 / 3, y: end.y + (control.y - end.y) * 2 / 3 }, end);
    }
  }
  return output;
}
