import type { PluginManifest } from "../../types";

export const EXAMPLE_PLUGIN_FILENAME = "example-grid.tf-plugin.js";

const manifest: PluginManifest = {
  id: "terraforge.example-grid",
  name: "Example Grid",
  version: "1.0.0",
  apiVersion: 1,
  description: "Create an editable grid to try local JavaScript plugins.",
  category: "generator",
  input: "none",
  outputs: ["vector"],
  controls: [
    { key: "width", label: "Width", type: "number", default: 80, min: 1, max: 1000, step: 1, unit: "mm" },
    { key: "height", label: "Height", type: "number", default: 60, min: 1, max: 1000, step: 1, unit: "mm" },
    { key: "spacing", label: "Spacing", type: "number", default: 10, min: 0.5, max: 100, step: 0.5, unit: "mm" },
    { key: "border", label: "Border", type: "boolean", default: true },
  ],
};

/** Written only by an explicit user action; existing files are never replaced. */
export const EXAMPLE_PLUGIN_SOURCE = `/* terraforge-plugin
${JSON.stringify(manifest, null, 2)}
*/
export default async function run(input, parameters, context) {
  const { width, height, spacing, border } = parameters;
  const paths = [];
  const add = (points, closed = false) => paths.push({ points, closed, color: "#6e56cf" });
  if (border) add([{x: 0, y: 0}, {x: width, y: 0}, {x: width, y: height}, {x: 0, y: height}], true);
  const total = Math.ceil(width / spacing) + Math.ceil(height / spacing);
  let done = 0;
  const tick = async () => {
    if (context.signal.aborted) throw new Error("Cancelled");
    if (++done % 20 === 0) {
      context.progress(Math.min(99, Math.round(done / total * 100)));
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  for (let x = spacing; x < width; x += spacing) {
    add([{x, y: 0}, {x, y: height}]);
    await tick();
  }
  for (let y = spacing; y < height; y += spacing) {
    add([{x: 0, y}, {x: width, y}]);
    await tick();
  }
  if (paths.length === 0) throw new Error("Use smaller spacing or turn on Border.");
  context.progress(100);
  return { width, height, paths };
}
`;