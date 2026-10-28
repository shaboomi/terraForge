// Rebuild the checked-in examples from the actual self-contained plugin.
// Run: node scripts/spiral-sawtooth-previews.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { inflateSync, deflateSync } from 'node:zlib';
import { Resvg } from '@resvg/resvg-js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/images/spiral-sawtooth');
await mkdir(output, { recursive: true });
const code = await readFile(path.join(root, 'docs/examples/spiral-sawtooth.tf-plugin.js'), 'utf8');
const manifest = JSON.parse(code.match(/\/\* terraforge-plugin\s*([\s\S]*?)\*\//)[1]);
const { default: run } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const defaults = Object.fromEntries(manifest.controls.map(control => [control.key, control.default]));

// The committed NASA/scikit-image fixture is an ordinary non-interlaced RGB PNG.
// Keep the generator independent of optional image-decoder packages.
function decodePng(bytes) {
  let width, height, channels;
  const compressed = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9]) || data[12]) throw new Error('Expected RGB/RGBA8 non-interlaced PNG');
      channels = data[9] === 2 ? 3 : 4;
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const a = x >= channels ? pixels[i - channels] : 0;
      const b = y ? pixels[i - stride] : 0;
      const c = y && x >= channels ? pixels[i - stride - channels] : 0;
      if (filter > 4) throw new Error('Invalid PNG filter');
      pixels[i] = raw[y * (stride + 1) + x + 1] + [0, a, b, Math.floor((a + b) / 2), paeth(a, b, c)][filter];
    }
  }
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set(pixels.subarray(i * channels, i * channels + 3), i * 4);
    data[i * 4 + 3] = channels === 4 ? pixels[i * channels + 3] : 255;
  }
  return { width, height, data };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function encodePng({ width, height, data }) {
  const chunk = (name, content) => {
    const body = Buffer.concat([Buffer.from(name), content]);
    const length = Buffer.alloc(4); length.writeUInt32BE(content.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const palette = [
  { id: 'preview-black', name: 'Black', color: '#1c2028' },
  { id: 'preview-blue', name: 'Blue', color: '#244b93' },
  { id: 'preview-red', name: 'Red', color: '#b54235' },
  { id: 'preview-ochre', name: 'Ochre', color: '#c19a45' }
];
const originalPortrait = decodePng(await readFile(path.join(output, 'portrait-source.png')));
function resize(image, width, height) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const sx = Math.min(image.width - 1, (x + 0.5) * image.width / width - 0.5);
    const sy = Math.min(image.height - 1, (y + 0.5) * image.height / height - 0.5);
    const ix = Math.max(0, Math.floor(sx)), iy = Math.max(0, Math.floor(sy));
    const fx = sx - ix, fy = sy - iy;
    for (let channel = 0; channel < 4; channel++) {
      const sample = (xx, yy) => image.data[(yy * image.width + xx) * 4 + channel];
      data[(y * width + x) * 4 + channel] = Math.round(
        sample(ix, iy) * (1 - fx) * (1 - fy) + sample(Math.min(image.width - 1, ix + 1), iy) * fx * (1 - fy) +
        sample(ix, Math.min(image.height - 1, iy + 1)) * (1 - fx) * fy +
        sample(Math.min(image.width - 1, ix + 1), Math.min(image.height - 1, iy + 1)) * fx * fy);
    }
  }
  return { width, height, data };
}
// The host has a 100k-point result budget. This full-frame downsample retains
// the entire portrait and lets the defaults and off-centre example fit it.
const portrait = resize(originalPortrait, 384, 384);
const portraitPng = encodePng(portrait);
await writeFile(path.join(output, 'portrait-input.png'), portraitPng);
const diagnostics = { width: 480, height: 320, data: new Uint8Array(480 * 320 * 4) };
for (let y = 0; y < diagnostics.height; y++) {
  for (let x = 0; x < diagnostics.width; x++) {
    const i = (y * diagnostics.width + x) * 4;
    let rgb = [x / 479 * 255, x / 479 * 255, x / 479 * 255], alpha = 255;
    if (y > 120 && y < 235) rgb = x < 160 ? [165, 32, 28] : x < 320 ? [30, 65, 156] : [199, 148, 33];
    if (y >= 250) { rgb = [15, 15, 15]; alpha = Math.round(x / 479 * 255); }
    // A fully transparent vertical exclusion, including hidden black RGB.
    if (x > 225 && x < 255) alpha = 0;
    diagnostics.data.set([...rgb.map(Math.round), alpha], i);
  }
}
const diagnosticsPng = encodePng(diagnostics);
await writeFile(path.join(output, 'diagnostics-source.png'), diagnosticsPng);

const stats = [];
function svgFor(result, strokeWidth = 0.62) {
  const item = result.items ? result.items.find(item => item.kind === 'vector') : result;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${item.width}" height="${item.height}" viewBox="0 0 ${item.width} ${item.height}"><rect width="100%" height="100%" fill="white"/><g fill="none" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${item.paths.map(line => `<path stroke="${line.color || '#000000'}" d="${line.points.map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(3)},${point.y.toFixed(3)}`).join(' ')}${line.closed ? 'Z' : ''}"/>`).join('')}</g></svg>`;
}
async function render(name, image, overrides = {}) {
  const parameters = { ...defaults, ...overrides };
  const progress = [];
  let result;
  try {
    result = await run({ kind: 'bitmap', width: image.width, height: image.height, widthPx: image.width, heightPx: image.height, data: image.data, palette }, parameters, {
      seed: 1, runId: name, signal: new AbortController().signal, progress: value => progress.push(value)
    });
  } catch (error) {
    throw new Error(`${name}: ${error.message}`);
  }
  const item = result.items ? result.items.find(item => item.kind === 'vector') : result;
  const svg = svgFor(result);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: image.width * 2 } }).render().asPng();
  await writeFile(path.join(output, `${name}.svg`), svg);
  await writeFile(path.join(output, `${name}.png`), png);
  stats.push({ name, parameters, paths: item.paths.length, points: item.paths.reduce((sum, line) => sum + line.points.length, 0), pens: [...new Set(item.paths.map(line => line.penId).filter(Boolean))], warnings: result.warnings || [], lastProgress: progress.at(-1) });
  return png;
}
const mono = await render('portrait-default', portrait);
const colour = await render('portrait-pens', portrait, { colourMode: 'pens' });
const offcentre = await render('portrait-offcentre', portrait, { centreX: 28, centreY: 38, direction: 'anticlockwise' });
await render('portrait-detail', portrait, { ringSpacing: 3, gamma: 1.3, contrast: 1.2 });
const diagnosticResult = await render('diagnostics-pens', diagnostics, { colourMode: 'pens', ringSpacing: 3.5 });
const diagnosticDisconnected = await render('diagnostics-disconnected', diagnostics, { connected: false, ringSpacing: 8 });

function imageTag(png, x, y, width, height) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="white"/><image x="${x}" y="${y}" width="${width}" height="${height}" href="data:image/png;base64,${png.toString('base64')}"/>`;
}
const panels = [
  ['NASA portrait input', portraitPng, 'Eileen Collins / NASA; full frame downsampled to 384 × 384'],
  ['Spiral Sawtooth · defaults', mono, 'Ring spacing 4 · amplitude 0.9 · detail 1'],
  ['Match my pens', colour, 'Black, blue, red and ochre palette; original RGB samples'],
  ['Off-centre · counterclockwise', offcentre, 'Centre 28% / 38%; full-frame segment clipping']
];
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1160" height="1310" viewBox="0 0 1160 1310"><rect width="100%" height="100%" fill="#edf0f2"/><g font-family="Segoe UI,Arial,sans-serif"><text x="38" y="45" fill="#17212c" font-size="28" font-weight="600">TerraForge · actual Spiral Sawtooth output</text><text x="38" y="74" fill="#4d5c6a" font-size="15">Original source frame retained. Vector previews use a 0.62 source-pixel stroke.</text>${panels.map(([title, png, caption], index) => {
    const x = 24 + (index % 2) * 570, y = 98 + Math.floor(index / 2) * 600;
    return `<rect x="${x}" y="${y}" width="548" height="580" rx="8" fill="white"/><text x="${x + 18}" y="${y + 30}" font-size="20" fill="#17212c" font-weight="600">${title}</text>${imageTag(png, x + 18, y + 45, 512, 512)}<text x="${x + 18}" y="${y + 573}" font-size="11" fill="#4d5c6a">${caption}</text>`;
  }).join('')}</g></svg>`;
await writeFile(path.join(output, 'portrait-examples.png'), new Resvg(sheet).render().asPng());
const diagnosticSheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1040" height="850"><rect width="100%" height="100%" fill="#edf0f2"/><g font-family="Segoe UI,Arial,sans-serif" fill="#17212c"><text x="32" y="42" font-size="26" font-weight="600">Tone, colour and alpha checks</text><text x="32" y="73" font-size="15">A clear vertical strip must remain free of connecting strokes.</text><text x="32" y="108" font-size="18">Original RGBA input (transparent pixels shown over white)</text>${imageTag(diagnosticsPng, 32, 125, 480, 320)}<text x="540" y="108" font-size="18">Connected lines · Match my pens</text>${imageTag(diagnosticResult, 540, 125, 480, 320)}<text x="32" y="484" font-size="18">Disconnected strokes · single colour</text>${imageTag(diagnosticDisconnected, 32, 500, 480, 320)}<text x="540" y="530" font-size="16">Top: continuous luminance gradient</text><text x="540" y="565" font-size="16">Middle: red / blue / ochre RGB bands</text><text x="540" y="600" font-size="16">Bottom: black with increasing alpha</text><text x="540" y="635" font-size="16">Centre strip: fully transparent</text><text x="540" y="700" font-size="14">These images come directly from the plugin’s paths.</text><text x="540" y="725" font-size="14">No source bitmap is placed underneath the vectors.</text></g></svg>`;
await writeFile(path.join(output, 'diagnostics-examples.png'), new Resvg(diagnosticSheet).render().asPng());
await writeFile(path.join(output, 'preview-statistics.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(JSON.stringify(stats.map(({ name, paths, points, pens, warnings }) => ({ name, paths, points, pens, warnings })), null, 2));
