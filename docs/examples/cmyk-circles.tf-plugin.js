/* terraforge-plugin
{
  "id": "terraforge.cmyk-circles",
  "name": "CMYK Circles",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Separate one bitmap into overlapping Cyan, Magenta, Yellow and final Black circles. Define four real pens first. All lengths are source pixels: resizing scales marks, gaps, offsets and border; unequal X/Y scaling makes ellipses. Filled circles use real rings. Physical mixing depends on transparent inks, paper and registration. Preview is an RGB path display, not an ink simulation.",
  "category": "bitmap-processor",
  "input": "bitmap",
  "outputs": ["vector"],
  "controls": [
    { "key": "cyanPen", "label": "Cyan pen", "type": "pen", "default": "", "suggestedColor": "#00ffff" },
    { "key": "magentaPen", "label": "Magenta pen", "type": "pen", "default": "", "suggestedColor": "#ff00ff" },
    { "key": "yellowPen", "label": "Yellow pen", "type": "pen", "default": "", "suggestedColor": "#ffff00" },
    { "key": "blackPen", "label": "Black pen (final pass and border)", "type": "pen", "default": "", "suggestedColor": "#000000" },
    { "key": "fitToBudget", "label": "Fit complete image to detail limits (enlarges circle settings)", "type": "boolean", "default": false },
    { "key": "diameter", "label": "Circle size (maximum diameter)", "type": "number", "default": 8, "min": 0.5, "max": 1000, "step": 0.5, "unit": "source px" },
    { "key": "toneMode", "label": "Tone controls circle coverage", "type": "select", "default": "area", "options": [
      { "label": "Reduce individual circle area with tone", "value": "area" },
      { "label": "Same size circles; tone controls their number", "value": "number" }
    ] },
    { "key": "style", "label": "Circle style", "type": "select", "default": "filled", "options": [
      { "label": "Filled (plotted concentric rings)", "value": "filled" },
      { "label": "Outline (perimeter only)", "value": "outline" }
    ] },
    { "key": "gap", "label": "Circle spacing (gap at maximum size)", "type": "number", "default": 1, "min": 0, "max": 1000, "step": 0.5, "unit": "source px" },
    { "key": "fillSpacing", "label": "Fill spacing (circle and border toolpaths)", "type": "number", "default": 1, "min": 0.1, "max": 100, "step": 0.1, "unit": "source px" },
    { "key": "blackGeneration", "label": "Black generation / undercolour removal", "type": "number", "default": 100, "min": 0, "max": 100, "step": 5, "unit": "%" },
    { "key": "cyanX", "label": "Cyan grid X offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "cyanY", "label": "Cyan grid Y offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "cyanAngle", "label": "Cyan screen angle (grid rotation)", "type": "number", "default": 15, "min": -180, "max": 180, "step": 1, "unit": "degrees" },
    { "key": "magentaX", "label": "Magenta grid X offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "magentaY", "label": "Magenta grid Y offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "magentaAngle", "label": "Magenta screen angle (grid rotation)", "type": "number", "default": 75, "min": -180, "max": 180, "step": 1, "unit": "degrees" },
    { "key": "yellowX", "label": "Yellow grid X offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "yellowY", "label": "Yellow grid Y offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "yellowAngle", "label": "Yellow screen angle (grid rotation)", "type": "number", "default": 0, "min": -180, "max": 180, "step": 1, "unit": "degrees" },
    { "key": "blackX", "label": "Black grid X offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "blackY", "label": "Black grid Y offset", "type": "number", "default": 0, "min": -10000, "max": 10000, "step": 0.5, "unit": "source px" },
    { "key": "blackAngle", "label": "Black screen angle (grid rotation)", "type": "number", "default": 45, "min": -180, "max": 180, "step": 1, "unit": "degrees" },
    { "key": "border", "label": "Add border (Black final pass)", "type": "boolean", "default": false },
    { "key": "borderWidth", "label": "Border width (inset plotted band)", "type": "number", "default": 3, "min": 0.1, "max": 1000, "step": 0.5, "unit": "source px" },
    { "key": "samples", "label": "Sampling detail (samples per cell axis)", "type": "number", "default": 2, "min": 1, "max": 4, "step": 1, "unit": "samples" },
    { "key": "tolerance", "label": "Circle curve detail (maximum chord error)", "type": "number", "default": 0.2, "min": 0.02, "max": 2, "step": 0.02, "unit": "source px" }
  ]
}
*/
// Original self-contained code; Adobe PDF 1.7 / ISO 32000-1, 10.3.2:
// c=1-R, m=1-G, y=1-B, k=min(c,m,y); BG(k)=UCR(k)=generation*k.
// Residual inks are c-k,m-k,y-k. This is an unprofiled artistic separation.
export default function run(input, parameters, context) {
  const started = Date.now();
  const capacity = context.limits?.points === 600000 && context.limits?.paths === 60000 ? 6 : 1;
  const pathLimit = 10000 * capacity, pointLimit = 100000 * capacity;
  const workLimit = 3000000 * capacity, vertexLimit = 400000 * capacity, gridLimit = 150000 * capacity;
  const executionMs = capacity === 6 ? 175000 : 25000;
  const countLabel = value => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let lastReported = -1;
  function report(percent) {
    // Retries never announce a complete preview, or move progress backwards.
    const value = Math.min(99, percent);
    if (value > lastReported) { context.progress(value); lastReported = value; }
  }
  function scaled(factor) {
    return { ...parameters, diameter: parameters.diameter * factor, gap: parameters.gap * factor,
      fillSpacing: parameters.fillSpacing * factor, tolerance: parameters.tolerance * factor };
  }
  let factor = 1;
  let previousInk = false;
  for (let attempt = 0; attempt < 9; attempt++) {
    try {
      const effective = scaled(factor);
      const result = generate(effective);
      if (previousInk && result.items.every(item => item.paths.length === 0)) {
        throw new Error("Fitting would remove all sampled ink. Use Outline, increase Fill spacing, or import a lower-resolution copy. No partial layers were returned.");
      }
      if (factor > 1) {
        const number = value => Number(value.toFixed(3));
        result.warnings.unshift("Fit to limits used " + number(factor) + "x circle settings: diameter " + number(effective.diameter) +
          ", gap " + number(effective.gap) + ", fill spacing " + number(effective.fillSpacing) + ", chord error " + number(effective.tolerance) +
          " source px. Offsets, border width and the source frame are unchanged. Fields retain your requested values; turn Fit off to require those exact sizes.");
      }
      context.progress(100);
      return result;
    } catch (error) {
      if (!parameters.fitToBudget || !error?.cmykBudget) throw error;
      previousInk ||= error.hadInk;
      // Only a complete result is returned. Restart all four channels together;
      // never keep earlier channels or silently stop part-way through a layer.
      factor *= 2;
    }
  }
  throw new Error("CMYK Circles could not fit this image within the detail limits. Its colour/transparent boundaries may be too complex. Increase Circle spacing, use Outline, or import a lower-resolution copy. No partial layers were returned.");

  function generate(p) {
    const { widthPx: w, heightPx: h, data } = input;
    const names = ["Cyan", "Magenta", "Yellow", "Black"];
    const keys = ["cyan", "magenta", "yellow", "black"];
    const palette = input.palette || [];
    if (palette.length < 4) throw new Error("Define four distinct real pens in Pens before using CMYK Circles, then assign Cyan, Magenta, Yellow and Black.");
    const pens = keys.map(key => palette.find(pen => pen.id === p[key + "Pen"]));
    if (pens.some(pen => !pen)) throw new Error("Assign all four channels to available real pens. A saved missing pen is never substituted.");
    if (new Set(pens.map(pen => pen.id)).size !== 4) throw new Error("Cyan, Magenta, Yellow and Black must use four distinct pen IDs. Choose a different real pen for each channel.");
    if (!Number.isInteger(p.samples)) throw new Error("Sampling detail must be a whole number from 1 to 4.");
    if (p.border && p.borderWidth >= Math.min(w, h) / 2) throw new Error("Border width must be less than half the shorter source-frame side. Reduce Border width.");
    const items = pens.map((pen, i) => ({ kind: "vector", name: "CMYK " + names[i],
      width: input.width, height: input.height, paths: [], penId: pen.id, plotOrder: i }));
    function exceeded(kind, guidance) {
      const error = new Error("CMYK Circles reached the " + kind + " detail budget" + (active ? " in " + active.name : "") +
        " (source " + w + " x " + h + " px). " + (capacity === 1 && context.limits ? "Choose Extended 6x in Artwork capacity, or turn on " : "Turn on ") + "Fit complete image to detail limits, or " + guidance +
        ". No partial layers were returned.");
      error.cmykBudget = true;
      error.hadInk = pathCount > 0;
      throw error;
    }
    let work = 0, vertices = 0, pointCount = 0, pathCount = 0, current = null, active = null, lastProgress = -1;
    function check(progress) {
      if (context.signal.aborted) throw new Error("CMYK Circles cancelled; no artwork was added.");
      if (Date.now() - started > executionMs) throw new Error("CMYK Circles reached its time budget. Increase spacing or use Outline. No partial layers were returned.");
      if (progress > lastProgress) { report(progress); lastProgress = progress; }
    }
    function tick() { if (++work > workLimit) exceeded(countLabel(workLimit) + " sampling/clipping checks", "increase Circle spacing or reduce Sampling detail"); if (work % 512 === 0) check(lastProgress); }
    check(0);
    const pitch = p.diameter + p.gap, rowPitch = pitch * Math.sqrt(3) / 2;
    const radiusMax = p.diameter / 2;
    const generation = p.blackGeneration / 100;
    // Straight RGBA8 is composited over white before the CMYK separation.
    function coverage(x, y, channel, border = false) {
      tick();
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const o = (Math.floor(y) * w + Math.floor(x)) * 4, alpha = data[o + 3] / 255;
      if (alpha === 0) return 0;
      if (border) return 1;
      const c = alpha * (1 - data[o] / 255), m = alpha * (1 - data[o + 1] / 255), yInk = alpha * (1 - data[o + 2] / 255);
      const k = Math.min(c, m, yInk) * generation;
      return channel === 3 ? k : [c - k, m - k, yInk - k][channel];
    }
    const same = (a, b) => Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8;
    function finish() { current = null; }
    function emit(a, b) {
      if (same(a, b)) return;
      if (!current || !same(current.points[current.points.length - 1], a)) {
        if (++pathCount > pathLimit) exceeded(countLabel(pathLimit) + " paths", "increase Fill spacing or use Outline");
        if (pointCount + 2 > pointLimit) exceeded(countLabel(pointLimit) + " points", "increase Circle size and Fill spacing, or use Outline; reducing Sampling detail does not lower the point limit");
        current = { points: [a, b] }; active.paths.push(current); pointCount += 2;
      } else {
        const pts = current.points, last = pts[pts.length - 1], prev = pts[pts.length - 2];
        const cross = (last.x - prev.x) * (b.y - last.y) - (last.y - prev.y) * (b.x - last.x);
        const dot = (last.x - prev.x) * (b.x - last.x) + (last.y - prev.y) * (b.y - last.y);
        if (Math.abs(cross) < 1e-10 && dot >= 0) pts[pts.length - 1] = b;
        else { if (++pointCount > pointLimit) exceeded(countLabel(pointLimit) + " points", "increase Circle size and Fill spacing, or use Outline; reducing Sampling detail does not lower the point limit"); pts.push(b); }
      }
    }
    // Liang-Barsky intersection clipping, followed by exact pixel-cell traversal.
    // Every excluded interval breaks the path, including a one-pixel alpha slit.
    function segment(a, b, channel, border = false) {
      if (++vertices > vertexLimit) exceeded(countLabel(vertexLimit) + " curve segments", "increase Fill spacing or Circle curve detail (maximum chord error)");
      let lo = 0, hi = 1;
      const dx = b.x - a.x, dy = b.y - a.y;
      for (const [v, q] of [[-dx, a.x], [dx, w - a.x], [-dy, a.y], [dy, h - a.y]]) {
        if (v === 0) { if (q < 0) { finish(); return; } }
        else { const t = q / v; if (v < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t); }
      }
      if (lo >= hi) { finish(); return; }
      if (lo > 0) finish();
      const at = t => ({ x: Math.max(0, Math.min(w, a.x + dx * t)), y: Math.max(0, Math.min(h, a.y + dy * t)) });
      const start = at(lo);
      const ix = Math.max(0, Math.min(w - 1, Math.floor(start.x + Math.sign(dx) * 1e-9)));
      const iy = Math.max(0, Math.min(h - 1, Math.floor(start.y + Math.sign(dy) * 1e-9)));
      let tx = dx === 0 ? Infinity : ((dx > 0 ? ix + 1 : ix) - a.x) / dx;
      let ty = dy === 0 ? Infinity : ((dy > 0 ? iy + 1 : iy) - a.y) / dy;
      const stepX = dx === 0 ? Infinity : 1 / Math.abs(dx), stepY = dy === 0 ? Infinity : 1 / Math.abs(dy);
      let t = lo;
      while (t < hi - 1e-12) {
        tick();
        const next = Math.min(hi, tx, ty);
        if (next > t + 1e-12) {
          const mid = at((t + next) / 2);
          if (coverage(Math.min(w - 1e-8, mid.x), Math.min(h - 1e-8, mid.y), channel, border) > 1e-10) emit(at(t), at(next));
          else finish();
        }
        if (tx <= next + 1e-12) tx += stepX;
        if (ty <= next + 1e-12) ty += stepY;
        t = Math.max(t, next);
      }
      if (hi < 1) finish();
    }
    function ring(cx, cy, r, channel) {
      finish();
      const n = Math.max(12, Math.ceil(Math.PI / Math.acos(1 - Math.min(p.tolerance, r) / r)));
      if (n > 2048) exceeded("2,048 segments per circle", "increase Circle curve detail (maximum chord error)");
      let previous = { x: cx + r, y: cy };
      for (let i = 1; i <= n; i++) {
        const point = { x: cx + r * Math.cos(i * 2 * Math.PI / n), y: cy + r * Math.sin(i * 2 * Math.PI / n) };
        segment(previous, point, channel); previous = point;
      }
      finish();
    }
    // Bayer 8x8 ordered coverage for optional equal-size dots. No random state.
    function threshold(column, row, channel) {
      let x = ((column + channel * 3) % 8 + 8) % 8, y = ((row + channel * 5) % 8 + 8) % 8, value = 0;
      for (let bit = 0; bit < 3; bit++) { const xb = (x >> bit) & 1, yb = (y >> bit) & 1; value = value * 4 + ((xb ^ yb) * 2 + yb); }
      return (value + 0.5) / 64;
    }
    for (let channel = 0; channel < 4; channel++) {
      active = items[channel];
      const key = keys[channel], angle = p[key + "Angle"] * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      const ox = w / 2 + p[key + "X"], oy = h / 2 + p[key + "Y"];
      const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => ({ x: (x - ox) * cos + (y - oy) * sin, y: -(x - ox) * sin + (y - oy) * cos }));
      const minCol = Math.floor((Math.min(...corners.map(c => c.x)) - radiusMax) / pitch) - 1;
      const maxCol = Math.ceil((Math.max(...corners.map(c => c.x)) + radiusMax) / pitch) + 1;
      const minRow = Math.floor((Math.min(...corners.map(c => c.y)) - radiusMax) / rowPitch);
      const maxRow = Math.ceil((Math.max(...corners.map(c => c.y)) + radiusMax) / rowPitch);
      if ((maxRow - minRow + 1) * (maxCol - minCol + 1) > gridLimit) exceeded(countLabel(gridLimit) + " grid positions per layer", "increase Circle size or Circle spacing");
      for (let row = minRow; row <= maxRow; row++) {
        check(Math.floor((channel + (row - minRow) / (maxRow - minRow + 1)) * 24));
        for (let column = minCol; column <= maxCol; column++) {
          const gx = (column + ((row % 2 + 2) % 2) / 2) * pitch, gy = row * rowPitch;
          const cx = ox + gx * cos - gy * sin, cy = oy + gx * sin + gy * cos;
          if (cx + radiusMax < 0 || cy + radiusMax < 0 || cx - radiusMax > w || cy - radiusMax > h) continue;
          let q = 0;
          for (let sy = 0; sy < p.samples; sy++) for (let sx = 0; sx < p.samples; sx++) {
            const u = ((sx + 0.5) / p.samples - 0.5) * p.diameter, v = ((sy + 0.5) / p.samples - 0.5) * p.diameter;
            q += coverage(cx + u * cos - v * sin, cy + u * sin + v * cos, channel);
          }
          q /= p.samples * p.samples;
          if (q <= 1e-10 || (p.toneMode === "number" && q < threshold(column, row, channel))) continue;
          const r = radiusMax * (p.toneMode === "area" ? Math.sqrt(q) : 1);
          ring(cx, cy, r, channel);
          if (p.style === "filled") {
            if (r / p.fillSpacing > 10000) exceeded("10,000 fill rings per circle", "increase Fill spacing");
            for (let inner = r - p.fillSpacing; inner > p.fillSpacing / 2; inner -= p.fillSpacing) ring(cx, cy, inner, channel);
            if (r > p.fillSpacing / 2 + 1e-8) ring(cx, cy, p.fillSpacing / 2, channel);
          }
        }
      }
    }
    if (p.border) {
      active = items[3];
      const count = Math.ceil(p.borderWidth / p.fillSpacing);
      if (count > 10000) exceeded("10,000 border contours", "increase Fill spacing");
      for (let i = 0; i <= count; i++) {
        check(96 + Math.floor(i / (count + 1) * 3));
        const inset = i * p.borderWidth / count;
        const corners = [{ x: inset, y: inset }, { x: w - inset, y: inset }, { x: w - inset, y: h - inset }, { x: inset, y: h - inset }];
        finish();
        for (let j = 0; j < 4; j++) segment(corners[j], corners[(j + 1) % 4], 3, true);
        finish();
      }
    }
    for (const item of items) for (const path of item.paths) for (const point of path.points) {
      point.x *= input.width / w; point.y *= input.height / h;
    }
    check(99);
    return { items, warnings: ["Unprofiled CMYK separation: overlapping real pens suggest colours. Ink transparency, pen width, paper and alignment determine the physical result; the RGB preview is not a subtractive ink proof."] };
  }
}
