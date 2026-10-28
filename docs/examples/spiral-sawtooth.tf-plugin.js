/* terraforge-plugin
{
  "id": "terraforge.spiral-sawtooth",
  "name": "Spiral Sawtooth",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Turn a bitmap into an angular, tone-responsive Archimedean spiral. Detail controls sampling, not plotter speed. Transparent pixels stay empty.",
  "category": "bitmap-processor",
  "input": "bitmap",
  "outputs": ["vector"],
  "controls": [
    { "key": "ringSpacing", "label": "Ring spacing (source pixels)", "type": "number", "default": 4, "min": 0.5, "max": 128, "step": 0.5, "unit": "px" },
    { "key": "amplitude", "label": "Sawtooth amplitude (× ring spacing)", "type": "number", "default": 0.9, "min": 0, "max": 2, "step": 0.05 },
    { "key": "detail", "label": "Tooth frequency / detail", "type": "number", "default": 1, "min": 0.25, "max": 4, "step": 0.25 },
    { "key": "centreX", "label": "Spiral centre X", "type": "number", "default": 50, "min": 0, "max": 100, "step": 1, "unit": "%" },
    { "key": "centreY", "label": "Spiral centre Y", "type": "number", "default": 50, "min": 0, "max": 100, "step": 1, "unit": "%" },
    { "key": "extent", "label": "Extent (100% reaches farthest corner)", "type": "number", "default": 100, "min": 1, "max": 100, "step": 1, "unit": "%" },
    { "key": "direction", "label": "Spiral direction", "type": "select", "default": "clockwise", "options": [
      { "label": "Clockwise", "value": "clockwise" },
      { "label": "Anticlockwise", "value": "anticlockwise" }
    ] },
    { "key": "contrast", "label": "Tonal contrast", "type": "number", "default": 1, "min": 0.1, "max": 3, "step": 0.1 },
    { "key": "gamma", "label": "Tone gamma (>1 darkens)", "type": "number", "default": 1, "min": 0.2, "max": 3, "step": 0.1 },
    { "key": "invert", "label": "Invert tones", "type": "boolean", "default": false },
    { "key": "skipLight", "label": "Skip light areas", "type": "boolean", "default": true },
    { "key": "lightThreshold", "label": "Skip brightness at or above", "type": "number", "default": 95, "min": 1, "max": 100, "step": 1, "unit": "%" },
    { "key": "connected", "label": "Connected lines", "type": "boolean", "default": true },
    { "key": "colourMode", "label": "Output colour", "type": "select", "default": "single", "options": [
      { "label": "Single colour", "value": "single" },
      { "label": "Match my pens", "value": "pens" }
    ] },
    { "key": "colour", "label": "Single stroke colour", "type": "colour", "default": "#000000" }
  ]
}
*/
// Original TerraForge implementation, based on the visual idea of an oscillating
// spiral. No DrawingBotV3 code or runtime dependencies are used.
export default function run(input, parameters, context) {
  const { widthPx: width, heightPx: height, data } = input;
  const p = parameters;
  const spacing = p.ringSpacing;
  const b = spacing / (2 * Math.PI);
  const cx = width * p.centreX / 100;
  const cy = height * p.centreY / 100;
  const direction = p.direction === "clockwise" ? 1 : -1;
  const maxAmplitude = spacing * p.amplitude / 2;
  const radius = Math.hypot(Math.max(cx, width - cx), Math.max(cy, height - cy)) * p.extent / 100;
  // A final half-width lets the last teeth reach the requested outer radius.
  const endTheta = (radius + maxAmplitude) / b;
  const arc = (theta) => b * (theta * Math.hypot(theta, 1) + Math.asinh(theta)) / 2;
  const endArc = arc(endTheta);
  const paths = [];
  const colourCache = new Map();
  const single = { color: p.colour };
  const palette = p.colourMode === "pens" ? (input.palette || []).map((pen) => ({
    color: pen.color, penId: pen.id,
    rgb: [1, 3, 5].map((i) => parseInt(pen.color.slice(i, i + 2), 16))
  })) : [];
  if (p.colourMode === "pens" && !palette.length) {
    throw new Error("Match my pens needs at least one configured pen. Add pens in Pens or choose Single colour.");
  }
  let current = null;
  let pointCount = 0;
  let work = 0;
  let vertices = 0;
  let lastProgress = -1;
  const started = Date.now();
  const limitMessage = "Spiral exceeds the detail budget. Increase Ring spacing or reduce Tooth frequency / detail or Extent. No partial spiral was returned.";
  function checkpoint(s) {
    if (context.signal.aborted) throw new Error("Spiral Sawtooth cancelled.");
    if (Date.now() - started > 25000) throw new Error("Spiral calculation reached its time budget. Increase Ring spacing or reduce detail. No partial spiral was returned.");
    const progress = Math.min(99, Math.floor(s * 100 / endArc));
    if (progress > lastProgress) { context.progress(progress); lastProgress = progress; }
  }
  checkpoint(0);
  // Reject extreme requests before allocating geometry. The actual point/path
  // counts below are authoritative, including all pen and exclusion splits.
  if (endArc * 4 * p.detail / spacing > 1000000) throw new Error(limitMessage);
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  function darkness(rgb) {
    let d = 1 - (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
    if (p.invert) d = 1 - d;
    return clamp01((d - 0.5) * p.contrast + 0.5) ** (1 / p.gamma);
  }
  function pixel(x, y) {
    const offset = (y * width + x) * 4;
    const alpha = data[offset + 3] / 255;
    return [data[offset] * alpha + 255 * (1 - alpha),
      data[offset + 1] * alpha + 255 * (1 - alpha),
      data[offset + 2] * alpha + 255 * (1 - alpha)];
  }
  // Bilinear sampling in pixel-centre coordinates, compositing straight alpha
  // over white before interpolation. Never interpolate unassociated hidden RGB.
  function tone(x, y) {
    if (x < 0 || x > width || y < 0 || y > height) return 0;
    const sx = Math.max(0, Math.min(width - 1, x - 0.5));
    const sy = Math.max(0, Math.min(height - 1, y - 0.5));
    const ix = Math.floor(sx), iy = Math.floor(sy);
    const fx = sx - ix, fy = sy - iy;
    const a = pixel(ix, iy), c = pixel(Math.min(width - 1, ix + 1), iy);
    const d = pixel(ix, Math.min(height - 1, iy + 1));
    const e = pixel(Math.min(width - 1, ix + 1), Math.min(height - 1, iy + 1));
    return darkness(a.map((v, i) => (v * (1 - fx) + c[i] * fx) * (1 - fy) + (d[i] * (1 - fx) + e[i] * fx) * fy));
  }
  function styleAt(x, y) {
    const offset = (y * width + x) * 4;
    // Fully transparent cells are always excluded, even with inversion or with
    // light skipping disabled. Partial alpha contributes as white paper.
    if (data[offset + 3] === 0) return null;
    const rgb = pixel(x, y);
    if (p.skipLight && (1 - darkness(rgb)) * 100 >= p.lightThreshold - 1e-10) return null;
    if (!palette.length) return single;
    const key = rgb.join(",");
    const cached = colourCache.get(key);
    if (cached) return cached;
    let best = palette[0], distance = Infinity;
    for (const pen of palette) {
      // Match the original composited sRGB, independently of tone adjustments.
      const score = (rgb[0] - pen.rgb[0]) ** 2 * 0.2126 +
        (rgb[1] - pen.rgb[1]) ** 2 * 0.7152 + (rgb[2] - pen.rgb[2]) ** 2 * 0.0722;
      if (score < distance) { best = pen; distance = score; }
    }
    // Bounded cache; equal-distance ties retain the supplied palette order.
    if (colourCache.size < 65536) colourCache.set(key, best);
    return best;
  }
  function finish() { current = null; }
  const samePoint = (a, c) => Math.abs(a.x - c.x) < 1e-9 && Math.abs(a.y - c.y) < 1e-9;
  function emit(a, c, style) {
    if (samePoint(a, c)) return;
    if (!current || current.style !== style || !samePoint(current.points[current.points.length - 1], a)) {
      if (paths.length >= 10000 || pointCount + 2 > 100000) throw new Error(limitMessage);
      const path = { points: [a, c], color: style.color, ...(style.penId ? { penId: style.penId } : {}) };
      paths.push(path);
      current = { points: path.points, style };
      pointCount += 2;
      return;
    }
    const pts = current.points;
    const previous = pts[pts.length - 2];
    const last = pts[pts.length - 1];
    const cross = (last.x - previous.x) * (c.y - last.y) - (last.y - previous.y) * (c.x - last.x);
    const dot = (last.x - previous.x) * (c.x - last.x) + (last.y - previous.y) * (c.y - last.y);
    // Drop only collinear subdivisions of this same straight segment. Tooth
    // corners and path breaks survive; no simplification across ignored cells.
    if (Math.abs(cross) < 1e-10 && dot >= 0) pts[pts.length - 1] = c;
    else {
      if (pointCount >= 100000) throw new Error(limitMessage);
      pts.push(c); pointCount++;
    }
  }
  // Liang–Barsky segment clipping. Intersections retain the original segment's
  // slope; outside points are never pushed/clamped onto the rectangle edges.
  function clip(a, c) {
    const dx = c.x - a.x, dy = c.y - a.y;
    let low = 0, high = 1;
    for (const [v, q] of [[-dx, a.x], [dx, width - a.x], [-dy, a.y], [dy, height - a.y]]) {
      if (v === 0) { if (q < 0) return null; }
      else {
        const t = q / v;
        if (v < 0) low = Math.max(low, t); else high = Math.min(high, t);
        if (low >= high) return null;
      }
    }
    const at = (t) => ({ x: a.x + dx * t, y: a.y + dy * t });
    // Roundoff at a computed intersection only, never the original vertices.
    const edge = (v, maximum) => Math.abs(v) < 1e-9 ? 0 : Math.abs(v - maximum) < 1e-9 ? maximum : v;
    const start = at(low), end = at(high);
    return { a: { x: edge(start.x, width), y: edge(start.y, height) },
      c: { x: edge(end.x, width), y: edge(end.y, height) }, low, high };
  }
  function segment(a, c, s) {
    const clipped = clip(a, c);
    if (!clipped) { finish(); return; }
    if (clipped.low > 0) finish();
    const start = clipped.a, end = clipped.c;
    const dx = end.x - start.x, dy = end.y - start.y;
    const at = (t) => ({ x: start.x + dx * t, y: start.y + dy * t });
    // Traverse EVERY pixel cell crossed by the clipped tooth edge. Endpoint
    // sampling alone could bridge a transparent slit, pale area or third pen.
    const ix = Math.max(0, Math.min(width - 1, Math.floor(start.x + Math.sign(dx) * 1e-9)));
    const iy = Math.max(0, Math.min(height - 1, Math.floor(start.y + Math.sign(dy) * 1e-9)));
    let tx = dx === 0 ? Infinity : ((dx > 0 ? ix + 1 : ix) - start.x) / dx;
    let ty = dy === 0 ? Infinity : ((dy > 0 ? iy + 1 : iy) - start.y) / dy;
    const stepX = dx === 0 ? Infinity : 1 / Math.abs(dx);
    const stepY = dy === 0 ? Infinity : 1 / Math.abs(dy);
    let t = 0;
    while (t < 1) {
      if (++work > 2000000) throw new Error(limitMessage);
      if (work % 512 === 0) checkpoint(s);
      const next = Math.min(1, tx, ty);
      if (next > t) {
        const mid = at((t + next) / 2);
        const x = Math.max(0, Math.min(width - 1, Math.floor(mid.x)));
        const y = Math.max(0, Math.min(height - 1, Math.floor(mid.y)));
        const style = styleAt(x, y);
        if (style) emit(at(t), at(next), style); else finish();
      }
      if (tx <= next) tx += stepX;
      if (ty <= next) ty += stepY;
      t = next;
    }
    if (clipped.high < 1 || !p.connected) finish();
  }
  function vertex(theta, sign) {
    const r = b * theta;
    const cos = Math.cos(theta), sin = Math.sin(theta);
    const x = cx + r * cos, y = cy + direction * r * sin;
    const d = tone(x, y);
    const tangentX = b * cos - r * sin;
    const tangentY = direction * (b * sin + r * cos);
    const length = Math.hypot(tangentX, tangentY);
    const offset = sign * maxAmplitude * d * Math.min(1, r / spacing);
    return { point: { x: x - tangentY * offset / length, y: y + tangentX * offset / length }, d, r };
  }
  let s = 0, theta = 0, sign = 1;
  let previous = vertex(0, 0);
  while (s < endArc) {
    if (++vertices > 400000) throw new Error(limitMessage);
    if (vertices % 128 === 1) checkpoint(s);
    // Darker samples give both larger teeth and shorter wavelength. Arc-length
    // stepping keeps detail consistent from the centre to the outside rings.
    const halfTooth = spacing / (2 * p.detail * (0.25 + 1.75 * previous.d));
    const step = Math.min(halfTooth, 0.2 * Math.hypot(previous.r, b), endArc - s);
    s += step;
    let nextTheta = theta + step / Math.hypot(previous.r, b);
    for (let i = 0; i < 5; i++) nextTheta -= (arc(nextTheta) - s) / (b * Math.hypot(nextTheta, 1));
    theta = Math.min(endTheta, nextTheta);
    const next = vertex(theta, sign);
    segment(previous.point, next.point, s);
    previous = next; sign = -sign;
  }
  checkpoint(endArc);
  if (!paths.length) throw new Error("No visible spiral marks. Disable Skip light areas, increase the brightness threshold, or check the image transparency and Extent.");
  // Geometry is calculated in source pixels, then mapped to the COMPLETE local
  // source frame. The host alone handles placement, rotation and per-axis scale.
  for (const path of paths) for (const point of path.points) {
    point.x *= input.width / width;
    point.y *= input.height / height;
  }
  context.progress(100);
  return { width: input.width, height: input.height, paths };
}
