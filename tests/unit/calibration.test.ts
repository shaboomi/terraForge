import { describe, expect, it } from "vitest";
import { generateCalibration as generateWithFont, type CalibrationOptions } from "../../src/renderer/src/features/calibration/calibration";
import { calibrationFont } from "../helpers/calibrationFont";
import type { MachineConfig } from "../../src/types";
const generateCalibration = (config: MachineConfig, options: CalibrationOptions) => generateWithFont(config, options, calibrationFont);

const config: MachineConfig = { id: "test", name: "TerraPen", bedWidth: 300, bedHeight: 300, origin: "bottom-left", penType: "stepper", penUpCommand: "G0 Z5", penDownCommand: "G0 Z0", penUpDelayMs: 100, penDownDelayMs: 200, jogSpeed: 1000, drawSpeed: 1200, connection: {type: "wifi"} };
const options: CalibrationOptions = { kind: "speed", pen: "Felt tip", start: 600, end: 3600, rows: 6, speed: 1200, length: 100, liftZ: 5, contactZ: 0, zFeed: 120 };

describe("calibration G-code", () => {
  it("emits ordered speed rows in mm/min with both long-line directions and closed circles", () => {
    const sheet = generateCalibration(config, options);
    expect(sheet.values).toEqual([600,1200,1800,2400,3000,3600]);
    expect(sheet.gcode).toContain("G1 X122 Y12 F600");
    expect(sheet.gcode).toContain("G1 X22 Y17 F600");
    expect(sheet.gcode).toContain("G1 X122 Y132 F3600");
    expect(sheet.gcode.indexOf("; Row 1:")).toBeLessThan(sheet.gcode.indexOf("; Row 6:"));
    const circle = sheet.strokes.find(s => s.points.length === 65)!;
    expect(circle.points[0][0]).toBeCloseTo(circle.points[64][0]);
    expect(circle.points[0][1]).toBeCloseTo(circle.points[64][1]);
    expect(sheet.gcode).toContain("G4 P0.2");
    expect(sheet.gcode.trim().endsWith("G0 Z5\nG4 P0.1\nM2")).toBe(true);
    expect(sheet.record).toContain("3600 mm/min");
    expect(sheet.record).not.toContain("mm/s");
    expect(sheet.rowDescriptions).toHaveLength(6);
  });
  it("plots pen name, row numbers and speed values as system-font outlines", () => {
    const sheet = generateCalibration(config, options);
    expect(sheet.labels.map(label => label.text)).toContain("Pen: Felt tip");
    expect(sheet.labels.filter(label => label.text.endsWith("mm/min")).map(label => label.text))
      .toEqual(["600 mm/min", "1200 mm/min", "1800 mm/min", "2400 mm/min", "3000 mm/min", "3600 mm/min"]);
    for (const label of sheet.labels) {
      expect(label.points.length).toBeGreaterThan(0);
      for (const path of label.points) {
        expect(path.at(-1)).toEqual(path[0]);
        expect(path.length).toBeGreaterThan(4);
      }
    }
    const digit = sheet.labels.find(label => label.text === "2")!;
    expect(Math.min(...digit.points.flat().map(point => point[1]))).toBeCloseTo(36);
    expect(Math.max(...digit.points.flat().map(point => point[1]))).toBeGreaterThan(39);
    const labels = sheet.gcode.split("; Label:").slice(1);
    for (const section of labels) {
      const textMoves = section.split("; Row")[0].split("\n").filter(line => /^G1 X/.test(line));
      // The speed-row pattern follows the final label; inspect the label's first move.
      expect(textMoves[0]).toMatch(/F600$/);
    }
    expect(sheet.record).toContain("Text font: Test Sans");
  });
  it.each(["bottom-left", "bottom-right", "top-left", "top-right", "center"] as const)("keeps exported digit 2 upright on paper with a %s origin", origin => {
    const sheet = generateCalibration({...config, origin}, options);
    const row2 = sheet.gcode.split("; Row 2:")[1].split("; Row 3:")[0];
    const paths: number[][][] = [];
    let current: number[][] | undefined;
    for (const line of row2.split("\n")) {
      const move = /^(G[01]) X(-?[\d.]+) Y(-?[\d.]+)/.exec(line);
      if (!move) continue;
      let x = Number(move[2]), y = Number(move[3]);
      // Reconstruct positions as viewed on the paper: X right, Y up.
      if (origin === "center") { x += 150; y += 150; }
      if (origin === "bottom-right" || origin === "top-right") x = sheet.width-x;
      if (origin === "top-left" || origin === "top-right") y = sheet.height-y;
      if (move[1] === "G0") { current = [[x,y]]; paths.push(current); }
      else current?.push([x,y]);
    }
    const numberPaths = paths.filter(path => path.every(p => p[0] < 20));
    const digit = sheet.labels.find(label => label.text === "2")!;
    expect(numberPaths).toHaveLength(digit.points.length);
    for (const [index, path] of numberPaths.entries()) {
      expect(path).toHaveLength(digit.points[index].length);
      path.forEach((point, i) => point.forEach((value, axis) => expect(value).toBeCloseTo(digit.points[index][i][axis], 3)));
    }
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
  it("sweeps pen-down delay on short dashes while keeping pen-up delay fixed", () => {
    const sheet = generateCalibration(config, {...options, kind: "timing", start: 0, end: 300, rows: 2, timingMode: "down"});
    expect(sheet.values).toEqual([0, 300]);
    for (const row of [1, 2]) {
      const dashes = sheet.strokes.filter(s => s.row === row && s.points[0][0] >= 22);
      expect(dashes.length).toBeGreaterThanOrEqual(6);
      expect(dashes.every(s => s.points.length === 2 && Math.abs(s.points[1][0] - s.points[0][0]) <= 10)).toBe(true);
    }
    expect(sheet.gcode).toContain("G0 X22 Y12\nG0 Z0\nG1 ");
    expect(sheet.gcode).toContain("G0 X22 Y36\nG0 Z0\nG4 P0.3\nG1 ");
    expect(sheet.gcode).toContain("G0 Z5\nG4 P0.1\nG0 X");
    expect(sheet.record).toMatch(/down.*delay|delay.*down/i);
    expect(sheet.rowDescriptions[1]).toContain("300");
  });
  it("sweeps pen-up delay before dash-gap travel without adding a second dwell", () => {
    const sheet = generateCalibration(config, {...options, kind: "timing", start: 0, end: 300, rows: 2, timingMode: "up"});
    const row2 = sheet.gcode.slice(sheet.gcode.indexOf("; Row 2:"));
    expect(row2).toContain("G0 Z0\nG4 P0.2\nG1 X");
    expect(row2).toMatch(/G1 X[^\n]+ F1200\nG0 Z5\nG4 P0\.3\nG0 X/);
    expect(row2).not.toContain("G4 P0.3\nG0 Z5");
    expect(sheet.record).toMatch(/up.*delay|delay.*up/i);
  });
  it("creates a dimensioned geometry square, both diagonals and closed circles", () => {
    const sheet = generateCalibration(config, {...options, kind: "geometry", start: NaN, end: NaN, rows: NaN});
    const square = [[22,12],[122,12],[122,112],[22,112],[22,12]];
    expect(sheet.strokes.map(s => s.points)).toContainEqual(square);
    expect(sheet.strokes.map(s => s.points)).toContainEqual([[22,12],[122,112]]);
    expect(sheet.strokes.map(s => s.points.slice().sort((a,b) => a[0]-b[0]))).toContainEqual([[22,112],[122,12]]);
    const circles = sheet.strokes.filter(s => s.points.length === 65);
    expect(circles).toHaveLength(2);
    for (const [index, circle] of circles.entries()) {
      expect(circle.points[64][0]).toBeCloseTo(circle.points[0][0]);
      expect(circle.points[64][1]).toBeCloseTo(circle.points[0][1]);
      expect(Math.max(...circle.points.map(p => p[0])) - Math.min(...circle.points.map(p => p[0]))).toBeCloseTo(index === 0 ? 50 : 100);
      expect(Math.max(...circle.points.map(p => p[1])) - Math.min(...circle.points.map(p => p[1]))).toBeCloseTo(index === 0 ? 50 : 100);
    }
    expect(sheet.values).toEqual([100]);
    expect(sheet.height).toBe(140);
    expect(sheet.record).toContain("100");
    expect(sheet.record).toMatch(/diagonal/i);
  });
  it("retraces exactly the same square for every repeatability pass", () => {
    const sheet = generateCalibration(config, {...options, kind: "repeatability", start: NaN, end: NaN, rows: 4});
    const passes = sheet.strokes.filter(s => !s.label && s.points.length === 5);
    expect(passes).toHaveLength(4);
    for (const pass of passes) expect(pass.points).toEqual([[22,12],[122,12],[122,112],[22,112],[22,12]]);
    expect(passes.map(s => s.row)).toEqual([1,2,3,4]);
    expect(sheet.values).toEqual([1,2,3,4]);
    expect(sheet.rowDescriptions).toHaveLength(4);
    expect(sheet.height).toBe(140);
  });
  it("varies hatch spacing and includes crossings plus a long uninterrupted stroke", () => {
    const sheet = generateCalibration(config, {...options, kind: "hatching", start: 0.5, end: 2, rows: 2});
    expect(sheet.values).toEqual([0.5, 2]);
    const inkStrokes = (row: number) => sheet.strokes.filter(s => s.row === row && s.points.every(p => p[0] >= 22));
    expect(inkStrokes(1).length).toBeGreaterThan(inkStrokes(2).length);
    for (const row of [1,2]) {
      const pattern = inkStrokes(row);
      const longStroke = pattern.find(s => s.points.length >= 4 && s.points.reduce((sum, p, i, points) => i ? sum + Math.hypot(p[0]-points[i-1][0], p[1]-points[i-1][1]) : sum, 0) >= 200);
      expect(longStroke).toBeDefined();
      // Crosshatching must have at least two line directions on each row.
      const slopes = new Set(pattern.filter(s => s.points.length === 2).map(s => Math.atan2(s.points[1][1]-s.points[0][1], s.points[1][0]-s.points[0][0]).toFixed(2)));
      expect(slopes.size).toBeGreaterThanOrEqual(2);
    }
    expect(sheet.rowDescriptions[0]).toContain("0.5");
    expect(sheet.record).toMatch(/spacing/i);
  });
  it.each(["servo", "solenoid-hardware", "solenoid-software"] as const)("supports pen-command tests but blocks Z sweeps for %s", penType => {
    for (const kind of ["speed", "timing", "geometry", "repeatability", "hatching"] as const) {
      const range = kind === "timing" ? {start: 0, end: 300} : kind === "hatching" ? {start: 0.25, end: 2} : {};
      expect(() => generateCalibration({...config, penType}, {...options, ...range, kind, liftZ: NaN, contactZ: NaN, zFeed: NaN})).not.toThrow();
    }
    expect(() => generateCalibration({...config, penType}, {...options, kind:"brush", start:-1, end:0})).toThrow("stepper");
  });
  it.each([
    {rows: 1}, {rows: 11}, {rows: 2.5}, {start: 0}, {end: 600}, {speed: NaN}, {length: 0},
    {kind: "brush", start: -1, end: 0, liftZ: -0.5},
    {kind: "lift", start: -1, end: 1}, {kind: "brush", start: -1, end: 0, zFeed: 0},
    {kind: "timing", start: -1, end: 300}, {kind: "hatching", start: 0, end: 2},
    {kind: "hatching", start: 0.25, end: 11}, {kind: "repeatability", rows: 1},
  ] as Partial<CalibrationOptions>[])("rejects invalid settings %j", patch => {
    expect(() => generateCalibration(config, {...options, ...patch})).toThrow();
  });
  it("rejects sheets exceeding the bed instead of clipping test strokes", () => {
    expect(() => generateCalibration({...config, bedWidth: 100}, options)).toThrow("fit");
    expect(() => generateCalibration({...config, bedHeight: 100}, options)).toThrow("fit");
  });
  it.each(["bottom-left", "bottom-right", "top-left", "top-right", "center"] as const)("keeps all XY moves within the bed for %s", origin => {
    const tests: Partial<CalibrationOptions>[] = [{kind: "speed"}, {kind: "brush", start: -1, end: 0}, {kind: "lift", start: 0.5, end: 3}, {kind: "timing", start: 0, end: 300}, {kind: "geometry"}, {kind: "repeatability"}, {kind: "hatching", start: 0.25, end: 2}];
    for (const test of tests) {
      const sheet = generateCalibration({...config, origin}, {...options, ...test});
      for (const match of sheet.gcode.matchAll(/X(-?[\d.]+) Y(-?[\d.]+)/g)) {
        const x = Number(match[1]), y = Number(match[2]);
        const min = origin === "center" ? -150 : 0;
        const max = origin === "center" ? 150 : 300;
        expect(x).toBeGreaterThanOrEqual(min); expect(x).toBeLessThanOrEqual(max);
        expect(y).toBeGreaterThanOrEqual(min); expect(y).toBeLessThanOrEqual(max);
      }
    }
  });
  it("cannot inject G-code through the pen name", () => {
    const sheet = generateCalibration(config, {...options, pen: "test\nG0 Z-100"});
    expect(sheet.gcode).not.toContain("\nG0 Z-100");
  });
  it("omits the pen heading when the name is blank", () => {
    const sheet = generateCalibration(config, { ...options, pen: "   " });
    expect(sheet.labels.some(label => label.row === 0)).toBe(false);
    expect(sheet.labels.filter(label => label.text.endsWith("mm/min"))).toHaveLength(6);
  });
  it("wraps long names above the patterns and checks the enlarged height against the bed", () => {
    const pen = "Very long pen name ".repeat(4).trim();
    const sheet = generateCalibration(config, { ...options, pen });
    const heading = sheet.labels.filter(label => label.row === 0);
    expect(heading.length).toBeGreaterThan(1);
    expect(heading.map(label => label.text).join(" ")).toBe(`Pen: ${pen}`);
    for (const points of heading.flatMap(label => label.points)) {
      for (const [x, y] of points) {
        expect(x).toBeGreaterThanOrEqual(7); expect(x).toBeLessThanOrEqual(sheet.width - 7);
        expect(y).toBeGreaterThan(150); expect(y).toBeLessThan(sheet.height);
      }
    }
    expect(() => generateCalibration({ ...config, bedHeight: 164 }, { ...options, pen })).toThrow(/fit/);
  });
  it("keeps speed labels clear of the zigzags, circles and long lines", () => {
    const sheet = generateCalibration(config, { ...options, length: 80, start: 600.5, end: 1200.75 });
    const labels = sheet.labels.filter(label => label.text.endsWith("mm/min"));
    expect(labels[0].text).toBe("600.5 mm/min");
    expect(labels.at(-1)!.text).toBe("1200.75 mm/min");
    for (const label of labels) {
      const y = 12 + (label.row - 1) * 24;
      for (const points of label.points) for (const [x, yy] of points) {
        expect(x).toBeGreaterThan(54); expect(x).toBeLessThan(112);
        expect(yy).toBeGreaterThan(y + 5); expect(yy).toBeLessThan(y + 24);
      }
    }
  });
  it("rejects unsupported glyphs and excessively long names rather than exporting missing text", () => {
    expect(() => generateCalibration(config, { ...options, pen: "Missing 中" })).toThrow(/cannot plot/);
    expect(() => generateCalibration(config, { ...options, pen: "W".repeat(81) })).toThrow(/80 characters/);
  });
});
