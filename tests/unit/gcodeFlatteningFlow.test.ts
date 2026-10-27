import { describe, it, expect } from "vitest";
import { flattenToSubpaths } from "../../src/workers/gcodeEngine/stages/flatteningFlow";
import { createMachineConfig, createVectorObject } from "../helpers/factories";

describe("gcode flattening flow stage", () => {
  const cfg = createMachineConfig({
    origin: "top-left",
    bedWidth: 400,
    bedHeight: 400,
  });

  it("splits multiple move segments into separate subpaths", () => {
    const obj = createVectorObject({
      path: "M 0 0 L 10 10 M 20 20 L 30 30",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      originalWidth: 100,
      originalHeight: 100,
    });
    const subpaths = flattenToSubpaths(obj, cfg);
    expect(subpaths).toHaveLength(2);
  });

  it("closes Z paths back to the starting point", () => {
    const obj = createVectorObject({
      path: "M 0 0 L 10 0 L 10 10 Z",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      originalWidth: 100,
      originalHeight: 100,
    });
    const subpaths = flattenToSubpaths(obj, cfg);
    const first = subpaths[0][0];
    const last = subpaths[0][subpaths[0].length - 1];
    expect(first.x).toBeCloseTo(last.x);
    expect(first.y).toBeCloseTo(last.y);
  });

  it("expands smooth curves and arcs into multi-point polylines", () => {
    const obj = createVectorObject({
      path: "M 0 0 S 25 50 50 0 T 100 0 A 50 50 0 0 1 150 0",
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      originalWidth: 150,
      originalHeight: 100,
    });
    const subpaths = flattenToSubpaths(obj, cfg);
    expect(subpaths).toHaveLength(1);
    expect(subpaths[0].length).toBeGreaterThan(4);
  });

  it.each([
    [
      "M0 0 Q10 20 20 0 S30 -20 40 0",
      "M0 0 Q10 20 20 0 C20 0 30 -20 40 0",
    ],
    [
      "M0 0 Q10 20 20 0 T40 0 S50 20 60 0",
      "M0 0 Q10 20 20 0 T40 0 C40 0 50 20 60 0",
    ],
    [
      "M0 0 C10 20 20 20 30 0 T60 0",
      "M0 0 C10 20 20 20 30 0 Q30 0 60 0",
    ],
    [
      "M0 0 S20 20 30 0 T60 0",
      "M0 0 S20 20 30 0 Q30 0 60 0",
    ],
    [
      "M0 0 20 0 S30 20 40 0",
      "M0 0 20 0 C20 0 30 20 40 0",
    ],
  ])("uses the current point for an incompatible smooth curve in %s", (smooth, explicit) => {
    expect(flattenToSubpaths(createVectorObject({ path: smooth }), cfg)).toEqual(
      flattenToSubpaths(createVectorObject({ path: explicit }), cfg),
    );
  });

  it.each([
    [
      "M0 0 C10 20 20 20 30 0 S50 -20 60 0 80 20 90 0",
      "M0 0 C10 20 20 20 30 0 C40 -20 50 -20 60 0 C70 20 80 20 90 0",
    ],
    [
      "M0 0 Q10 20 20 0 T40 0 60 0",
      "M0 0 Q10 20 20 0 Q30 -20 40 0 Q50 20 60 0",
    ],
  ])("preserves reflection within the same curve family in %s", (smooth, explicit) => {
    expect(flattenToSubpaths(createVectorObject({ path: smooth }), cfg)).toEqual(
      flattenToSubpaths(createVectorObject({ path: explicit }), cfg),
    );
  });
});
