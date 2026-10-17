import { describe, it, expect } from "vitest";
import {
  separateCMY,
  separateCMYK,
  separateCustomPalette,
  separateRGB,
  separateRGBOnWhite,
} from "../../src/renderer/src/features/bitmap-renderers/colourSeparation";
import type { BitmapColorData } from "../../src/renderer/src/features/bitmap-renderers/bitmapImage";

function uniformImage(r: number, g: number, b: number, width = 2, height = 2): BitmapColorData {
  const pixelCount = width * height;
  const rgba = new Uint8Array(pixelCount * 4);
  for (let i = 0; i < pixelCount; i++) {
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = b;
    rgba[i * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

describe("separateRGBOnWhite", () => {
  /** Ink density (0 = none, 255 = full) per channel, for a uniform colour. */
  const inks = (r: number, g: number, b: number) =>
    separateRGBOnWhite(uniformImage(r, g, b)).map((channel) => 255 - channel.luminance.values[0]);

  it("puts no ink on white paper where the image is white", () => {
    expect(inks(255, 255, 255)).toEqual([0, 0, 0]);
  });

  it("draws a pure primary with that primary's pen alone", () => {
    expect(inks(255, 0, 0)).toEqual([255, 0, 0]);
    expect(inks(0, 255, 0)).toEqual([0, 255, 0]);
    expect(inks(0, 0, 255)).toEqual([0, 0, 255]);
  });

  it("builds black and greys from all three pens equally", () => {
    const [r, g, b] = inks(0, 0, 0);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(120);
    const grey = inks(128, 128, 128);
    expect(new Set(grey).size).toBe(1);
    expect(grey[0]).toBeLessThan(r);
  });

  it("absorbs each missing primary with the two inks that absorb it, for colours the pens can mix", () => {
    // A red pen absorbs green and blue, and so on: the inks covering each
    // primary should add up to how much of it the pixel lacks.
    for (const [R, G, B] of [[200, 90, 40], [120, 170, 200], [100, 100, 20]]) {
      const [r, g, b] = inks(R, G, B);
      expect(g + b, `red missing for ${R},${G},${B}`).toBeCloseTo(255 - R, -1);
      expect(r + b, `green missing for ${R},${G},${B}`).toBeCloseTo(255 - G, -1);
      expect(r + g, `blue missing for ${R},${G},${B}`).toBeCloseTo(255 - B, -1);
    }
  });

  it("draws a colour the pens cannot mix as the nearest mix they can, never negative ink", () => {
    // A strong cyan would need negative red ink; red is left off instead.
    const [r, g, b] = inks(30, 160, 220);
    expect(r).toBe(0);
    expect(g).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(g);
  });

  it("labels and colours its channels like the dark-paper mode", () => {
    expect(separateRGBOnWhite(uniformImage(0, 0, 0)).map((c) => [c.label, c.color])).toEqual([
      ["Red", "#ff0000"],
      ["Green", "#00ff00"],
      ["Blue", "#0000ff"],
    ]);
  });
});

describe("separateRGB", () => {
  it("gives full ink (luminance 0) for a pixel's own primary and no ink for the others", () => {
    const [red, green, blue] = separateRGB(uniformImage(255, 0, 0));
    expect(red.label).toBe("Red");
    expect(red.luminance.values[0]).toBe(0);
    expect(green.luminance.values[0]).toBe(255);
    expect(blue.luminance.values[0]).toBe(255);
  });

  it("gives no ink anywhere for a black pixel", () => {
    const channels = separateRGB(uniformImage(0, 0, 0));
    for (const channel of channels) expect(channel.luminance.values[0]).toBe(255);
  });

  it("preserves the source image dimensions", () => {
    const channels = separateRGB(uniformImage(1, 2, 3, 4, 5));
    for (const channel of channels) {
      expect(channel.luminance.width).toBe(4);
      expect(channel.luminance.height).toBe(5);
      expect(channel.luminance.values).toHaveLength(20);
    }
  });
});

describe("separateCMY", () => {
  it("needs magenta and yellow but no cyan for a pure red pixel", () => {
    const [cyan, magenta, yellow] = separateCMY(uniformImage(255, 0, 0));
    expect(cyan.luminance.values[0]).toBe(255); // no cyan ink
    expect(magenta.luminance.values[0]).toBe(0); // full magenta ink
    expect(yellow.luminance.values[0]).toBe(0); // full yellow ink
  });

  it("needs no ink anywhere for a white pixel", () => {
    const channels = separateCMY(uniformImage(255, 255, 255));
    for (const channel of channels) expect(channel.luminance.values[0]).toBe(255);
  });
});

describe("separateCMYK", () => {
  it("routes a black pixel entirely to the black channel", () => {
    const [cyan, magenta, yellow, black] = separateCMYK(uniformImage(0, 0, 0));
    expect(black.label).toBe("Black");
    expect(black.luminance.values[0]).toBe(0); // full black ink
    expect(cyan.luminance.values[0]).toBe(255);
    expect(magenta.luminance.values[0]).toBe(255);
    expect(yellow.luminance.values[0]).toBe(255);
  });

  it("needs no ink anywhere for a white pixel", () => {
    const channels = separateCMYK(uniformImage(255, 255, 255));
    for (const channel of channels) expect(channel.luminance.values[0]).toBe(255);
  });

  it("removes black from a saturated red pixel via under-colour removal", () => {
    const [cyan, magenta, yellow, black] = separateCMYK(uniformImage(255, 0, 0));
    expect(black.luminance.values[0]).toBe(255); // no black needed
    expect(cyan.luminance.values[0]).toBe(255); // no cyan needed
    expect(magenta.luminance.values[0]).toBe(0);
    expect(yellow.luminance.values[0]).toBe(0);
  });
});

describe("separateCustomPalette", () => {
  it("gives full ink where a pixel exactly matches a swatch", () => {
    const [channel] = separateCustomPalette(uniformImage(10, 20, 30), [
      { label: "Custom", color: "#0a141e" }, // exactly (10, 20, 30)
    ]);
    expect(channel.luminance.values[0]).toBe(0);
  });

  it("gives no ink where a pixel is maximally distant from a swatch", () => {
    const [channel] = separateCustomPalette(uniformImage(255, 255, 255), [
      { label: "Black swatch", color: "#000000" },
    ]);
    expect(channel.luminance.values[0]).toBe(255);
  });

  it("produces one channel per palette entry, each carrying its own colour", () => {
    const channels = separateCustomPalette(uniformImage(128, 128, 128), [
      { label: "A", color: "#ff0000" },
      { label: "B", color: "#00ff00" },
    ]);
    expect(channels).toHaveLength(2);
    expect(channels[0]).toMatchObject({ label: "A", color: "#ff0000" });
    expect(channels[1]).toMatchObject({ label: "B", color: "#00ff00" });
  });
});
