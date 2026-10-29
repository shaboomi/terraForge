/** Run: node --experimental-strip-types scripts/plugin-bitmap-benchmark.mts
 * Local CPU/structured-clone benchmark. It does not launch Electron or connect to a plotter.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { DEFAULT_BITMAP_PREPARATION, PluginBitmapPreparationCache, preparePluginBitmap } from "../src/types/pluginBitmapPreparation.ts";

const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const timed = async (action: () => unknown, count = 5) => {
  const samples: number[] = [];
  for (let index = 0; index <= count; index++) {
    const started = performance.now(); await action();
    if (index) samples.push(performance.now() - started);
  }
  return Number(median(samples).toFixed(2));
};
const plugins = ["cmyk-circles", "spiral-sawtooth"].map((name) => {
  const source = readFileSync(`docs/examples/${name}.tf-plugin.js`, "utf8");
  const manifest = JSON.parse(source.match(/\/\* terraforge-plugin\s*([\s\S]*?)\*\//)![1]);
  return { name, manifest, run: new Function(source.replace(/export default (?:async )?function run/, "return function run"))() };
});
const palette = ["#00ffff", "#ff00ff", "#ffff00", "#000000"].map((color, index) => ({ id: `pen-${index}`, name: `Pen ${index}`, color }));
const results: object[] = [];
for (const edge of [384, 768]) {
  const data = new Uint8Array(edge * edge * 4);
  for (let y = 0; y < edge; y++) for (let x = 0; x < edge; x++) {
    const offset = (y * edge + x) * 4;
    data[offset] = Math.round(x / edge * 255); data[offset + 1] = Math.round(y / edge * 255);
    data[offset + 2] = Math.round((x + y) / (2 * edge) * 255); data[offset + 3] = 255;
  }
  const pixels = { widthPx: edge, heightPx: edge, data };
  const input = { ...pixels, kind: "bitmap", sourceId: "benchmark", page: { widthMM: 1000, heightMM: 1000 }, width: edge, height: edge,
    placement: { x: 0, y: 0, scale: 1, rotation: 0 }, palette };
  const settings = { ...DEFAULT_BITMAP_PREPARATION, palette: [], smoothing: 2, separation: "cmyk" as const };
  const cache = new PluginBitmapPreparationCache();
  const coldMs = await timed(() => preparePluginBitmap(pixels, settings));
  await cache.prepare(pixels, settings);
  const warmMs = await timed(() => cache.prepare(pixels, settings));
  const cloneRgbaMs = await timed(() => structuredClone(data));
  const prepared = await cache.prepare(pixels, settings);
  const clonePreparedMs = await timed(() => structuredClone({ ...input, prepared }));
  results.push({ workflow: "shared CMYK preparation, radius 2", edge, coldMs, cachedMs: warmMs,
    speedup: Number((coldMs / warmMs).toFixed(1)), retainedBytes: cache.byteLength, originalRgbaBytes: data.byteLength,
    cloneRgbaMs, cloneRgbaAndPreparedMs: clonePreparedMs });
  for (const plugin of plugins) {
    const parameters = Object.fromEntries(plugin.manifest.controls.map((control: { key: string; default: unknown }) => [control.key, control.default]));
    if (plugin.name === "cmyk-circles") Object.assign(parameters, { cyanPen: "pen-0", magentaPen: "pen-1", yellowPen: "pen-2", blackPen: "pen-3", fitToBudget: true });
    const elapsed = await timed(() => plugin.run(structuredClone(input), parameters, {
      runId: "benchmark", signal: new AbortController().signal, progress() {}, seed: 1,
      limits: { paths: 10000, points: 100000, executionMs: 30000 },
    }));
    results.push({ workflow: plugin.name, edge, medianMs: elapsed });
  }
}
console.log(JSON.stringify({ recordedAt: new Date().toISOString(), node: process.version,
  methodology: "Median of five timed runs after one warmup; deterministic RGB gradient; source-local pixels; no runtime reuse or Electron IPC timing.", results }, null, 2));
