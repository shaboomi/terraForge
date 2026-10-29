/* terraforge-plugin
{
  "id": "terraforge.comic-ink-vectorizer",
  "name": "Comic Ink Vectorizer",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Local comic-inspired colour separations, bold ink, deep shadows and directional hatching as editable, plot-ready strokes. Colours do not assign pens.",
  "category": "bitmap-processor",
  "input": "bitmap",
  "outputs": ["vector"],
  "bitmapPreparation": true,
  "controls": [
    { "key": "preset", "label": "Style preset", "type": "select", "default": "clean", "options": [{"label":"Clean Comic","value":"clean"},{"label":"Heavy Ink","value":"heavy"},{"label":"Fine Hatching","value":"fine"}] },
    { "key": "paletteSize", "label": "Palette size", "type": "number", "default": 5, "min": 2, "max": 8, "step": 1 },
    { "key": "paletteMode", "label": "Colour palette", "type": "select", "default": "auto", "options": [{"label":"Automatic colours (unassigned)","value":"auto"},{"label":"Shared preparation palette (unassigned)","value":"shared"},{"label":"My pen colours (unassigned)","value":"pens"}] },
    { "key": "simplification", "label": "Colour simplification", "type": "slider", "default": 45, "min": 0, "max": 100, "step": 1 },
    { "key": "resolution", "label": "Processing long edge", "type": "number", "default": 160, "min": 32, "max": 512, "step": 16, "unit": "px" },
    { "key": "outline", "label": "Outline strength", "type": "slider", "default": 1, "min": 0, "max": 3, "step": 0.25, "unit": "working px" },
    { "key": "shadow", "label": "Shadow brightness threshold", "type": "slider", "default": 58, "min": 0, "max": 180, "step": 1 },
    { "key": "density", "label": "Artistic hatch darkness", "type": "slider", "default": 50, "min": 0, "max": 100, "step": 1 },
    { "key": "hatchSpacing", "label": "Artistic hatch spacing", "type": "number", "default": 4, "min": 2, "max": 16, "step": 0.5, "unit": "working px" },
    { "key": "direction", "label": "Hatch direction", "type": "select", "default": "directional", "options": [{"label":"Smoothed image direction","value":"directional"},{"label":"Fixed angle","value":"fixed"}] },
    { "key": "angle", "label": "Hatch angle / fallback", "type": "number", "default": 45, "min": 0, "max": 179, "step": 1, "unit": "degrees" },
    { "key": "crosshatch", "label": "Crosshatch darker midtones", "type": "boolean", "default": false },
    { "key": "minFeature", "label": "Minimum colour / shadow region", "type": "number", "default": 6, "min": 1, "max": 100, "step": 1, "unit": "working px area" },
    { "key": "pathTolerance", "label": "Path simplification", "type": "slider", "default": 0.25, "min": 0, "max": 1, "step": 0.05, "unit": "working px" },
    { "key": "background", "label": "Background handling", "type": "select", "default": "skip-white", "options": [{"label":"Preserve transparency; omit near-white","value":"skip-white"},{"label":"Preserve transparency; draw white","value":"keep-white"},{"label":"Composite transparency on white; draw white","value":"white"}] },
    { "key": "output", "label": "Output mode", "type": "select", "default": "colour", "options": [{"label":"Plot-ready colour and ink","value":"colour"},{"label":"Black ink only","value":"ink"}] },
    { "key": "fillSpacing", "label": "Colour coverage spacing", "type": "number", "default": 0.85, "min": 0.35, "max": 4, "step": 0.05, "unit": "working px" },
    { "key": "blackSpacing", "label": "Dense black coverage spacing", "type": "number", "default": 0.45, "min": 0.25, "max": 2, "step": 0.05, "unit": "working px" },
    { "key": "inkPen", "label": "Assign black ink to real pen (optional)", "type": "pen", "default": "", "suggestedColor": "#000000" }
  ]
}
*/

