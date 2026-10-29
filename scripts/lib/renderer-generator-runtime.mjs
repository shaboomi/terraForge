/** Runtime for the deliberately bounded offline renderer conversion format.
 * This function is embedded as source; it must have no imported dependencies.
 * Independent implementation of the contract described by upstream PR #128.
 */
export async function convertedGeneratorRuntime(factories, entry, input, parameters, context) {
  const fail = message => { throw new Error(`Converted renderer: ${message}`); };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const factory = factories.get(filename);
    if (!factory) fail(`module '${filename}' was not bundled.`);
    const module = { exports: {} };
    cache.set(filename, module);
    try { factory.call(module.exports, module, module.exports, specifier => {
      if (typeof specifier !== "string" || !/^\.\.?\//.test(specifier) || /[\\\0?#:]/.test(specifier)) {
        fail("only relative require() calls within the converted folder are supported.");
      }
      const parts = filename.split("/").slice(0, -1);
      for (const part of specifier.split("/")) {
        if (part === "." || !part) continue;
        if (part === "..") { if (!parts.length) fail("require() cannot leave the plugin folder."); parts.pop(); }
        else parts.push(part);
      }
      const base = parts.join("/");
      const resolved = [base, `${base}.js`, `${base}/index.js`, `${base}.json`].find(path => factories.has(path));
      if (!resolved) fail(`relative module '${specifier}' was not bundled.`);
      return load(resolved);
    }); } catch (error) { cache.delete(filename); throw error; }
    return module.exports;
  }
  if (input.kind !== "none") fail("only source:none generators are supported.");
  if (context.signal.aborted) fail("cancelled.");
  const plugin = load(entry);
  if (typeof plugin.render !== "function") fail("entry must export render(context).");
  if (context.signal.aborted) fail("cancelled.");
  const width = input.page.widthMM, height = input.page.heightMM;
  const output = await plugin.render({ width, height, scale: 1, settings: parameters, seed: context.seed });
  if (context.signal.aborted) fail("cancelled.");
  const limits = context.limits ?? { paths: 10000, points: 100000 };
  let pointCount = 0, pathCount = 0, textCount = 0;
  const textLimit = limits.points * 80;
  function record(value, allowed, where) {
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${where} must be an object.`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${where} field '${key}' is unsupported (dots and curves require a separate adapter).`);
    return value;
  }
  function paths(d, color) {
    if (typeof d !== "string") fail("each layer must contain SVG path text in d.");
    if (/^\s*,|,\s*,|,\s*$|[MmLlHhVvZz]\s*,|,\s*[MmLlHhVvZz]/.test(d)) fail("malformed SVG comma separators.");
    textCount += d.length;
    if (textCount > textLimit) fail("SVG path text exceeds the selected capacity.");
    const tokens = [];
    const token = /\s+|,|[MmLlHhVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/gy;
    let offset = 0;
    while (offset < d.length) {
      token.lastIndex = offset;
      const match = token.exec(d);
      if (!match) fail(`unsupported or malformed SVG path at character ${offset}; only M/L/H/V/Z are supported. Curves are not approximated.`);
      offset = token.lastIndex;
      if (!/^[\s,]+$/.test(match[0])) tokens.push(match[0]);
      if (tokens.length > limits.points * 3 + limits.paths * 2) fail("SVG path token budget exceeded.");
    }
    const result = [];
    let index = 0, command, x = 0, y = 0, startX = 0, startY = 0, current = [];
    const finish = closed => {
      if (!current.length) return;
      if (current.length < 2) fail("move-only paths and pen taps are unsupported.");
      if (++pathCount > limits.paths) fail("path budget exceeded.");
      result.push({ points: current, ...(closed ? { closed: true } : {}), ...(color ? { color } : {}) });
      current = [];
    };
    const point = (px, py) => {
      if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0 || px > width || py > height) fail("path coordinates must remain inside the full page frame; clipping is unsupported.");
      if (++pointCount > limits.points) fail("point budget exceeded.");
      current.push({ x: px, y: py }); x = px; y = py;
    };
    const number = () => {
      if (index >= tokens.length || /^[A-Za-z]$/.test(tokens[index])) fail("incomplete SVG command.");
      const value = Number(tokens[index++]);
      if (!Number.isFinite(value)) fail("SVG coordinate must be finite.");
      return value;
    };
    while (index < tokens.length) {
      if (/^[A-Za-z]$/.test(tokens[index])) command = tokens[index++];
      if (!command) fail("SVG path must start with M.");
      const upper = command.toUpperCase(), relative = command !== upper;
      if (upper === "Z") {
        if (!current.length) fail("Z requires an open path.");
        finish(true); x = startX; y = startY; command = undefined; continue;
      }
      if (upper === "M") {
        finish(false);
        const nx = number() + (relative ? x : 0), ny = number() + (relative ? y : 0);
        point(nx, ny); startX = x; startY = y;
        command = relative ? "l" : "L";
      } else {
        if (!current.length) fail("each path must start with M; drawing after Z requires another M.");
        if (upper === "L") { const nx = number() + (relative ? x : 0), ny = number() + (relative ? y : 0); point(nx, ny); }
        else if (upper === "H") point(number() + (relative ? x : 0), y);
        else if (upper === "V") point(x, number() + (relative ? y : 0));
        else fail("unsupported SVG command.");
      }
    }
    finish(false);
    if (!result.length) fail("layer contains no drawable paths.");
    return result;
  }
  let layers, warnings;
  if (typeof output === "string") layers = [{ d: output }];
  else if (Array.isArray(output)) layers = output;
  else { record(output, ["layers", "warnings"], "output"); layers = output.layers; warnings = output.warnings; }
  if (!Array.isArray(layers) || layers.length < 1 || layers.length > 16) fail("between 1 and 16 SVG layers are supported.");
  if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 20 || warnings.some(w => typeof w !== "string" || w.length > 512))) fail("warnings must be at most 20 text messages of 512 characters.");
  const items = layers.map(layer => {
    record(layer, ["d", "label", "color"], "layer");
    if (layer.label !== undefined && (typeof layer.label !== "string" || !layer.label.trim() || layer.label.length > 120)) fail("layer label must contain 1–120 characters.");
    if (layer.color !== undefined && (typeof layer.color !== "string" || !/^#[0-9a-f]{6}$/i.test(layer.color))) fail("layer colour must be six-digit hex; colours are never guessed or mapped to real pens.");
    return { kind: "vector", width, height, paths: paths(layer.d, layer.color), ...(layer.label ? { name: layer.label } : {}) };
  });
  context.progress(100);
  return { items, ...(warnings === undefined ? {} : { warnings }) };
}
