import type { MachineConfig } from "../../../../types";
import type { CalibrationOptions, Stroke } from "./calibration";

export const formatCalibrationNumber = (v: number) => Number(v.toFixed(4)).toString();
const n = formatCalibrationNumber;

export interface StrokeSettings {
  z?: number;
  clearance?: number;
  arrivalZ?: number;
  upDelay?: number;
  downDelay?: number;
  label?: string;
}
export type DrawCalibrationStroke = (points: number[][], row: number, feed: number, settings?: StrokeSettings) => void;

export function createCalibrationWriter(config: MachineConfig, o: CalibrationOptions, width: number, height: number) {
  const useZ = o.kind === "brush" || o.kind === "lift";
  const strokes: Stroke[] = [];
  const safePen = o.pen.replace(/[\r\n();]/g, " ");
  const lines = [`; TerraForge ${o.kind} calibration`, `; Pen: ${safePen}`, "; Preserve drawing order and scale. Speeds are mm/min.", "G21", "G90", "G17", "G94"];
  // Track lift state so a gap has exactly one up delay, including timing sweeps.
  let raised: number | boolean = false;
  const dwell = (ms: number) => { if (ms > 0) lines.push(`G4 P${n(ms / 1000)}`); };
  const up = (z = o.liftZ, delay = config.penUpDelayMs) => {
    const target = useZ ? z : true;
    if (raised === target) return;
    lines.push(useZ ? `G1 Z${n(z)} F${n(o.zFeed)}` : config.penUpCommand);
    dwell(delay);
    raised = target;
  };
  const xy = (p: number[]) => {
    // Canonical paths read left-to-right with Y up. Reflect the entire sheet for
    // machines whose corner origin makes an axis run inward in the other direction.
    let [x, y] = p;
    if (config.origin === "bottom-right" || config.origin === "top-right") x = width - x;
    if (config.origin === "top-left" || config.origin === "top-right") y = height - y;
    if (config.origin === "center") { x -= config.bedWidth / 2; y -= config.bedHeight / 2; }
    return `X${n(x)} Y${n(y)}`;
  };
  const draw: DrawCalibrationStroke = (points, row, feed, settings = {}) => {
    const {z = o.contactZ, clearance = o.liftZ, arrivalZ = clearance,
      upDelay = config.penUpDelayMs, downDelay = config.penDownDelayMs} = settings;
    up(arrivalZ);
    lines.push(`G0 ${xy(points[0])}`);
    lines.push(useZ ? `G1 Z${n(z)} F${n(o.zFeed)}` : config.penDownCommand);
    raised = false;
    dwell(downDelay);
    for (const p of points.slice(1)) lines.push(`G1 ${xy(p)}${p.length > 2 ? ` Z${n(p[2])}` : ""} F${n(feed)}`);
    strokes.push({points, row, ...(settings.label ? { label: settings.label } : {})});
    up(clearance, upDelay);
  };
  up();
  return {draw, strokes, comment: (text: string) => lines.push(`; ${text}`), finish: () => {
    up();
    lines.push("M2");
    return lines.join("\n") + "\n";
  }};
}
