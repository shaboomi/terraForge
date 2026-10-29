// Actual plot-path previews, never a filled mockup or bitmap-backed conversion.
// Run with Node 24: node --experimental-strip-types scripts/comic-ink-previews.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { DEFAULT_BITMAP_PREPARATION, preparePluginBitmap } from '../src/types/pluginBitmapPreparation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/images/comic-ink');
await mkdir(output, { recursive: true });
const code = await readFile(path.join(root, 'docs/examples/comic-ink-vectorizer.tf-plugin.js'), 'utf8');
const manifest = JSON.parse(code.match(/\/\* terraforge-plugin\s*([\s\S]*?)\*\//)[1]);
const { default: run } = await import('../docs/examples/comic-ink-vectorizer.tf-plugin.js');
const defaults = Object.fromEntries(manifest.controls.map(c => [c.key, c.default]));
function raster(svg) {
  const rendered = new Resvg(svg).render();
  return { width: rendered.width, height: rendered.height, data: new Uint8Array(rendered.pixels), png: rendered.asPng() };
}
const portrait = await readFile(path.join(root, 'docs/images/spiral-sawtooth/portrait-source.png'));
const photo = raster(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><image width="256" height="256" href="data:image/png;base64,${portrait.toString('base64')}"/></svg>`);
// Second representative photograph: a different crop/frame from the same NASA
// source, emphasizing face, hair and fabric rather than a new copyrighted asset.
const detail = raster(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="224"><image x="-80" y="-8" width="480" height="480" href="data:image/png;base64,${portrait.toString('base64')}"/></svg>`);
const coffeeBytes = await readFile(path.join(output, 'coffee-original.png'));
const coffee = raster(`<svg xmlns="http://www.w3.org/2000/svg" width="288" height="192"><image width="288" height="192" href="data:image/png;base64,${coffeeBytes.toString('base64')}"/></svg>`);
const fixture = raster(`<svg xmlns="http://www.w3.org/2000/svg" width="160" height="112">
<path fill="#bd694f" fill-rule="evenodd" d="M8 8H76V104H8Z M28 32V72H56V32Z"/>
<path fill="#698ba0" d="M84 8H152V52H84Z"/>
<path fill="#252525" fill-rule="evenodd" d="M84 60H152V104H84Z M108 72V92H128V72Z"/>
<path fill="#888888" d="M60 80H100V104H60Z"/>
<path fill="white" d="M20 16H64V24H20Z"/></svg>`);
const stats = [];
function svgFor(items, image) {
  const workingScale = Math.max(1, Math.max(image.width, image.height) / defaults.resolution);
  // A broad colour nib and finer black nib are explicitly illustrative. These
  // widths are render settings, not plugin pen assignments or geometry fills.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${image.width * 3}" height="${image.height * 3}" viewBox="0 0 ${image.width} ${image.height}"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke-linecap="butt" stroke-linejoin="round">${items.flatMap(item => item.paths.map(p => `<path stroke="${p.color || '#000000'}" stroke-width="${workingScale * (item.name.startsWith('Colour') ? 0.86 : 0.46)}" d="${p.points.map((pt, i) => `${i ? 'L' : 'M'}${pt.x.toFixed(4)},${pt.y.toFixed(4)}`).join(' ')}"/>`)).join('')}</g></svg>`;
}
async function generate(name, image, changes = {}) {
  const parameters = { ...defaults, ...changes };
  const input = { kind: 'bitmap', sourceId: 'example-photo', width: image.width, height: image.height,
    widthPx: image.width, heightPx: image.height, data: image.data, palette: [],
    placement: { x: 0, y: 0, scale: 1, rotation: 0 }, page: { widthMM: 420, heightMM: 297 } };
  input.prepared = await preparePluginBitmap(input, { ...DEFAULT_BITMAP_PREPARATION, palette: [] });
  const start = performance.now();
  const result = await run(input, parameters, { runId: name, seed: 1, signal: new AbortController().signal,
    limits: { paths: 10000, points: 100000, executionMs: 30000 }, progress() {} });
  const ms = Math.round(performance.now() - start);
  await writeFile(path.join(output, `${name}.svg`), svgFor(result.items, image));
  const png = new Resvg(svgFor(result.items, image)).render().asPng();
  await writeFile(path.join(output, `${name}.png`), png);
  const separations = [];
  for (let i = 0; i < result.items.length; i++) {
    const item = result.items[i], stem = `${name}-separation-${i + 1}`;
    await writeFile(path.join(output, `${stem}.png`), new Resvg(svgFor([item], image)).render().asPng());
    separations.push({ file: `${stem}.png`, name: item.name, paths: item.paths.length, points: item.paths.reduce((n, p) => n + p.points.length, 0) });
  }
  stats.push({ name, parameters, ms, paths: separations.reduce((n, s) => n + s.paths, 0), points: separations.reduce((n, s) => n + s.points, 0), separations, warnings: result.warnings });
  console.log(`${name}: ${stats.at(-1).paths} paths, ${stats.at(-1).points} points, ${ms} ms`);
  return { png, items: result.items };
}
await writeFile(path.join(output, 'portrait-source.png'), photo.png);
await writeFile(path.join(output, 'detail-source.png'), detail.png);
await writeFile(path.join(output, 'fixture-source.png'), fixture.png);
await writeFile(path.join(output, 'coffee-source.png'), coffee.png);
const clean = await generate('portrait-clean', photo);
const heavy = await generate('portrait-heavy', photo, { preset: 'heavy', crosshatch: true });
await generate('detail-fine', detail, { preset: 'fine', crosshatch: true, hatchSpacing: 5 });
await generate('coffee-clean', coffee);
const test = await generate('fixture-clean', fixture, { minFeature: 2 });
const images = [photo.png, clean.png, heavy.png];
const comparison = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="430"><rect width="100%" height="100%" fill="white"/>${images.map((png, i) => `<text x="${i * 400 + 10}" y="24" font-size="18" font-family="sans-serif">${['NASA source', 'Clean Comic · actual paths', 'Heavy Ink · actual paths'][i]}</text><image x="${i * 400 + 8}" y="32" width="384" height="384" href="data:image/png;base64,${png.toString('base64')}"/>`).join('')}</svg>`;
await writeFile(path.join(output, 'comparison.png'), new Resvg(comparison).render().asPng());
// Compact sheet makes each separation easy to inspect without opening 8 files.
for (const [name, result, image] of [['portrait-separations', clean, photo], ['fixture-separations', test, fixture]]) {
  const cells = result.items.map((item, i) => {
    const x = (i % 4) * 250, y = Math.floor(i / 4) * 285;
    const png = new Resvg(svgFor([item], image)).render().asPng();
    return `<text x="${x + 8}" y="${y + 22}" font-size="14" font-family="sans-serif">${item.name}</text><image x="${x + 6}" y="${y + 32}" width="238" height="245" href="data:image/png;base64,${png.toString('base64')}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${Math.ceil(result.items.length / 4) * 285}"><rect width="100%" height="100%" fill="white"/>${cells.join('')}</svg>`;
  await writeFile(path.join(output, `${name}.png`), new Resvg(svg).render().asPng());
}
await writeFile(path.join(output, 'statistics.json'), JSON.stringify(stats, null, 2) + '\n');
