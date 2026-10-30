import { beforeEach, describe, expect, it, vi } from "vitest";
import { calibrationFontCandidates, readCalibrationFont } from "../../../src/main/calibrationFont";

const fileMocks = vi.hoisted(() => ({ stat: vi.fn(), readFile: vi.fn() }));
vi.mock("node:fs/promises", () => ({ ...fileMocks, default: fileMocks }));

beforeEach(() => { vi.resetAllMocks(); });

describe("system calibration fonts", () => {
  it("prefers Arial on Windows and macOS and provides Linux sans-serif alternatives", () => {
    expect(calibrationFontCandidates("win32")[0][0]).toBe("Arial");
    expect(calibrationFontCandidates("darwin")[0][0]).toBe("Arial");
    expect(calibrationFontCandidates("linux").map(([family]) => family)).toContain("Liberation Sans");
  });
  it("falls back when a font is absent and returns only its own bytes", async () => {
    fileMocks.stat.mockRejectedValueOnce(new Error("missing")).mockResolvedValue({ isFile: () => true, size: 3 });
    fileMocks.readFile.mockResolvedValue(Buffer.from([1, 2, 3]));
    const font = await readCalibrationFont();
    expect(font.family).toBe(calibrationFontCandidates()[1][0]);
    expect(Array.from(font.bytes)).toEqual([1, 2, 3]);
    expect(fileMocks.readFile).toHaveBeenCalledTimes(1);
  });
  it("reports a missing font and skips oversized files", async () => {
    fileMocks.stat.mockResolvedValue({ isFile: () => true, size: 20 * 1024 * 1024 });
    await expect(readCalibrationFont()).rejects.toThrow(/No supported system font/);
    expect(fileMocks.readFile).not.toHaveBeenCalled();
  });
});
