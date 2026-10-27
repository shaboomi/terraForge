/** Accept a three- or six-digit hex code, with an optional leading #. */
export function normalizeHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(hex)) return `#${hex}`;
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return `#${Array.from(hex, (digit) => digit + digit).join("")}`;
  }
  return null;
}

const NAMED_COLORS: Record<string, string> = {
  white: "#ffffff", silver: "#c0c0c0", gray: "#808080", grey: "#808080",
  black: "#000000", red: "#ff0000", maroon: "#800000", yellow: "#ffff00",
  olive: "#808000", lime: "#00ff00", green: "#008000", aqua: "#00ffff",
  cyan: "#00ffff", teal: "#008080", blue: "#0000ff", navy: "#000080",
  fuchsia: "#ff00ff", magenta: "#ff00ff", purple: "#800080", orange: "#ffa500",
};

/** Relative sRGB luminance; linearise channels to match perceived brightness. */
export function colorLuminance(color: string): number {
  const value = color.trim().toLowerCase();
  const hex = normalizeHexColor(value) ?? NAMED_COLORS[value];
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+)?\s*\)$/);
  const channels = hex
    ? [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))
    : rgb ? rgb.slice(1, 4).map(Number) : [0, 0, 0];
  const [r, g, b] = channels.map((channel) => {
    const srgb = Math.max(0, Math.min(255, channel)) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Stable sort comparator: highest perceived brightness first. */
export function compareColorsLightFirst(a: string, b: string): number {
  return colorLuminance(b) - colorLuminance(a);
}
