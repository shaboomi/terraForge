import type { MachineConfig } from "../../../../types";
import { createCalibrationWriter, formatCalibrationNumber } from "./calibrationGcode";
import { circle, drawCalibrationRow, square } from "./calibrationPatterns";
import { createCalibrationLabel, wrapCalibrationText, type CalibrationFont, type CalibrationLabel } from "./calibrationText";

export type CalibrationKind = "speed" | "brush" | "lift" | "timing" | "geometry" | "repeatability" | "hatching";
export interface CalibrationOptions {
  kind: CalibrationKind;
  pen: string;
  start: number;
  end: number;
  rows: number;
  speed: number; // mm/min, also used for row numbers
  length: number;
  liftZ: number;
  contactZ: number;
  zFeed: number; // mm/min
  timingMode?: "up" | "down";
}
export interface Stroke { points: number[][]; row: number; label?: string }
export interface CalibrationSheet {
  gcode: string;
  strokes: Stroke[];
  values: number[];
  rowDescriptions: string[];
  width: number;
  height: number;
  record: string;
  labels: CalibrationLabel[];
  fontFamily: string;
}
const explicitZ = (o: CalibrationOptions) => o.kind === "brush" || o.kind === "lift";
const squareTest = (o: CalibrationOptions) => o.kind === "geometry" || o.kind === "repeatability";

function validateOptions(config: MachineConfig, o: CalibrationOptions) {
  const fields = [o.speed, o.length];
  if (o.kind !== "geometry") fields.push(o.rows);
  if (!squareTest(o)) fields.push(o.start, o.end);
  if (explicitZ(o)) fields.push(o.liftZ, o.contactZ, o.zFeed);
  if (!fields.every(Number.isFinite)) throw new Error("Enter a number in every test field.");
  if (o.kind !== "geometry" && (!Number.isInteger(o.rows) || o.rows < 2 || o.rows > 10))
    throw new Error("Choose 2–10 rows or passes.");
  if (!squareTest(o) && o.start >= o.end) throw new Error("The end value must be greater than the start value.");
  if (o.speed <= 0 || o.length < 80 || o.length > 250 || (o.kind === "speed" && o.start <= 0))
    throw new Error("Use positive speeds in mm/min and a line or square length of 80–250 mm.");
  if (explicitZ(o)) validateZ(config, o);
  validatePatternRange(o);
  if (!config.penUpCommand.trim() || !config.penDownCommand.trim()) throw new Error("Configure pen up and down commands first.");
  if (![config.penUpDelayMs, config.penDownDelayMs].every(v => Number.isFinite(v) && v >= 0))
    throw new Error("Configure non-negative pen delays first.");
}

function validatePatternRange(o: CalibrationOptions) {
  if (o.kind === "timing" && (o.start < 0 || o.end > 5000)) throw new Error("Use delays from 0 to 5000 ms.");
  if (o.kind === "timing" && o.timingMode !== undefined && !["up", "down"].includes(o.timingMode))
    throw new Error("Select the pen-up or pen-down delay to test.");
  if (o.kind === "hatching" && (o.start < 0.1 || o.end > 10)) throw new Error("Use line spacing from 0.1 to 10 mm.");
}

function validateZ(config: MachineConfig, o: CalibrationOptions) {
  if (config.penType !== "stepper") throw new Error("Depth and clearance tests require a stepper Z pen lift.");
  if (o.zFeed <= 0 || o.liftZ <= Math.max(o.end, o.contactZ))
    throw new Error("Safe lift Z must be above all test Z values and contact Z. Use a positive Z speed.");
  if (o.kind === "lift" && o.start <= o.contactZ) throw new Error("Every clearance Z must be above contact Z.");
}

function describeRows(o: CalibrationOptions, values: number[]): string[] {
  const n = formatCalibrationNumber;
  return values.map((v, i) => {
    switch (o.kind) {
      case "speed": return `Row ${i + 1}: ${n(v)} mm/min`;
      case "timing": return `Row ${i + 1}: pen-${o.timingMode ?? "down"} delay ${n(v)} ms`;
      case "hatching": return `Row ${i + 1}: ${n(v)} mm line spacing`;
      case "geometry": return `Square: ${n(v)} × ${n(v)} mm; diagonals: ${n(v * Math.SQRT2)} mm; circle diameters: ${n(v / 2)} and ${n(v)} mm`;
      case "repeatability": return `Pass ${i + 1}: retrace the same ${n(o.length)} mm square`;
      default: return `Row ${i + 1}: ${n(v)} mm Z`;
    }
  });
}

