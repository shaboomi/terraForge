/** Build three standalone API-1 plugins. No npm/runtime dependencies in outputs. */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const number = (key, label, value, min, max, step, unit) => ({ key, label, type: "number", default: value, min, max, step, ...(unit ? { unit } : {}) });
const select = (key, label, value, options) => ({ key, label, type: "select", default: value, options: options.map(([value, label]) => ({ label, value })) });
const boolean = (key, label, value) => ({ key, label, type: "boolean", default: value });
const pen = (key, label) => number(key, label, 0, 0, 256, 1);
const frame = [number("width", "Artwork width", 180, 20, 2000, 1, "mm"), number("height", "Artwork height", 260, 20, 2000, 1, "mm"), number("margin", "Margin", 12, 0, 200, 1, "mm"), number("rotation", "Artwork orientation", 0, -180, 180, 1, "°")];
const shared = [number("randomSeed", "Random seed", 42, 0, 2147483647, 1), number("variation", "Variation strength", 1, 0, 2, 0.05), number("tolerance", "Sampling tolerance (smaller = smoother)", 0.045, 0.005, 0.3, 0.005, "mm"), { key: "colour", label: "Stroke colour (pen position 0)", type: "colour", default: "#183d53" }, pen("penIndex", "Primary pen position (0 = stroke colour)"), boolean("border", "Add border", false),
  select("borderMode", "Border placement", "artwork", [["artwork", "Around artwork"], ["frame", "At artwork margin (original)"]]), number("borderGap", "Border gap from artwork", 5, 0, 200, 0.5, "mm")];
const definitions = [
  { slug: "flowing-ribbons", name: "Flowing Ribbons", description: "Original smooth ribbon surfaces: three woven curtains or an open overlapping braid. Preview required. Dimensions and spacing are millimetres; intersections are intentional.", controls: [
    select("preset", "Composition preset", "curtains", [["curtains", "Woven Curtains"], ["braid", "Braided Ribbons"]]), ...frame,
    number("ribbonCount", "Ribbon count", 3, 1, 12, 1), number("ribbonWidth", "Ribbon width", 34, 4, 200, 1, "mm"), number("separation", "Ribbon separation", 18, 0, 150, 1, "mm"),
    number("spacing", "Line spacing across ribbon", 0.6, 0.1, 8, 0.05, "mm"), number("bend", "Bend strength", 9, 0, 80, 1, "mm"), number("wavelength", "Bend wavelength", 90, 15, 500, 1, "mm"),
    number("twist", "Twist amount", 1.1, 0, 5, 0.05), number("phaseVariation", "Phase variation between ribbons", 1, 0, 3, 0.05), number("crossweave", "Crossweave amount (0 = off)", 0.65, 0, 1.5, 0.05),
    number("irregularity", "Smooth irregularity strength", 2, 0, 30, 0.5, "mm"), number("irregularityScale", "Smooth irregularity scale", 110, 15, 500, 1, "mm"),
    select("penMode", "Pen assignment", "single", [["single", "Single pen / colour"], ["ribbons", "Configured pens by ribbon, in palette order"], ["families", "Primary strands / crossweave pens"]]), pen("crossPenIndex", "Crossweave pen position (0 = primary)"), ...shared,
  ] },
  { slug: "wave-volume", name: "Wave Volume", description: "Original projected upper/lower wave surfaces with long connecting strands. Camera-facing side strands; transparent wire surfaces. Preview required; dimensions are millimetres.", controls: [
    ...frame, number("footprintWidth", "Footprint width", 112, 10, 500, 1, "mm"), number("footprintDepth", "Footprint depth", 78, 10, 500, 1, "mm"), number("separation", "Vertical surface separation", 105, 5, 500, 1, "mm"),
    number("amplitude", "Wave amplitude", 22, 0, 100, 1, "mm"), number("wavelength", "Wave wavelength", 85, 10, 500, 1, "mm"), number("complexity", "Surface complexity", 3, 1, 6, 1), number("phaseDifference", "Upper/lower phase difference", 125, -180, 180, 1, "°"),
    number("spacing", "Strand spacing (also surface grid)", 1, 0.15, 10, 0.05, "mm"), number("azimuth", "Projection azimuth", 35, -180, 180, 1, "°"), number("elevation", "Projection elevation", 30, 5, 80, 1, "°"),
    boolean("upper", "Show upper surface", true), boolean("lower", "Show lower surface", true), boolean("strands", "Show connecting strands", true), number("opening", "Hollow centre (0 = solid)", 0, 0, 65, 1, "%"),
    select("penMode", "Pen assignment", "single", [["single", "Single pen / colour"], ["families", "Upper / lower / connecting strand pens"]]), pen("surfacePenIndex", "Lower surface pen position (0 = primary)"), pen("strandPenIndex", "Connecting strand pen position (0 = primary)"), ...shared,
  ] },
  { slug: "organic-contours", name: "Organic Contours", description: "Original floating nested contour sculpture. One smooth invertible field preserves nesting; Contour count is the sole density control. Preview required.", controls: [
    ...frame, number("count", "Contour count (density)", 135, 8, 700, 1), number("aspect", "Base aspect ratio (width / height)", 0.68, 0.25, 2, 0.01), number("opening", "Inner opening", 7, 1, 75, 1, "%"),
    number("lobes", "Lobes", 3, 1, 9, 1), number("lobeStrength", "Lobe strength", 0.55, 0, 1.5, 0.05), number("warp", "Warp strength", 0.65, 0, 2, 0.05), number("warpScale", "Warp scale", 3.4, 0.5, 9, 0.1), number("twist", "Twist", 0.65, -3, 3, 0.05),
    number("pinch", "Pinch strength", 0.55, 0, 0.95, 0.01), number("pinchPosition", "Pinch position (-1 top, +1 bottom)", -0.15, -1, 1, 0.05), number("bias", "Spacing bias (- outer, + inner)", -0.15, -0.8, 0.8, 0.05), ...shared,
  ] },
];

const kernel = readFileSync(path.join(root, "scripts/lib/sculptural-generators/kernel.js"), "utf8");
for (const { slug, ...definition } of definitions) {
  if (definition.controls.length > 32) throw new Error(`${slug}: too many controls`);
  const manifest = { id: `terraforge.${slug}`, ...definition, version: "1.0.0", apiVersion: 1, category: "generator", input: "none", outputs: ["vector"], previewRequired: true };
  const algorithm = readFileSync(path.join(root, `scripts/lib/sculptural-generators/${slug}.js`), "utf8");
  const source = `/* terraforge-plugin\n${JSON.stringify(manifest, null, 2)}\n*/\n${algorithm}\n${kernel}`;
  writeFileSync(path.join(root, `docs/examples/${slug}.tf-plugin.js`), source);
  process.stdout.write(`${definition.name}: ${definition.controls.length} controls, ${Buffer.byteLength(source)} bytes\n`);
}
