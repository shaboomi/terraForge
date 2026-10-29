/* terraforge-plugin
{
  "id": "terraforge.wave-volume",
  "name": "Wave Volume",
  "description": "Original projected upper/lower wave surfaces with long connecting strands. Camera-facing side strands; transparent wire surfaces. Preview required; dimensions are millimetres.",
  "controls": [
    {
      "key": "width",
      "label": "Artwork width",
      "type": "number",
      "default": 180,
      "min": 20,
      "max": 2000,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "height",
      "label": "Artwork height",
      "type": "number",
      "default": 260,
      "min": 20,
      "max": 2000,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "margin",
      "label": "Margin",
      "type": "number",
      "default": 12,
      "min": 0,
      "max": 200,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "rotation",
      "label": "Artwork orientation",
      "type": "number",
      "default": 0,
      "min": -180,
      "max": 180,
      "step": 1,
      "unit": "°"
    },
    {
      "key": "footprintWidth",
      "label": "Footprint width",
      "type": "number",
      "default": 112,
      "min": 10,
      "max": 500,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "footprintDepth",
      "label": "Footprint depth",
      "type": "number",
      "default": 78,
      "min": 10,
      "max": 500,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "separation",
      "label": "Vertical surface separation",
      "type": "number",
      "default": 105,
      "min": 5,
      "max": 500,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "amplitude",
      "label": "Wave amplitude",
      "type": "number",
      "default": 22,
      "min": 0,
      "max": 100,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "wavelength",
      "label": "Wave wavelength",
      "type": "number",
      "default": 85,
      "min": 10,
      "max": 500,
      "step": 1,
      "unit": "mm"
    },
    {
      "key": "complexity",
      "label": "Surface complexity",
      "type": "number",
      "default": 3,
      "min": 1,
      "max": 6,
      "step": 1
    },
    {
      "key": "phaseDifference",
      "label": "Upper/lower phase difference",
      "type": "number",
      "default": 125,
      "min": -180,
      "max": 180,
      "step": 1,
      "unit": "°"
    },
    {
      "key": "spacing",
      "label": "Strand spacing (also surface grid)",
      "type": "number",
      "default": 1,
      "min": 0.15,
      "max": 10,
      "step": 0.05,
      "unit": "mm"
    },
    {
      "key": "azimuth",
      "label": "Projection azimuth",
      "type": "number",
      "default": 35,
      "min": -180,
      "max": 180,
      "step": 1,
      "unit": "°"
    },
    {
      "key": "elevation",
      "label": "Projection elevation",
      "type": "number",
      "default": 30,
      "min": 5,
      "max": 80,
      "step": 1,
      "unit": "°"
    },
    {
      "key": "upper",
      "label": "Show upper surface",
      "type": "boolean",
      "default": true
    },
    {
      "key": "lower",
      "label": "Show lower surface",
      "type": "boolean",
      "default": true
    },
    {
      "key": "strands",
      "label": "Show connecting strands",
      "type": "boolean",
      "default": true
    },
    {
      "key": "opening",
      "label": "Hollow centre (0 = solid)",
      "type": "number",
      "default": 0,
      "min": 0,
      "max": 65,
      "step": 1,
      "unit": "%"
    },
    {
      "key": "penMode",
      "label": "Pen assignment",
      "type": "select",
      "default": "single",
      "options": [
        {
          "label": "Single pen / colour",
          "value": "single"
        },
        {
          "label": "Upper / lower / connecting strand pens",
          "value": "families"
        }
      ]
    },
    {
      "key": "surfacePenIndex",
      "label": "Lower surface pen position (0 = primary)",
      "type": "number",
      "default": 0,
      "min": 0,
      "max": 256,
      "step": 1
    },
    {
      "key": "strandPenIndex",
      "label": "Connecting strand pen position (0 = primary)",
      "type": "number",
      "default": 0,
      "min": 0,
      "max": 256,
      "step": 1
    },
    {
      "key": "randomSeed",
      "label": "Random seed",
      "type": "number",
      "default": 42,
      "min": 0,
      "max": 2147483647,
      "step": 1
    },
    {
      "key": "variation",
      "label": "Variation strength",
      "type": "number",
      "default": 1,
      "min": 0,
      "max": 2,
      "step": 0.05
    },
    {
      "key": "tolerance",
      "label": "Sampling tolerance (smaller = smoother)",
      "type": "number",
      "default": 0.045,
      "min": 0.005,
      "max": 0.3,
      "step": 0.005,
      "unit": "mm"
    },
    {
      "key": "colour",
      "label": "Stroke colour (pen position 0)",
      "type": "colour",
      "default": "#183d53"
    },
    {
      "key": "penIndex",
      "label": "Primary pen position (0 = stroke colour)",
      "type": "number",
      "default": 0,
      "min": 0,
      "max": 256,
      "step": 1
    },
    {
      "key": "border",
      "label": "Add border",
      "type": "boolean",
      "default": false
    },
    {
      "key": "borderMode",
      "label": "Border placement",
      "type": "select",
      "default": "artwork",
      "options": [
        {
          "label": "Around artwork",
          "value": "artwork"
        },
        {
          "label": "At artwork margin (original)",
          "value": "frame"
        }
      ]
    },
    {
      "key": "borderGap",
      "label": "Border gap from artwork",
      "type": "number",
      "default": 5,
      "min": 0,
      "max": 200,
      "step": 0.5,
      "unit": "mm"
    }
  ],
  "version": "1.0.0",
  "apiVersion": 1,
  "category": "generator",
  "input": "none",
  "outputs": [
    "vector"
  ],
  "previewRequired": true
}
*/
// Original height-field volume with orthographic projection and real strands.
export default async function run(input, p, context) {
  const e = sculptureEnvironment(input, p, context, "Wave Volume", "Increase Strand spacing, reduce Footprint width/depth or Surface complexity, or increase Sampling tolerance.");
  if (!Number.isInteger(p.complexity)) throw new Error("Surface complexity must be an integer.");
  if (!p.upper && !p.lower && !p.strands) throw new Error("Enable an upper surface, lower surface or connecting strands.");
  const tau = Math.PI * 2, phase = e.phases(0, 12), az = p.azimuth * Math.PI / 180, el = p.elevation * Math.PI / 180;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  const halfW = p.footprintWidth / 2, halfD = p.footprintDepth / 2;
  const amplitude = Math.min(p.amplitude, p.separation * 0.6);
  const shift = p.phaseDifference * Math.PI / 180;
  function field(x, y, delta) {
    const kx = tau * x / p.wavelength, ky = tau * y / p.wavelength;
    let sum = 0, weight = 0;
    for (let i = 0; i < p.complexity; i++) {
      const w = 1 / (1 + i * 1.6), f = 1 + i * 0.43;
      sum += w * Math.sin(kx * f * (i % 2 ? -0.56 : 0.92) + ky * f * (i % 2 ? 0.94 : 0.42) + phase[i] + delta * (1 + i * 0.19));
      weight += w;
    }
    return sum / weight;
  }
  function surface(x, y, upper) {
    const common = p.amplitude * 0.4 * field(x * 0.67, y * 0.67, 0);
    // Both fields lie in [-1,1]. Gap >= separation - 1.5*amplitude
    // >= 10% of separation, even at the most extreme phase difference.
    const z = common + (upper ? p.separation / 2 + amplitude * 0.55 * field(x, y, 0)
      : -p.separation / 2 + amplitude * 0.95 * field(x, y, shift));
    return e.transform(ca * x - sa * y, se * (sa * x + ca * y) - ce * z);
  }
  const nx = Math.max(2, Math.ceil(p.footprintWidth / p.spacing)), ny = Math.max(2, Math.ceil(p.footprintDepth / p.spacing));
  const hole = p.opening / 100, hx = halfW * hole, hy = halfD * hole;
  const holeCount = hole ? Math.max(12, Math.ceil(Math.PI * (hx + hy) / p.spacing)) : 0;
  const total = (nx + ny + 2) * (Number(p.upper) + Number(p.lower)) + (p.strands ? nx + ny + 1 + holeCount : 0);
  // A hole may split each surface curve in two.
  e.preflight(total * (hole ? 2 : 1) + (p.border ? 1 : 0));
  const upperInk = e.style(), lowerInk = p.penMode === "families" ? e.style(e.penAt(p.surfacePenIndex, e.penAt(p.penIndex))) : upperInk;
  let done = 0;
  const base = Math.max(16, Math.ceil(Math.max(p.footprintWidth, p.footprintDepth) / p.wavelength * (20 + p.complexity * 8)));
  function spans(fixed, fixedRadius, varyingRadius, halfExtent) {
    if (!hole || Math.abs(fixed) >= fixedRadius) return [[-halfExtent, halfExtent]];
    const edge = varyingRadius * Math.sqrt(1 - (fixed / fixedRadius) ** 2);
    return [[-halfExtent, -edge], [edge, halfExtent]];
  }
  for (const upper of [true, false]) {
    if (upper ? !p.upper : !p.lower) continue;
    const ink = upper ? upperInk : lowerInk;
    for (let i = 0; i <= ny; i++) {
      const y = -halfD + p.footprintDepth * i / ny;
      for (const [a, b] of spans(y, hy, hx, halfW)) e.emit(e.sample(x => surface(x, y, upper), a, b, base), false, ink);
      await e.checkpoint(++done, total);
    }
    for (let i = 0; i <= nx; i++) {
      const x = -halfW + p.footprintWidth * i / nx;
      for (const [a, b] of spans(x, hx, hy, halfD)) e.emit(e.sample(y => surface(x, y, upper), a, b, base), false, ink);
      await e.checkpoint(++done, total);
    }
  }
  if (p.strands) {
    const ink = p.penMode === "families" ? e.style(e.penAt(p.strandPenIndex, e.penAt(p.penIndex))) : upperInk;
    const strand = (x, y) => e.emit([surface(x, y, true), surface(x, y, false)], false, ink);
    // The two camera-facing sides. Exclude one shared corner to avoid a repeated stroke.
    const frontX = sa >= 0 ? halfW : -halfW, frontY = ca >= 0 ? halfD : -halfD;
    for (let i = 0; i <= nx; i++) { strand(-halfW + p.footprintWidth * i / nx, frontY); await e.checkpoint(++done, total); }
    for (let i = 0; i <= ny; i++) {
      const y = -halfD + p.footprintDepth * i / ny;
      if (Math.abs(y - frontY) < 1e-9) continue;
      strand(frontX, y); await e.checkpoint(++done, total);
    }
    for (let i = 0; i < holeCount; i++) {
      const theta = tau * i / holeCount;
      strand(hx * Math.cos(theta), hy * Math.sin(theta)); await e.checkpoint(++done, total);
    }
  }
  return e.finish();
}

