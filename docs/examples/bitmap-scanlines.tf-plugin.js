/* terraforge-plugin
{
  "id": "examples.bitmap-scanlines",
  "name": "Bitmap Scanlines",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Convert dark pixels to basic scanlines, optionally matching the configured pens.",
  "category": "bitmap-processor",
  "input": "bitmap",
  "outputs": ["vector"],
  "controls": [
    { "key": "spacing", "label": "Row spacing", "type": "number", "default": 8, "min": 1, "max": 128, "step": 1, "unit": "px" },
    { "key": "threshold", "label": "Darkness threshold", "type": "slider", "default": 180, "min": 1, "max": 255, "step": 1 },
    { "key": "usePens", "label": "Match my pens", "type": "boolean", "default": true }
  ]
}
*/
export default function run(input, parameters, context) {
  const palette = parameters.usePens ? (input.palette || []).map((pen) => ({
    ...pen,
    rgb: [1, 3, 5].map((offset) => parseInt(pen.color.slice(offset, offset + 2), 16))
  })) : [];
  const paths = [];
  let limited = false;
  const spacing = Math.max(1, Math.round(parameters.spacing));
  function sample(x, y) {
    const offset = (y * input.widthPx + x) * 4;
    const alpha = input.data[offset + 3] / 255;
    const rgb = [0, 1, 2].map((channel) => input.data[offset + channel] * alpha + 255 * (1 - alpha));
    if (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 > parameters.threshold) return null;
    let closest;
    let distance = Infinity;
    for (const pen of palette) {
      const score = rgb.reduce((sum, channel, index) => sum + (channel - pen.rgb[index]) ** 2, 0);
      if (score < distance) { closest = pen; distance = score; }
    }
    return closest || { id: "", color: "#000000" };
  }
  for (let y = 0; y < input.heightPx; y += spacing) {
    if (context.signal.aborted) throw new Error("Cancelled");
    let start = 0;
    let current = null;
    for (let x = 0; x <= input.widthPx; x++) {
      const next = x < input.widthPx ? sample(x, y) : null;
      if ((next?.id ?? null) === (current?.id ?? null)) continue;
      if (current) {
        paths.push({ points: [{ x: start * input.width / input.widthPx, y: (y + 0.5) * input.height / input.heightPx },
          { x: x * input.width / input.widthPx, y: (y + 0.5) * input.height / input.heightPx }],
          color: current.color, ...(current.id ? { penId: current.id } : {}) });
        if (paths.length >= 9500) { limited = true; break; }
      }
      current = next;
      start = x;
    }
    context.progress((y + 1) * 100 / input.heightPx);
    if (limited) break;
  }
  if (!paths.length) throw new Error("No dark pixels matched. Increase the darkness threshold.");
  return { width: input.width, height: input.height, paths,
    ...(limited ? { warnings: ["Example path limit reached. Increase row spacing for a complete image."] } : {}) };
}
