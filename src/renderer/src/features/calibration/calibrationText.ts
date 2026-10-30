import { parse, type Font, type PathCommand } from "opentype.js";
import type { CalibrationFontData } from "../../../../types";

export interface CalibrationFont { family: string; font: Font }
export interface CalibrationLabel {
  text: string;
  row: number;
  points: number[][][];
}

export function parseCalibrationFont(data: CalibrationFontData): CalibrationFont {
  return { family: data.family, font: parse(new Uint8Array(data.bytes).buffer) };
}

/** Subdivide Béziers to 0.025 mm; the same polylines drive the preview and plot. */
function flattenCurve(points: number[][], output: number[][], depth = 0): void {
  const first = points[0], last = points.at(-1)!;
  const dx = last[0] - first[0], dy = last[1] - first[1], length = Math.hypot(dx, dy);
  const flat = points.slice(1, -1).every(p => length < 1e-9
    ? Math.hypot(p[0] - first[0], p[1] - first[1]) <= 0.025
    : Math.abs(dy * (p[0] - first[0]) - dx * (p[1] - first[1])) / length <= 0.025 &&
      (p[0] - first[0]) * dx + (p[1] - first[1]) * dy >= 0 &&
      (p[0] - last[0]) * dx + (p[1] - last[1]) * dy <= 0);
  if (flat || depth >= 16) { output.push(last); return; }
  let level = points;
  const left = [first], right = [last];
  while (level.length > 1) {
    level = level.slice(1).map((p, i) => [(level[i][0] + p[0]) / 2, (level[i][1] + p[1]) / 2]);
    left.push(level[0]); right.unshift(level.at(-1)!);
  }
  flattenCurve(left, output, depth + 1); flattenCurve(right, output, depth + 1);
}

export function textOutlines(commands: PathCommand[]): number[][][] {
  const paths: number[][][] = [];
  let points: number[][] = [];
  const finish = () => {
    if (points.length > 1) {
      // CFF contours may close implicitly at the next move, without a Z command.
      if (points.at(-1)![0] !== points[0][0] || points.at(-1)![1] !== points[0][1]) points.push([...points[0]]);
      paths.push(points);
    }
    points = [];
  };
  for (const command of commands) {
    switch (command.type) {
      case "M": finish(); points = [[command.x, -command.y]]; break;
      case "L": points.push([command.x, -command.y]); break;
      case "Q": flattenCurve([points.at(-1)!, [command.x1, -command.y1], [command.x, -command.y]], points); break;
      case "C": flattenCurve([points.at(-1)!, [command.x1, -command.y1], [command.x2, -command.y2], [command.x, -command.y]], points); break;
      case "Z": finish(); break;
    }
  }
  finish();
  return paths;
}

export function createCalibrationLabel(font: CalibrationFont, text: string, row: number, x: number, y: number, size: number, maxWidth: number): CalibrationLabel {
  for (const char of text) {
    if (!font.font.hasChar(char)) throw new Error(`The system font ${font.family} cannot plot “${char}”. Use a pen name supported by this font.`);
  }
  const path = font.font.getPath(text, 0, 0, size);
  const box = path.getBoundingBox();
  const scale = Math.min(1, maxWidth / Math.max(0.001, box.x2 - box.x1));
  return { text, row, points: textOutlines(path.commands).map(points => points.map(p => [x + (p[0] - box.x1) * scale, y + p[1] * scale])) };
}

/** Wrap long names at spaces, or between characters when one word exceeds the width. */
export function wrapCalibrationText(font: CalibrationFont, text: string, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of text) {
    const next = line + char;
    if (line && font.font.getAdvanceWidth(next, size) > maxWidth) {
      const space = line.lastIndexOf(" ");
      if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1) + char; }
      else { lines.push(line); line = char; }
    } else line = next;
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}