// Self-contained API-1 module. All geometry is local to the full source frame.
export default async function run(input, p, context) {
  if (input.kind !== "bitmap" || input.prepared?.version !== 1) {
    throw new Error("Comic Ink Vectorizer needs a TerraForge build with shared bitmap preparation. Update TerraForge, then Preview again.");
  }
  const started = Date.now(), deadline = (context.limits?.executionMs || 30000) * 0.9;
  const check = () => {
    if (context.signal.aborted) throw new Error("Comic Ink Vectorizer cancelled.");
    if (Date.now() - started > deadline) throw new Error("Comic Ink Vectorizer reached its time allowance. Lower Processing long edge or select Extended artwork capacity.");
  };
  const stage = async percent => { check(); context.progress(percent); await new Promise(resolve => setTimeout(resolve, 0)); check(); };
  await stage(0);
  const factor = Math.min(1, p.resolution / Math.max(input.widthPx, input.heightPx));
  const w = Math.max(1, Math.round(input.widthPx * factor)), h = Math.max(1, Math.round(input.heightPx * factor)), n = w * h;
  const rgb = new Float32Array(n * 3), tone = new Float32Array(n), active = new Uint8Array(n);
  const settings = input.prepared.settings;
  const pens = input.palette || [], paletteSize = Math.floor(p.paletteSize);
  const adjust = value => Math.max(0, Math.min(255, (Math.pow(Math.max(0, Math.min(1,
    (value - settings.blackPoint) / (settings.whitePoint - settings.blackPoint))), 1 / settings.gamma) * 255 - 127.5) * settings.contrast + 127.5));
  // Area sampling retains the complete frame. Conservative alpha rejection keeps
  // even a one-source-pixel transparent slit open at reduced resolution.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let count = 0, alpha = 0, transparent = false, t = 0;
      const sums = [0, 0, 0], i = y * w + x;
      const x0 = Math.floor(x * input.widthPx / w), x1 = Math.floor((x + 1) * input.widthPx / w);
      const y0 = Math.floor(y * input.heightPx / h), y1 = Math.floor((y + 1) * input.heightPx / h);
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const source = sy * input.widthPx + sx, a = input.data[source * 4 + 3] / 255;
        transparent ||= a === 0; alpha += a; count++; t += input.prepared.tones[source];
        for (let c = 0; c < 3; c++) sums[c] += adjust(input.data[source * 4 + c]) * a + 255 * (1 - a);
        if ((count & 65535) === 0) check();
      }
      tone[i] = t / count;
      for (let c = 0; c < 3; c++) rgb[i * 3 + c] = sums[c] / count;
      active[i] = (p.background === "white" || (!transparent && alpha > 0)) &&
        !(p.background === "skip-white" && Math.min(...sums) / count >= 246) ? 1 : 0;
    }
    if (y % 32 === 0) await stage(12 * y / h);
  }
  await stage(12);
  // Bilateral colour smoothing retains strong boundaries; preparation provides
  // the host-adjusted, optionally smoothed brightness for independent shading.
  const smooth = new Float32Array(rgb.length), range = 18 + p.simplification * 0.8;
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!active[i]) continue;
        let weight = 0; const sum = [0, 0, 0];
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy, j = yy * w + xx;
          if (xx < 0 || xx >= w || yy < 0 || yy >= h || !active[j]) continue;
          const d = [0, 1, 2].reduce((v, c) => v + (rgb[i * 3 + c] - rgb[j * 3 + c]) ** 2, 0);
          const a = Math.exp(-d / (2 * range * range)) / (1 + dx * dx + dy * dy);
          weight += a; for (let c = 0; c < 3; c++) sum[c] += rgb[j * 3 + c] * a;
        }
        for (let c = 0; c < 3; c++) smooth[i * 3 + c] = sum[c] / weight;
      }
      if (y % 32 === 0) { check(); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
    rgb.set(smooth);
  }
  await stage(23);
  const distance = (a, b) => 0.3 * (a[0] - b[0]) ** 2 + 0.59 * (a[1] - b[1]) ** 2 + 0.11 * (a[2] - b[2]) ** 2;
  const hex = c => "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join("");
  const unhex = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  let colours;
  if (p.paletteMode !== "auto") {
    const candidates = p.paletteMode === "pens" ? pens.map(pen => pen.color) : settings.palette;
    if (!candidates.length) throw new Error(p.paletteMode === "pens" ? "Add real pens in Pens, or use Automatic colours." : "Add colours to the shared preparation palette, or use Automatic colours.");
    if (candidates.length > paletteSize) throw new Error("The chosen palette has more colours than Palette size. Increase Palette size (maximum 8) or select fewer palette colours.");
    colours = [...new Set(candidates.map(c => c.toLowerCase()))].map(unhex);
  } else {
    // Bounded 5-bit histogram, deterministic farthest-first centres, then weighted
    // Lloyd refinement. No random sampling, seed-dependent ordering or uploads.
    const histogram = new Map();
    for (let i = 0; i < n; i++) if (active[i]) {
      const c = Array.from(rgb.subarray(i * 3, i * 3 + 3)), key = (c[0] >> 3) * 1024 + (c[1] >> 3) * 32 + (c[2] >> 3);
      const entry = histogram.get(key) || { sum: [0, 0, 0], count: 0 };
      entry.count++; for (let k = 0; k < 3; k++) entry.sum[k] += c[k]; histogram.set(key, entry);
    }
    const samples = [...histogram.values()].map(e => ({ c: e.sum.map(v => v / e.count), count: e.count }));
    if (!samples.length) throw new Error("No visible artwork remains. Use Draw white for a white image, or check the source transparency and preparation levels.");
    samples.sort((a, b) => b.count - a.count || (hex(a.c) < hex(b.c) ? -1 : hex(a.c) > hex(b.c) ? 1 : 0));
    colours = [samples[0].c];
    while (colours.length < paletteSize && colours.length < samples.length) {
      let best = -1, selected;
      for (const sample of samples) {
        const score = Math.min(...colours.map(c => distance(c, sample.c))) * Math.sqrt(sample.count);
        if (score > best) { best = score; selected = sample.c; }
      }
      if (best < 1) break;
      colours.push(selected);
    }
    for (let pass = 0; pass < 6; pass++) {
      const sums = colours.map(() => [0, 0, 0, 0]);
      for (const sample of samples) {
        let best = 0;
        for (let c = 1; c < colours.length; c++) if (distance(sample.c, colours[c]) < distance(sample.c, colours[best])) best = c;
        for (let k = 0; k < 3; k++) sums[best][k] += sample.c[k] * sample.count;
        sums[best][3] += sample.count;
      }
      colours = colours.map((c, i) => sums[i][3] ? sums[i].slice(0, 3).map(v => v / sums[i][3]) : c);
      check();
    }
  }
  const labels = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (active[i]) {
    let best = 0; const c = rgb.subarray(i * 3, i * 3 + 3);
    for (let k = 1; k < colours.length; k++) if (distance(c, colours[k]) < distance(c, colours[best])) best = k;
    labels[i] = best;
  }
  // Merge similar neighbouring labels simultaneously, then remove small
  // connected colour islands. Excluded background and holes are never merged.
  for (let pass = 0; pass < 2; pass++) {
    const next = new Int16Array(labels);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, a = labels[i]; if (a < 0) continue;
      const votes = new Uint8Array(colours.length);
      for (const j of [i - 1, i + 1, i - w, i + w]) if (labels[j] >= 0) votes[labels[j]]++;
      for (let c = 0; c < colours.length; c++) if (votes[c] >= 3 && distance(colours[a], colours[c]) < (p.simplification * 1.3) ** 2) next[i] = c;
    }
    labels.set(next); check();
  }
  const neighbours = i => [i % w ? i - 1 : -1, i % w < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
  const cleanRegions = async (plane, minimum, colourRegions) => {
    const seen = new Uint8Array(n), queue = new Int32Array(n), changes = [];
    for (let start = 0; start < n; start++) {
      if (seen[start] || plane[start] < 0 || (!colourRegions && !plane[start])) continue;
      const value = plane[start]; let head = 0, tail = 1; queue[0] = start; seen[start] = 1;
      const votes = new Map();
      while (head < tail) {
        const i = queue[head++];
        for (const j of neighbours(i)) if (j >= 0) {
          if (plane[j] === value && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
          else if (plane[j] >= 0 && plane[j] !== value) votes.set(plane[j], (votes.get(plane[j]) || 0) + 1);
        }
        if ((head & 8191) === 0) { check(); await new Promise(resolve => setTimeout(resolve, 0)); }
      }
      if (tail < minimum) {
        let replacement = colourRegions ? value : 0, best = 0;
        if (colourRegions) for (const [label, count] of votes) if (count > best) { replacement = label; best = count; }
        for (let k = 0; k < tail; k++) changes.push([queue[k], replacement]);
      }
      if ((start & 4095) === 0) check();
    }
    for (const [i, replacement] of changes) plane[i] = replacement;
  };
  await cleanRegions(labels, p.minFeature, true);
  await stage(38);
  const heavy = p.preset === "heavy", fine = p.preset === "fine";
  const shadowThreshold = p.shadow === 0 ? 0 : Math.min(220, p.shadow + (heavy ? 24 : 0));
  const shadows = new Uint8Array(n), outlines = new Uint8Array(n), edges = new Uint8Array(n);
  const threshold = 46 + p.simplification * 0.35;
  const brightness = (x, y) => tone[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const tensorX = new Float32Array(n), tensorY = new Float32Array(n), energy = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!active[i]) continue;
    const gx = (brightness(x + 1, y) - brightness(x - 1, y)) / 2, gy = (brightness(x, y + 1) - brightness(x, y - 1)) / 2;
    tensorX[i] = gx * gx - gy * gy; tensorY[i] = 2 * gx * gy; energy[i] = gx * gx + gy * gy;
    shadows[i] = tone[i] < shadowThreshold ? 1 : 0;
    if (p.outline > 0) {
      const ns = neighbours(i);
      const exterior = ns.some(j => j < 0 || !active[j]);
      // Shared colour borders are emitted once as a mask, never twice per colour.
      const interior = ns.some(j => j >= 0 && active[j] && labels[j] !== labels[i] && distance(colours[labels[i]], colours[labels[j]]) > threshold * threshold);
      const strong = Math.hypot(gx, gy) > threshold;
      edges[i] = exterior || interior || strong ? 1 : 0;
    }
  }
  await cleanRegions(shadows, p.minFeature, false);
  const radius = p.outline > 0 ? Math.max(0, Math.round(p.outline * (heavy ? 1.5 : 1) - 1)) : 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edges[y * w + x]) {
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && xx < w && yy >= 0 && yy < h && active[yy * w + xx]) outlines[yy * w + xx] = 1;
    }
  }
  await stage(48);
  // Double-angle structure tensor smoothing avoids the +/-180 degree seam.
  // Tangents approximate image flow, not physical surface geometry.
  const field = new Float32Array(n), fallback = p.angle * Math.PI / 180;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let tx = 0, ty = 0, en = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) continue;
        const j = yy * w + xx; tx += tensorX[j]; ty += tensorY[j]; en += energy[j];
      }
      field[y * w + x] = p.direction === "directional" && en > 36 && Math.hypot(tx, ty) / en > 0.22 ? Math.atan2(ty, tx) / 2 + Math.PI / 2 : fallback;
    }
    if (y % 32 === 0) { check(); await new Promise(resolve => setTimeout(resolve, 0)); }
  }
  await stage(57);
  let pathCount = 0, pointCount = 0;
  const items = [], pathLimit = context.limits?.paths || 10000, pointLimit = context.limits?.points || 100000;
  const inkPen = p.inkPen ? pens.find(pen => pen.id === p.inkPen) : undefined;
  if (p.inkPen && !inkPen) throw new Error("The saved black ink pen is unavailable. Choose a real pen again or clear its assignment.");
  const makeItem = (name, color, black = false) => ({ kind: "vector", name, width: input.width, height: input.height, paths: [], color,
    ...(black && inkPen ? { penId: inkPen.id } : {}) });
  // Exact pixel-cell traversal splits EVERY line at holes and exclusions. It is
  // also used when simplifying a curved hatch so a shortcut cannot cross a hole.
  const clip = (a, b, eligible) => {
    const dx = b.x - a.x, dy = b.y - a.y, cuts = [0, 1];
    if (dx) for (let x = Math.floor(Math.min(a.x, b.x)) + 1; x < Math.max(a.x, b.x); x++) cuts.push((x - a.x) / dx);
    if (dy) for (let y = Math.floor(Math.min(a.y, b.y)) + 1; y < Math.max(a.y, b.y); y++) cuts.push((y - a.y) / dy);
    cuts.sort((a, b) => a - b);
    const spans = []; let start = null, end = 0;
    for (let k = 1; k < cuts.length; k++) {
      const t0 = cuts[k - 1], t1 = cuts[k]; if (t1 - t0 < 1e-10) continue;
      const t = (t0 + t1) / 2, x = a.x + dx * t, y = a.y + dy * t;
      const ok = x >= 0 && x < w && y >= 0 && y < h && eligible(Math.floor(y) * w + Math.floor(x));
      if (ok) { if (start === null) start = t0; end = t1; }
      else if (start !== null) { spans.push([start, end]); start = null; }
    }
    if (start !== null) spans.push([start, end]);
    return spans.map(([t0, t1]) => [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }]);
  };
  const emit = (item, points) => {
    if (points.length < 2 || points.every(pt => Math.hypot(pt.x - points[0].x, pt.y - points[0].y) < 1e-7)) return;
    pathCount++; pointCount += points.length;
    if (pathCount > pathLimit || pointCount > pointLimit) throw new Error("The complete comic exceeds artwork capacity. Lower Processing long edge, increase coverage / hatch spacing, reduce Outline strength, or select Extended artwork capacity. No partial artwork was returned.");
    item.paths.push({ points: points.map(pt => ({ x: Math.max(0, Math.min(input.width, pt.x * input.width / w)), y: Math.max(0, Math.min(input.height, pt.y * input.height / h)) })), color: item.color });
  };
  const coverage = async (item, spacing, eligible) => {
    // Straight horizontal runs have no redundant collinear vertices. Separated
    // masks prevent outline/shadow double drawing and keep white holes unfilled.
    for (let y = Math.min(spacing / 2, h / 2); y < h; y += spacing) {
      const a = { x: 0, y }, b = { x: w, y };
      for (const span of clip(a, b, eligible)) emit(item, span);
      if (Math.floor(y / spacing) % 32 === 0) { check(); await new Promise(resolve => setTimeout(resolve, 0)); }
    }
  };
  if (p.output === "colour") for (let c = 0; c < colours.length; c++) {
    const color = hex(colours[c]), item = makeItem(`Colour ${c + 1} ${color}`, color);
    await coverage(item, p.fillSpacing, i => labels[i] === c && !outlines[i] && !shadows[i]);
    if (item.paths.length) items.push(item);
  }
  await stage(70);
  const outlineItem = makeItem("Black outlines", "#000000", true), shadowItem = makeItem("Black shadows", "#000000", true);
  await coverage(outlineItem, p.blackSpacing, i => !!outlines[i]);
  await coverage(shadowItem, p.blackSpacing, i => !!shadows[i] && !outlines[i]);
  if (outlineItem.paths.length) items.push(outlineItem);
  if (shadowItem.paths.length) items.push(shadowItem);
  await stage(81);
  const hatchItem = makeItem("Black hatching", "#000000", true);
  const density = Math.min(100, p.density * (heavy ? 1.2 : 1)), spacing = p.hatchSpacing * (fine ? 0.7 : 1);
  const hatchLimit = 100 + density * 1.25;
  const eligible = (i, cross) => !!active[i] && !outlines[i] && !shadows[i] && tone[i] < (cross ? Math.min(145, hatchLimit) : hatchLimit);
  const at = pt => pt.x >= 0 && pt.x < w && pt.y >= 0 && pt.y < h ? Math.floor(pt.y) * w + Math.floor(pt.x) : -1;
  // Bounded short streamlines, seeded on a regular lattice. Occupancy prevents
  // neighbouring seeds from drawing the same line. Crosshatching is a separate
  // orthogonal pass in darker midtones; its crossings are intentional.
  if (density > 0) for (let pass = 0; pass < (p.crosshatch ? 2 : 1); pass++) {
    const occupied = new Uint8Array(n), cross = pass === 1;
    for (let y = spacing / 2; y < h; y += spacing) {
      for (let x = spacing / 2; x < w; x += spacing) {
        const origin = { x, y }, index = at(origin);
        if (!eligible(index, cross) || occupied[index]) continue;
        const arms = [];
        for (const sign of [-1, 1]) {
          let pt = origin, previous = (field[index] + (cross ? Math.PI / 2 : 0)); const arm = [];
          for (let k = 0; k < (fine ? 18 : 12); k++) {
            const i = at(pt); if (i < 0) break;
            let angle = field[i] + (cross ? Math.PI / 2 : 0);
            while (angle - previous > Math.PI / 2) angle -= Math.PI;
            while (angle - previous < -Math.PI / 2) angle += Math.PI;
            angle = previous * 0.7 + angle * 0.3;
            const next = { x: pt.x + Math.cos(angle) * 0.65 * sign, y: pt.y + Math.sin(angle) * 0.65 * sign }, j = at(next);
            if (j < 0 || !eligible(j, cross) || (occupied[j] && j !== index)) break;
            const spans = clip(pt, next, i => eligible(i, cross));
            if (spans.length !== 1 || Math.hypot(spans[0][1].x - next.x, spans[0][1].y - next.y) > 1e-6 || Math.hypot(spans[0][0].x - pt.x, spans[0][0].y - pt.y) > 1e-6) break;
            arm.push(next); pt = next; previous = angle;
          }
          arms.push(arm);
        }
        const points = [...arms[0].reverse(), origin, ...arms[1]];
        if (points.length < 3) continue;
        // Greedy chord simplification, bounded deviation and exact mask check.
        const simplified = [points[0]]; let anchor = 0;
        while (anchor < points.length - 1) {
          let end = anchor + 1;
          for (let candidate = end + 1; candidate < points.length; candidate++) {
            const a = points[anchor], b = points[candidate], dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
            const deviation = points.slice(anchor + 1, candidate).some(pt => Math.abs(dy * pt.x - dx * pt.y + b.x * a.y - b.y * a.x) / (length || 1) > p.pathTolerance);
            const spans = clip(a, b, i => eligible(i, cross));
            if (deviation || spans.length !== 1 || Math.hypot(spans[0][0].x - a.x, spans[0][0].y - a.y) > 1e-6 || Math.hypot(spans[0][1].x - b.x, spans[0][1].y - b.y) > 1e-6) break;
            end = candidate;
          }
          simplified.push(points[end]); anchor = end;
        }
        emit(hatchItem, simplified);
        for (const pt of points) {
          const i = at(pt); if (i >= 0) { occupied[i] = 1; for (const j of neighbours(i)) if (j >= 0) occupied[j] = 1; }
        }
      }
      check(); await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
  if (hatchItem.paths.length) items.push(hatchItem);
  if (!items.length) throw new Error("No drawable marks remain. Use colour output, raise Shadow brightness threshold / Artistic hatch darkness, or choose Draw white for a white source.");
  // The API accepts geometry, not item-level display colours.
  for (const item of items) delete item.color;
  const warnings = [
    `Working grid ${w} × ${h}. Coverage uses drawable strokes; physical pen width and artwork scale determine how solid it looks. Assign colour separations to real pens before plotting.`,
    "Directional hatching approximates image flow, not true surface geometry or a professional illustrator's interpretation. Empty separations are omitted."
  ];
  if (input.prepared.channels.length && p.paletteMode !== "shared") warnings.push("Shared separation channels are not recombined: this plugin separates adjusted RGB independently and uses prepared brightness for ink. Palette mode can reuse the shared palette colours.");
  await stage(100);
  return { items, warnings };
}
