/** Render actual plugin polylines to SVG + PNG. No photograph-based rendering. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const directory = path.join(root, "docs/images/sculptural-generators");
mkdirSync(directory, { recursive: true });
export const presets = [
  { slug: "flowing-ribbons", name: "woven-curtains", title: "Woven Curtains", parameters: { colour: "#aa362c" } },
  { slug: "flowing-ribbons", name: "braided-ribbons", title: "Braided Ribbons", parameters: { preset: "braid", crossweave: 0, colour: "#292b30" } },
  { slug: "wave-volume", name: "wave-volume", title: "Wave Volume", parameters: { colour: "#235a67" } },
  { slug: "organic-contours", name: "organic-contours", title: "Organic Contours", parameters: { colour: "#164970" } },
];

const summaries = [];
for (const preset of [...presets, { slug: "organic-contours", name: "border-gap-example", title: "Border gap: 5 mm", parameters: { border: true, borderGap: 5, colour: "#164970" } }]) {
  const source = readFileSync(path.join(root, `docs/examples/${preset.slug}.tf-plugin.js`), "utf8");
  const manifest = JSON.parse(source.match(/^\/\* terraforge-plugin\s*([\s\S]*?)\*\//)[1]);
  const parameters = { ...Object.fromEntries(manifest.controls.map(c => [c.key, c.default])), ...preset.parameters };
  const { default: run } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  const started = performance.now();
  const result = await run({ kind: "none", page: { widthMM: 210, heightMM: 297 }, palette: [] }, parameters, {
    signal: new AbortController().signal, seed: 1, progress() {}, limits: { paths: 10000, points: 100000, executionMs: 30000 },
  });
  const geometry = result.paths.map(p => `<path d="${p.points.map((v, i) => `${i ? "L" : "M"}${v.x.toFixed(5)},${v.y.toFixed(5)}`).join(" ")}${p.closed ? " Z" : ""}" stroke="${p.color}"/>`).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${result.width}mm" height="${result.height}mm" viewBox="0 0 ${result.width} ${result.height}"><g fill="none" stroke-width="0.18" stroke-linecap="round" stroke-linejoin="round">${geometry}</g></svg>\n`;
  writeFileSync(path.join(directory, `${preset.name}.svg`), svg);
  const png = new Resvg(svg, { background: "#faf8f3", fitTo: { mode: "width", value: 1000 } }).render().asPng();
  writeFileSync(path.join(directory, `${preset.name}.png`), png);
  writeFileSync(path.join(directory, `${preset.name}.json`), JSON.stringify({ pluginId: manifest.id, pluginVersion: manifest.version, parameters }, null, 2) + "\n");
  summaries.push({ name: preset.name, paths: result.paths.length, points: result.paths.reduce((n, p) => n + p.points.length, 0), ms: Math.round(performance.now() - started) });
}
writeFileSync(path.join(directory, "geometry-statistics.json"), JSON.stringify(summaries, null, 2) + "\n");
const panels = presets.map((preset, index) => {
  const svg = readFileSync(path.join(directory, `${preset.name}.svg`), "utf8");
  const content = svg.match(/^<svg[^>]*>([\s\S]*)<\/svg>\s*$/)[1];
  const x = 16 + index * 358;
  return `<rect x="${x}" y="16" width="342" height="550" rx="5" fill="#faf8f3"/><text x="${x + 16}" y="48" fill="#25333c" font-size="18" font-family="Segoe UI, sans-serif">${preset.title}</text><svg x="${x + 10}" y="69" width="322" height="465.1" viewBox="0 0 180 260">${content}</svg>`;
}).join("");
const contact = `<svg xmlns="http://www.w3.org/2000/svg" width="1448" height="582" viewBox="0 0 1448 582"><rect width="1448" height="582" fill="#e8e5de"/>${panels}</svg>`;
writeFileSync(path.join(directory, "four-presets.png"), new Resvg(contact, { font: { loadSystemFonts: true } }).render().asPng());
process.stdout.write(JSON.stringify(summaries, null, 2) + "\n");
