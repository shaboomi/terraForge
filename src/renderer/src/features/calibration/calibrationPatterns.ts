import type { CalibrationOptions } from "./calibration";
import type { DrawCalibrationStroke } from "./calibrationGcode";

// Segment templates use screen coordinates. Invert only their local Y for upright machine-Y-up digits.
const segments = [ [[0,0],[2,0]], [[2,0],[2,2]], [[2,2],[2,4]],
  [[0,4],[2,4]], [[0,2],[0,4]], [[0,0],[0,2]], [[0,2],[2,2]] ];
const digits = ["012345", "12", "01643", "01236", "5612", "05623", "054236", "012", "0123456", "012356"];

export function drawNumber(draw: DrawCalibrationStroke, row: number, y: number, o: CalibrationOptions) {
  const feed = o.kind === "speed" ? Math.min(o.speed, o.start) : o.speed;
  const z = o.kind === "brush" ? o.end : o.contactZ;
  String(row).split("").forEach((digit, j) => {
    for (const s of digits[Number(digit)]) draw(segments[Number(s)].map(p => [7 + j * 4 + p[0], y + 4 - p[1]]), row, feed, {z});
  });
}

export const square = (x: number, y: number, size: number): number[][] =>
  [[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]];
export const circle = (x: number, y: number, radius: number): number[][] =>
  Array.from({length: 65}, (_, k) => [x + radius * Math.cos(k * Math.PI / 32), y + radius * Math.sin(k * Math.PI / 32)]);

function drawHatching(draw: DrawCalibrationStroke, spacing: number, row: number, y: number, o: CalibrationOptions) {
  const width = Math.min(40, o.length / 3), height = 16;
  for (let i = 0; i <= Math.floor(height / spacing); i++) {
    const yy = y + i * spacing;
    draw([[22, yy], [22 + width, yy]], row, o.speed);
  }
  // Clip two diagonal line families to a second patch. Spacing is perpendicular to the lines.
  const x = 22 + width + 12, step = spacing * Math.SQRT2;
  for (let i = 1; i * step < width + height; i++) {
    const offset = i * step;
    const a = [x + Math.max(0, offset - height), y + Math.min(height, offset)];
    const b = [x + Math.min(width, offset), y + Math.max(0, offset - width)];
    draw([a, b], row, o.speed);
    draw([[a[0], y + height - (a[1] - y)], [b[0], y + height - (b[1] - y)]], row, o.speed);
  }
  draw([[22, y + 24], [22 + o.length, y + 24], [22 + o.length, y + 28], [22, y + 28]], row, o.speed);
}

export function drawCalibrationRow(draw: DrawCalibrationStroke, value: number, row: number, y: number, o: CalibrationOptions) {
  const x = 22, feed = o.kind === "speed" ? value : o.speed;
  switch (o.kind) {
    case "speed":
      draw([[x,y],[x+o.length,y]], row, feed);
      draw([[x+o.length,y+5],[x,y+5]], row, feed);
      draw([[x,y+10],[x+8,y+17],[x+16,y+10],[x+24,y+17],[x+32,y+10]], row, feed);
      draw(circle(x+o.length+18, y+8, 8), row, feed);
      break;
    case "brush":
      draw([[x,y],[x+o.length,y]], row, feed, {z: value});
      draw([[x+o.length,y+6],[x,y+6]], row, feed, {z: value});
      draw([[x,y+13],[x+o.length/2,y+13,value],[x+o.length,y+13,o.end]], row, feed, {z: o.end});
      break;
    case "lift":
      for (let k = 0; k < 6; k++) {
        const sx = x + k * o.length / 6;
        draw([[sx,y],[sx+o.length/12,y]], row, feed, {clearance: value, arrivalZ: k === 0 ? o.liftZ : value});
      }
      break;
    case "timing":
      for (let k = 0; k < 6; k++) {
        const sx = x + k * o.length / 6;
        const points = [[sx, y], [sx + 4, y]];
        draw(k % 2 ? points.reverse() : points, row, feed,
          o.timingMode === "up" ? {upDelay: value} : {downDelay: value});
      }
      break;
    case "hatching": drawHatching(draw, value, row, y, o); break;
  }
}
