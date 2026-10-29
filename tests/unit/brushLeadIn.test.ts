import { describe, expect, it } from "vitest";
import { brushLeadInStart } from "../../src/workers/gcodeEngine/stages/penProfile";
import { createMachineConfig } from "../helpers/factories";

const machine = createMachineConfig({ penType: "stepper", origin: "bottom-left", bedWidth: 220, bedHeight: 200 });

describe("brush moving lead-in", () => {
  it("places the approach one millimetre behind the first stroke tangent by default", () => {
    expect(brushLeadInStart([{ x: 10, y: 20 }, { x: 20, y: 20 }], machine)).toEqual({ x: 9, y: 20 });
  });
  it("uses a physical millimetre distance on diagonal strokes and skips repeated first points", () => {
    const result = brushLeadInStart([{ x: 10, y: 20 }, { x: 10, y: 20 }, { x: 13, y: 16 }], machine, 2.5);
    expect(result.x).toBeCloseTo(8.5);
    expect(result.y).toBeCloseTo(22);
    expect(Math.hypot(result.x - 10, result.y - 20)).toBeCloseTo(2.5);
  });
  it("supports a centred machine origin and accepts an approach exactly on its boundary", () => {
    const centred = { ...machine, origin: "center" as const };
    expect(brushLeadInStart([{ x: -20, y: -10 }, { x: -14, y: -2 }], centred, 5)).toEqual({ x: -23, y: -14 });
    expect(brushLeadInStart([{ x: 1, y: 20 }, { x: 10, y: 20 }], machine)).toEqual({ x: 0, y: 20 });
  });
  it.each([0, 0.099, 20.001, NaN, Infinity])("rejects an invalid approach length %s", (length) => {
    expect(() => brushLeadInStart([{ x: 10, y: 20 }, { x: 20, y: 20 }], machine, length)).toThrow(/between 0.1 and 20/);
  });
  it("requires a moving stroke direction", () => {
    expect(() => brushLeadInStart([{ x: 10, y: 20 }, { x: 10, y: 20 }], machine)).toThrow(/direction/);
  });
  it("rejects an approach outside either the physical bed or the printable page margins", () => {
    expect(() => brushLeadInStart([{ x: 0, y: 20 }, { x: 10, y: 20 }], machine)).toThrow(/outside the printable area/);
    expect(() => brushLeadInStart([{ x: 10.5, y: 20 }, { x: 20, y: 20 }], machine, 1,
      { widthMM: 100, heightMM: 100, marginMM: 10 })).toThrow(/outside the printable area/);
    expect(() => brushLeadInStart([{ x: 220, y: 20 }, { x: 210, y: 20 }], machine, 1,
      { widthMM: 500, heightMM: 500, marginMM: 0 })).toThrow(/outside the printable area/);
  });
});