// Bundled into each plugin: no imports or host-specific APIs at runtime.
function sculptureEnvironment(input, p, context, name, reduction) {
  const { width, height, margin, tolerance, rotation } = p;
  if (!Number.isInteger(p.randomSeed)) throw new Error("Random seed must be an integer.");
  if (margin * 2 >= Math.min(width, height)) throw new Error("Reduce Margin: it must leave a positive artwork area.");
  if (input.kind !== "none") throw new Error(name + " needs no selected source input.");
  if (width > input.page.widthMM || height > input.page.heightMM) {
    throw new Error("Artwork exceeds the current page. Reduce Artwork width/height or choose a larger page.");
  }
  const limits = context.limits || { paths: 10000, points: 100000, executionMs: 30000 };
  const started = Date.now(), paths = [], seen = new Set();
  let points = 0, evaluations = 0, lastProgress = -1, checkpoints = 0;
  const message = name + " exceeds the artwork capacity. " + reduction + " Or choose Extended 6× in Properties. No partial artwork was returned.";
  const check = () => {
    if (context.signal.aborted) throw new Error(name + " cancelled.");
    if (Date.now() - started > Math.max(1, limits.executionMs * 0.85)) throw new Error(name + " reached its calculation time budget. " + reduction);
  };
  check();
  context.progress(0);
  const angle = rotation * Math.PI / 180, ca = Math.cos(angle), sa = Math.sin(angle);
  const transform = (x, y) => ({ x: width / 2 + x * ca - y * sa, y: height / 2 + x * sa + y * ca });
  const equal = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-8;
  const palette = input.palette || [];
  // API-1 pen controls are mandatory. Optional assignments therefore use
  // positions in the supplied palette (0 = fallback), never invented IDs.
  function penAt(index, fallback = "") {
    if (!Number.isInteger(index) || index < 0) throw new Error("Pen position must be a non-negative integer.");
    if (index === 0) return fallback;
    const pen = palette[index - 1];
    if (!pen) throw new Error("Selected pen position is unavailable. Check the configured Pens list, or use 0 for the primary colour/fallback.");
    return pen.id;
  }
  function style(id = penAt(p.penIndex)) {
    if (!id) return { color: p.colour };
    const pen = palette.find(value => value.id === id);
    if (!pen) throw new Error("The selected pen is unavailable. Choose a configured pen in Properties.");
    return { color: pen.color, penId: pen.id };
  }
  // Stable independent streams: curve counts, sampling and colours never consume randomness.
  function randomStream(component) {
    let state = (p.randomSeed ^ Math.imul(component + 1, 0x9e3779b9)) >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let v = Math.imul(state ^ (state >>> 15), state | 1);
      v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
      return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
    };
  }
  function phases(component, count = 8) {
    const random = randomStream(component);
    return Array.from({ length: count }, () => (random() - 0.5) * Math.PI * 2 * p.variation);
  }
  // Liang–Barsky clipping of segments, never projection of outside vertices onto edges.
  function clip(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    let low = 0, high = 1;
    for (const [v, q] of [[-dx, a.x - margin], [dx, width - margin - a.x], [-dy, a.y - margin], [dy, height - margin - a.y]]) {
      if (Math.abs(v) < 1e-14) { if (q < 0) return null; }
      else {
        const t = q / v;
        if (v < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low >= high) return null;
      }
    }
    const at = t => ({ x: a.x + dx * t, y: a.y + dy * t });
    // Snap only roundoff at an analytically calculated intersection.
    const snap = (v, min, max) => Math.abs(v - min) < 1e-8 ? min : Math.abs(v - max) < 1e-8 ? max : v;
    const clean = v => ({ x: snap(v.x, margin, width - margin), y: snap(v.y, margin, height - margin) });
    return { a: clean(at(low)), b: clean(at(high)), low, high };
  }
  function push(vertices, closed, ink) {
    if (vertices.length < (closed ? 3 : 2)) return;
    // Degenerate parameter combinations can project separate components onto
    // exactly the same stroke. Suppress repeated same-ink strokes, including
    // reversed paths and a different starting vertex on a closed contour.
    const keys = vertices.map(v => v.x.toFixed(8) + "," + v.y.toFixed(8));
    let start = 0;
    if (closed) for (let i = 1; i < keys.length; i++) if (keys[i] < keys[start]) start = i;
    const forward = closed ? keys.slice(start).concat(keys.slice(0, start)) : keys;
    const reverse = closed ? [forward[0], ...forward.slice(1).reverse()] : [...forward].reverse();
    const a = forward.join(";"), b = reverse.join(";");
    const signature = (ink.penId || "") + "|" + ink.color.toLowerCase() + "|" + Number(closed) + "|" + (a < b ? a : b);
    if (seen.has(signature)) return;
    if (paths.length >= limits.paths || points + vertices.length > limits.points) throw new Error(message);
    seen.add(signature);
    paths.push({ points: vertices, closed, ...ink }); points += vertices.length;
  }
  function emit(vertices, closed, ink) {
    if (closed && equal(vertices[0], vertices[vertices.length - 1])) vertices.pop();
    const inside = a => a.x >= margin && a.x <= width - margin && a.y >= margin && a.y <= height - margin;
    if (vertices.every(inside)) { push(vertices, closed, ink); return; }
    const fragments = [];
    let current = null;
    for (let i = 0; i < vertices.length - (closed ? 0 : 1); i++) {
      const segment = clip(vertices[i], vertices[(i + 1) % vertices.length]);
      if (!segment) { current = null; continue; }
      if (!current || segment.low > 0 || !equal(current[current.length - 1], segment.a)) {
        current = [segment.a]; fragments.push(current);
      }
      if (!equal(current[current.length - 1], segment.b)) current.push(segment.b);
      if (segment.high < 1) current = null;
    }
    // A clipped closed curve may straddle its parameter seam. Join that same
    // curve's adjacent fragments only; never bridge across an excluded interval.
    if (closed && fragments.length > 1 && equal(fragments[fragments.length - 1].at(-1), fragments[0][0])) {
      fragments[0] = fragments.pop().concat(fragments[0].slice(1));
    }
    for (const fragment of fragments) push(fragment, false, ink);
  }
  function sample(fn, from, to, base = 16) {
    const evaluate = t => {
      if (++evaluations % 512 === 0) check();
      if (evaluations > limits.points * 100) throw new Error(message);
      const point = fn(t);
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(name + " produced invalid geometry. Reduce deformation.");
      return point;
    };
    const result = [evaluate(from)];
    const distance = (pnt, a, b) => {
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((pnt.x - a.x) * dx + (pnt.y - a.y) * dy) / length)) : 0;
      return Math.hypot(pnt.x - a.x - t * dx, pnt.y - a.y - t * dy);
    };
    function interval(a, b, pa, pb, depth) {
      const q1 = evaluate(a + (b - a) / 4), mid = evaluate((a + b) / 2), q3 = evaluate(a + (b - a) * 3 / 4);
      const error = Math.max(distance(q1, pa, pb), distance(mid, pa, pb), distance(q3, pa, pb));
      if (error > tolerance || Math.hypot(pb.x - pa.x, pb.y - pa.y) > 5) {
        if (depth >= 18) throw new Error("Curve sampling could not reach the requested tolerance. Reduce deformation or increase Sampling tolerance.");
        interval(a, (a + b) / 2, pa, mid, depth + 1);
        interval((a + b) / 2, b, mid, pb, depth + 1);
      } else {
        if (result.length >= limits.points) throw new Error(message);
        if (!equal(result.at(-1), pb)) result.push(pb);
      }
    }
    for (let i = 0; i < base; i++) {
      const a = from + (to - from) * i / base, b = from + (to - from) * (i + 1) / base;
      interval(a, b, result.at(-1), evaluate(b), 0);
    }
    return result;
  }
  async function checkpoint(done, total) {
    check();
    const progress = Math.min(99, Math.floor(100 * done / Math.max(1, total)));
    if (progress > lastProgress) { context.progress(progress); lastProgress = progress; }
    // Yield to AbortSignal delivery; the host also terminates a cancelled runtime.
    if (++checkpoints % 8 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(); }
  }
  function preflight(count) { if (!Number.isFinite(count) || count > limits.paths) throw new Error(message); }
  function finish() {
    check();
    if (!paths.length) throw new Error("No visible paths. Reduce Margin/rotation/deformation, or enable a line family.");
    if (p.border) {
      let left = margin, top = margin, right = width - margin, bottom = height - margin;
      if (p.borderMode === "artwork") {
        const gap = p.borderGap;
        if (!Number.isFinite(gap) || gap < 0) throw new Error("Border gap must be a non-negative distance in millimetres.");
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        // Measure the final visible path centre-lines, after rotation and
        // clipping. Changing the border never scales or moves the artwork.
        for (const path of paths) for (const point of path.points) {
          minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
          maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
        }
        const available = Math.min(minX, minY, width - maxX, height - maxY);
        if (gap > available + 1e-8) throw new Error("Border gap does not fit inside the artwork frame. Use a gap of at most " + Math.max(0, Math.floor(available * 100) / 100) + " mm, or increase Margin to leave more room. The artwork was not resized and no partial result was returned.");
        const edge = (value, maximum) => Math.abs(value) < 1e-8 ? 0 : Math.abs(value - maximum) < 1e-8 ? maximum : value;
        left = edge(minX - gap, width); right = edge(maxX + gap, width);
        top = edge(minY - gap, height); bottom = edge(maxY + gap, height);
      }
      check();
      push([{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }], true, style());
    }
    context.progress(100);
    return { width, height, paths };
  }
  return { transform, phases, style, penAt, palette, sample, emit, checkpoint, preflight, finish, check };
}
