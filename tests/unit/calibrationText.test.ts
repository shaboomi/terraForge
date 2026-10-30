import { describe, expect, it } from "vitest";
import { textOutlines } from "../../src/renderer/src/features/calibration/calibrationText";

describe("plotted font outlines", () => {
  it("closes implicit contours and separates letters and their counters", () => {
    const paths = textOutlines([
      { type: "M", x: 0, y: 0 }, { type: "L", x: 2, y: 0 }, { type: "L", x: 2, y: -3 },
      { type: "M", x: 0.5, y: -0.5 }, { type: "L", x: 1, y: -0.5 }, { type: "L", x: 1, y: -1 }, { type: "Z" },
    ]);
    expect(paths).toEqual([[[0, -0], [2, -0], [2, 3], [0, -0]], [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 0.5]]]);
  });
  it("flattens quadratic and cubic curves in machine-Y-up coordinates", () => {
    const [path] = textOutlines([
      { type: "M", x: 0, y: 0 }, { type: "Q", x1: 0, y1: -4, x: 4, y: -4 },
      { type: "C", x1: 6, y1: -4, x2: 6, y2: 0, x: 8, y: 0 }, { type: "Z" },
    ]);
    expect(path.length).toBeGreaterThan(15);
    expect(path).toContainEqual([4, 4]);
    expect(path).toContainEqual([8, -0]);
    expect(path.every(([x, y]) => x >= 0 && x <= 8 && y >= 0 && y <= 4)).toBe(true);
    expect(path.at(-1)).toEqual(path[0]);
  });
  it("preserves collinear curve reversals rather than dropping control-point overshoot", () => {
    const [path] = textOutlines([{ type: "M", x: 0, y: 0 }, { type: "Q", x1: 10, y1: 0, x: 1, y: 0 }]);
    expect(Math.max(...path.map(point => point[0]))).toBeGreaterThan(5);
  });
});
