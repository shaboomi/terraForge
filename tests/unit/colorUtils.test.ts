import { describe, expect, it } from "vitest";
import { normalizeHexColor, compareColorsLightFirst, colorLuminance } from "../../src/types/colorUtils";

describe("colour values", () => {
  it("normalizes precise custom colour codes", () => {
    expect(normalizeHexColor(" #AfC ")).toBe("#aaffcc");
    expect(normalizeHexColor("ABCDEF")).toBe("#abcdef");
    expect(normalizeHexColor("#12345g")).toBeNull();
    expect(normalizeHexColor("red")).toBeNull();
  });
  it("orders perceived lightness, including equally saturated colours", () => {
    const colors = ["#000000", "#0000ff", "#ffffff", "#ff0000", "#ffff00", "#00ff00"];
    expect(colors.sort(compareColorsLightFirst)).toEqual(["#ffffff", "#ffff00", "#00ff00", "#ff0000", "#0000ff", "#000000"]);
    expect(colorLuminance("rgb(255, 255, 255)")).toBeCloseTo(1);
    expect(colorLuminance("white")).toBeCloseTo(1);
    expect(compareColorsLightFirst("#fff", "#ffffff")).toBe(0);
  });
});
