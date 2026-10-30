import type { MachineConfig } from "../../../../types";

export type CalibrationKind = "speed" | "brush" | "lift";
export interface CalibrationOptions {
  kind: CalibrationKind;
  pen: string;
  start: number;
  end: number;
  rows: number;
  speed: number; // mm/s, for depth and lift tests
  length: number;
  liftZ: number;
  contactZ: number;
  zFeed: number; // mm/min
}
export interface Stroke { points: number[][]; row: number }
export interface CalibrationSheet {
  gcode: string;
  strokes: Stroke[];
  values: number[];
  width: number;
  height: number;
  record: string;
}
const n = (v: number) => Number(v.toFixed(4)).toString();

// Seven-segment row numbers can be plotted without fonts or filled outlines.
const segments = [ [[0,0],[2,0]], [[2,0],[2,2]], [[2,2],[2,4]],
  [[0,4],[2,4]], [[0,2],[0,4]], [[0,0],[0,2]], [[0,2],[2,2]] ];
const digits = ["012345", "12", "01643", "01236", "5612", "05623", "054236", "012", "0123456", "012356"];

export function generateCalibration(config: MachineConfig, o: CalibrationOptions): CalibrationSheet {
  const rangedZ = o.kind !== "speed";
  const fields = [o.start, o.end, o.rows, o.speed, o.length];
  if (rangedZ) fields.push(o.liftZ, o.contactZ, o.zFeed);
  if (!fields.every(Number.isFinite)) throw new Error("Enter a number in every test field.");
  if (!Number.isInteger(o.rows) || o.rows < 2 || o.rows > 10) throw new Error("Choose 2–10 rows.");
  if (o.start >= o.end) throw new Error("The end value must be greater than the start value.");
  if (o.speed <= 0 || o.length < 80 || o.length > 250 || (o.kind === "speed" && o.start <= 0))
    throw new Error("Use positive speeds and a line length of 80–250 mm.");
  if (rangedZ && config.penType !== "stepper") throw new Error("Depth and clearance tests require a stepper Z pen lift.");
  if (rangedZ && (o.zFeed <= 0 || o.liftZ <= Math.max(o.end, o.contactZ)))
    throw new Error("Safe lift Z must be above all test Z values and contact Z. Use a positive Z speed.");
  if (o.kind === "lift" && o.start <= o.contactZ) throw new Error("Every clearance Z must be above contact Z.");
  const width = o.length + 70, height = o.rows * 24 + 20;
  if (![config.bedWidth, config.bedHeight].every(v => Number.isFinite(v) && v > 0) || width > config.bedWidth || height > config.bedHeight)
    throw new Error(`This sheet needs ${width} × ${height} mm. Reduce rows or line length to fit the machine bed.`);
  if (!config.penUpCommand.trim() || !config.penDownCommand.trim()) throw new Error("Configure pen up and down commands first.");
  const values = Array.from({length: o.rows}, (_, i) => o.start + (o.end - o.start) * i / (o.rows - 1));
  const strokes: Stroke[] = [];
  const safePen = o.pen.replace(/[\r\n();]/g, " ");
  const lines = [`; TerraForge ${o.kind} calibration`, `; Pen: ${safePen}`, "; Rows are numbered; preserve this order and scale.", "G21", "G90", "G17", "G94"];
  const dwell = (ms: number) => { if (ms > 0) lines.push(`G4 P${n(ms / 1000)}`); };
  const up = (z = o.liftZ) => { lines.push(rangedZ ? `G1 Z${n(z)} F${n(o.zFeed)}` : config.penUpCommand); dwell(config.penUpDelayMs); };
  const xy = (p: number[]) => {
    const x = config.origin === "center" ? p[0] - config.bedWidth / 2 : p[0];
    const y = config.origin === "center" ? p[1] - config.bedHeight / 2 : p[1];
    return `X${n(x)} Y${n(y)}`;
  };
  const draw = (points: number[][], row: number, feed: number, z = o.contactZ, clearance = o.liftZ, arrivalZ = clearance) => {
    up(arrivalZ);
    lines.push(`G0 ${xy(points[0])}`);
    lines.push(rangedZ ? `G1 Z${n(z)} F${n(o.zFeed)}` : config.penDownCommand);
    dwell(config.penDownDelayMs);
    for (const p of points.slice(1)) lines.push(`G1 ${xy(p)}${p.length > 2 ? ` Z${n(p[2])}` : ""} F${n(feed)}`);
    strokes.push({points, row});
    up(clearance);
  };
  up();
  values.forEach((value, i) => {
    const y = 12 + i * 24, row = i + 1;
    lines.push(`; Row ${row}: ${n(value)} ${o.kind === "speed" ? "mm/s" : "mm Z"}`);
    const labelZ = o.kind === "brush" ? o.end : o.contactZ;
    String(row).split("").forEach((digit, j) => {
      for (const s of digits[Number(digit)]) draw(segments[Number(s)].map(p => [7 + j * 4 + p[0], y + p[1]]), row, Math.min(o.speed, o.kind === "speed" ? o.start : o.speed) * 60, labelZ);
    });
    const x = 22, feed = (o.kind === "speed" ? value : o.speed) * 60;
    if (o.kind === "speed") {
      draw([[x,y],[x+o.length,y]], row, feed);
      draw([[x+o.length,y+5],[x,y+5]], row, feed);
      draw([[x,y+10],[x+8,y+17],[x+16,y+10],[x+24,y+17],[x+32,y+10]], row, feed);
      draw(Array.from({length: 65}, (_, k) => [x+o.length+18+8*Math.cos(k*Math.PI/32), y+8+8*Math.sin(k*Math.PI/32)]), row, feed);
    } else if (o.kind === "brush") {
      draw([[x,y],[x+o.length,y]], row, feed, value);
      draw([[x+o.length,y+6],[x,y+6]], row, feed, value);
      // Matched thin–thick–thin ramp in each row, with its deepest point at this row's Z.
      draw([[x,y+13],[x+o.length/2,y+13,value],[x+o.length,y+13,o.end]], row, feed, o.end);
    } else {
      // Candidate lift occurs only in the gaps; numbering always uses the safe clearance.
      for (let k = 0; k < 6; k++) {
        const sx = x + k * o.length / 6;
        draw([[sx,y],[sx+o.length/12,y]], row, feed, o.contactZ, value, k === 0 ? o.liftZ : value);
      }
      up();
    }
  });
  up();
  lines.push("M2");
  const record = [`TerraForge ${o.kind} calibration`, `Pen: ${o.pen}`, `Machine: ${config.name}`, `Sheet: ${width} x ${height} mm`,
    `Reference / fixed speed: ${o.speed} mm/s`,
    ...(rangedZ ? [`Z speed: ${o.zFeed} mm/min; safe lift: ${o.liftZ} mm; contact: ${o.contactZ} mm`] : []),
    `Pen up: ${rangedZ ? o.liftZ : config.penUpCommand}; pen down: ${rangedZ ? o.contactZ : config.penDownCommand}`,
    `Up/down delay: ${config.penUpDelayMs}/${config.penDownDelayMs} ms`,
    "Paper / pen mounting / date: ____________________", ...values.map((v,i) => `Row ${i+1}: ${n(v)} ${o.kind === "speed" ? `mm/s (${n(v*60)} mm/min)` : "mm Z"} | width: ____ | pass/fail: ____ | notes: ____`),
    "Selected setting: ____", "Repeat with the same paper, mounting and ink condition. Retest after remounting.",
  ].join("\n");
  return {gcode: lines.join("\n") + "\n", strokes, values, width, height, record};
}
