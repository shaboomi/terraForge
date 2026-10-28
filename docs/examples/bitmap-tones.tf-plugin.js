/* terraforge-plugin
{
  "id": "examples.bitmap-tones",
  "name": "Bitmap Tones",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Create a separate greyscale or inverted bitmap, preserving transparency.",
  "category": "bitmap-processor",
  "input": "bitmap",
  "outputs": ["bitmap"],
  "controls": [
    { "key": "mode", "label": "Filter", "type": "select", "default": "greyscale", "options": [
      { "label": "Greyscale", "value": "greyscale" },
      { "label": "Invert", "value": "invert" }
    ] }
  ]
}
*/
export default function run(input, parameters, context) {
  const data = new Uint8Array(input.data);
  for (let offset = 0; offset < data.length; offset += 4) {
    if (offset % (input.widthPx * 4 * 64) === 0) {
      if (context.signal.aborted) throw new Error("Cancelled");
      context.progress(offset * 100 / data.length);
    }
    if (parameters.mode === "invert") {
      data[offset] = 255 - data[offset];
      data[offset + 1] = 255 - data[offset + 1];
      data[offset + 2] = 255 - data[offset + 2];
    } else {
      const grey = Math.round(data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722);
      data[offset] = grey;
      data[offset + 1] = grey;
      data[offset + 2] = grey;
    }
    if (data[offset + 3] === 0) data[offset] = data[offset + 1] = data[offset + 2] = 0;
  }
  context.progress(100);
  return { items: [{ kind: "bitmap", name: parameters.mode === "invert" ? "Inverted bitmap" : "Greyscale bitmap",
    width: input.width, height: input.height, widthPx: input.widthPx, heightPx: input.heightPx, data }] };
}
