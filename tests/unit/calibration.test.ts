import { describe, expect, it } from "vitest";
import { generateCalibration, type CalibrationOptions } from "../../src/renderer/src/features/calibration/calibration";
import type { MachineConfig } from "../../src/types";

const config: MachineConfig = { id: "test", name: "TerraPen", bedWidth: 300, bedHeight: 300, origin: "bottom-left", penType: "stepper", penUpCommand: "G0 Z5", penDownCommand: "G0 Z0", penUpDelayMs: 100, penDownDelayMs: 200, jogSpeed: 1000, drawSpeed: 1200, connection: {type: "wifi"} };
const options: CalibrationOptions = { kind: "speed", pen: "Felt tip", start: 10, end: 60, rows: 6, speed: 20, length: 100, liftZ: 5, contactZ: 0, zFeed: 120 };

describe("calibration G-code", () => {
  it("emits ordered speed rows in mm/min with both long-line directions and closed circles", () => {
    const sheet = generateCalibration(config, options);
    expect(sheet.values).toEqual([10,20,30,40,50,60]);
    expect(sheet.gcode).toContain("G1 X122 Y12 F600");
    expect(sheet.gcode).toContain("G1 X22 Y17 F600");
    expect(sheet.gcode).toContain("G1 X122 Y132 F3600");
    expect(sheet.gcode.indexOf("; Row 1:")).toBeLessThan(sheet.gcode.indexOf("; Row 6:"));
    const circle = sheet.strokes.find(s => s.points.length === 65)!;
    expect(circle.points[0][0]).toBeCloseTo(circle.points[64][0]);
    expect(circle.points[0][1]).toBeCloseTo(circle.points[64][1]);
    expect(sheet.gcode).toContain("G4 P0.2");
    expect(sheet.gcode.trim().endsWith("G0 Z5\nG4 P0.1\nM2")).toBe(true);
    expect(sheet.record).toContain("60 mm/s (3600 mm/min)");
  });
  it("emits constant depths and coordinated thin/thick ramps and restores drawing feed after Z moves", () => {
    const sheet = generateCalibration(config, {...options, kind: "brush", start: -1, end: 0});
    expect(sheet.gcode).toContain("G1 Z-1 F120");
    expect(sheet.gcode).toContain("G1 X72 Y25 Z-1 F1200");
    expect(sheet.gcode).toContain("G1 X122 Y25 Z0 F1200");
    expect(sheet.gcode).toContain("G1 Z5 F120");
    expect(sheet.gcode).not.toContain(config.penDownCommand);
  });
  it("uses candidate lift heights for gaps and finishes at the safe height", () => {
    const sheet = generateCalibration(config, {...options, kind: "lift", start: 0.5, end: 3});
    expect(sheet.gcode).toContain("G1 Z0.5 F120");
    expect(sheet.gcode).toContain("G1 Z3 F120");
    expect(sheet.gcode.trim().endsWith("G1 Z5 F120\nG4 P0.1\nM2")).toBe(true);
    expect(sheet.strokes.filter(s => s.row === 1 && s.points[0][0] >= 22)).toHaveLength(6);
  });
  it.each(["servo", "solenoid-hardware", "solenoid-software"] as const)("supports speed but blocks Z sweeps for %s", penType => {
    expect(() => generateCalibration({...config, penType}, options)).not.toThrow();
    expect(() => generateCalibration({...config, penType}, {...options, kind:"brush", start:-1, end:0})).toThrow("stepper");
  });
  it.each([
    {rows: 1}, {rows: 11}, {rows: 2.5}, {start: 0}, {end: 10}, {speed: NaN}, {length: 0},
    {kind: "brush", start: -1, end: 0, liftZ: -0.5},
    {kind: "lift", start: -1, end: 1}, {kind: "brush", start: -1, end: 0, zFeed: 0},
  ] as Partial<CalibrationOptions>[])("rejects invalid settings %j", patch => {
    expect(() => generateCalibration(config, {...options, ...patch})).toThrow();
  });
  it("rejects sheets exceeding the bed instead of clipping test strokes", () => {
    expect(() => generateCalibration({...config, bedWidth: 100}, options)).toThrow("fit");
    expect(() => generateCalibration({...config, bedHeight: 100}, options)).toThrow("fit");
  });
  it.each(["bottom-left", "bottom-right", "top-left", "top-right", "center"] as const)("keeps all XY moves within the bed for %s", origin => {
    const sheet = generateCalibration({...config, origin}, options);
    for (const match of sheet.gcode.matchAll(/X(-?[\d.]+) Y(-?[\d.]+)/g)) {
      const x = Number(match[1]), y = Number(match[2]);
      const min = origin === "center" ? -150 : 0;
      const max = origin === "center" ? 150 : 300;
      expect(x).toBeGreaterThanOrEqual(min); expect(x).toBeLessThanOrEqual(max);
      expect(y).toBeGreaterThanOrEqual(min); expect(y).toBeLessThanOrEqual(max);
    }
  });
  it("cannot inject G-code through the pen name", () => {
    const sheet = generateCalibration(config, {...options, pen: "test\nG0 Z-100"});
    expect(sheet.gcode).not.toContain("\nG0 Z-100");
  });
});