function makeRecord(config: MachineConfig, o: CalibrationOptions, width: number, height: number, descriptions: string[], family: string) {
  const z = explicitZ(o), n = formatCalibrationNumber;
  return [`TerraForge ${o.kind} calibration`, `Pen: ${o.pen}`, `Machine: ${config.name}`, `Sheet: ${width} x ${height} mm`,
    `Text font: ${family} (plotted outlines)`,
    `Drawing / reference speed: ${o.speed} mm/min`,
    ...(z ? [`Z speed: ${o.zFeed} mm/min; safe lift: ${o.liftZ} mm; contact: ${o.contactZ} mm`] : []),
    `Pen up: ${z ? o.liftZ : config.penUpCommand}; pen down: ${z ? o.contactZ : config.penDownCommand}`,
    `Machine up/down delay: ${config.penUpDelayMs}/${config.penDownDelayMs} ms`,
    ...(o.kind === "timing" ? [`Vary only pen-${o.timingMode ?? "down"} delay on test dashes; the opposite delay and label delays use the machine profile.`] : []),
    ...(o.kind === "hatching" ? [`Each row: parallel hatch, crosshatch, then a ${n(2 * o.length + 4)} mm continuous stroke.`] : []),
    ...(o.kind === "repeatability" ? ["All passes overlap, in the same direction, with a lift between passes. The square is numbered once."] : []),
    "Paper / pen mounting / date: ____________________",
    ...descriptions.map(description => `${description} | measurement: ____ | pass/fail: ____ | notes: ____`),
    "Selected setting: ____", "Repeat with the same paper, mounting and ink condition. Retest after remounting.",
  ].join("\n");
}

export function generateCalibration(config: MachineConfig, o: CalibrationOptions, font: CalibrationFont): CalibrationSheet {
  validateOptions(config, o);
  const pen = o.pen.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (Array.from(pen).length > 80) throw new Error("Use a pen name of up to 80 characters.");
  o = { ...o, pen };
  const width = o.length + 70;
  const title = pen ? wrapCalibrationText(font, `Pen: ${pen}`, 5, width - 14) : [];
  const height = (squareTest(o) ? o.length + 40 : o.rows * (o.kind === "hatching" ? 38 : 24) + 20) + Math.max(0, title.length - 1) * 7;
  if (![config.bedWidth, config.bedHeight].every(v => Number.isFinite(v) && v > 0) || width > config.bedWidth || height > config.bedHeight)
    throw new Error(`This sheet needs ${width} × ${height} mm. Reduce rows or line length to fit the machine bed.`);
  const values = o.kind === "geometry" ? [o.length] : Array.from({length: o.rows}, (_, i) =>
    o.kind === "repeatability" ? i + 1 : o.start + (o.end - o.start) * i / (o.rows - 1));
  const rowDescriptions = describeRows(o, values);
  const writer = createCalibrationWriter(config, o, width, height);
  const labels: CalibrationLabel[] = [];
  const drawLabel = (text: string, row: number, x: number, y: number, size: number, maxWidth: number) => {
    const label = createCalibrationLabel(font, text, row, x, y, size, maxWidth);
    labels.push(label);
    writer.comment(`Label: ${text}`);
    const feed = o.kind === "speed" ? Math.min(o.speed, o.start) : o.speed;
    for (const points of label.points) writer.draw(points, row, feed, { label: text, z: o.kind === "brush" ? o.end : o.contactZ });
  };
  writer.comment(`Text font: ${font.family} (plotted outlines)`);
  title.forEach((text, i) => drawLabel(text, 0, 7, height - 9 - i * 7, 5, width - 14));
  if (squareTest(o)) {
    drawLabel("1", 1, 7, 12, 5, 11);
    values.forEach((_, i) => {
      writer.comment(rowDescriptions[i]);
      writer.draw(square(22, 12, o.length), i + 1, o.speed);
    });
    if (o.kind === "geometry") {
      const x = 22, y = 12, size = o.length;
      writer.draw([[x, y], [x + size, y + size]], 1, o.speed);
      writer.draw([[x + size, y], [x, y + size]], 1, o.speed);
      for (const radius of [size / 4, size / 2]) writer.draw(circle(x + size / 2, y + size / 2, radius), 1, o.speed);
    }
  } else {
    values.forEach((value, i) => {
      const y = 12 + i * (o.kind === "hatching" ? 38 : 24), row = i + 1;
      writer.comment(rowDescriptions[i]);
      drawLabel(String(row), row, 7, y, 5, 11);
      if (o.kind === "speed") drawLabel(`${formatCalibrationNumber(value)} mm/min`, row, 66, y + 12, 4.5, o.length - 46);
      drawCalibrationRow(writer.draw, value, row, y, o);
    });
  }
  return {gcode: writer.finish(), strokes: writer.strokes, values, rowDescriptions, width, height,
    record: makeRecord(config, o, width, height, rowDescriptions, font.family), labels, fontFamily: font.family};
}
