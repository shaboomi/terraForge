import type { FontOutlineCommand } from "../../../../types/fonts";
import { generateHatchPaths } from "../../utils/hatchFill";

export type TextInfill = "outline" | "solid" | "sketch";
export interface OutlineTemplate {
  commands: FontOutlineCommand[];
  minX: number; minY: number; maxX: number; maxY: number;
  fills: { x1: number; y1: number; x2: number; y2: number }[];
  work: number;
}
const coordinate = (value: number) => value.toFixed(6);

/** Keep native curves in the plotted outline while changing font Y-up units to SVG millimetres. */
export function outlinePathData(commands: FontOutlineCommand[], scale: number, x: number, baseline: number): string {
  const point = (px: number, py: number) => `${coordinate(x + px * scale)} ${coordinate(baseline - py * scale)}`;
  return commands.map((command) => {
    if (command.type === "Z") return "Z";
    const end = point(command.x, command.y);
    if (command.type === "Q") return `Q${point(command.x1, command.y1)} ${end}`;
    if (command.type === "C") return `C${point(command.x1, command.y1)} ${point(command.x2, command.y2)} ${end}`;
    return `${command.type}${end}`;
  }).join(" ");
}

/** Build once per repeated glyph. Fills are clipped plot strokes, never display-only SVG fill. */
export function createOutlineTemplate(commands: FontOutlineCommand[], scale: number, infill: TextInfill, spacing: number, angle: number): OutlineTemplate {
  const result: OutlineTemplate = { commands, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, fills: [], work: 0 };
  const bound = (x: number, y: number) => {
    if (![x, y].every(Number.isFinite)) throw new Error("The font has invalid outline coordinates. Import it again.");
    result.minX = Math.min(result.minX, x * scale); result.maxX = Math.max(result.maxX, x * scale);
    result.minY = Math.min(result.minY, -y * scale); result.maxY = Math.max(result.maxY, -y * scale);
  };
  for (const command of commands) {
    if (command.type === "Z") continue;
    bound(command.x, command.y);
    if (command.type === "Q" || command.type === "C") bound(command.x1, command.y1);
    if (command.type === "C") bound(command.x2, command.y2);
  }
  if (infill === "outline" || !commands.length) return result;
  const diagonal = Math.hypot(result.maxX - result.minX, result.maxY - result.minY);
  const actualSpacing = infill === "sketch" ? spacing * 2 : spacing;
  const passes = infill === "sketch" ? [angle, angle + 90] : [angle];
  const scanlines = Math.ceil(diagonal / actualSpacing) * passes.length;
  result.work = scanlines * commands.length * 32;
  // The shared hatcher flattens curves before scanning. Bound that work before
  // calling it, rather than discovering an oversized result after a UI freeze.
  if (scanlines > 20_000 || result.work > 8_000_000) {
    throw new Error("This infill is too detailed. Increase fill spacing, reduce the font size or use Outline.");
  }
  const d = outlinePathData(commands, scale, 0, 0);
  for (const pass of passes) {
    for (const line of generateHatchPaths(d, actualSpacing, pass, "nonzero")) {
      const values = line.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g)?.map(Number);
      if (!values || values.length !== 4 || !values.every(Number.isFinite)) throw new Error("Could not create the font infill.");
      result.fills.push({ x1: values[0], y1: values[1], x2: values[2], y2: values[3] });
      if (result.fills.length > 100_000) throw new Error("This infill has too many strokes. Increase fill spacing.");
    }
  }
  return result;
}
