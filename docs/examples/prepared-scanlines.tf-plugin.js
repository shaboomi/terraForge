/* terraforge-plugin
{
  "id": "examples.prepared-scanlines",
  "name": "Prepared Scanlines",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Demonstrate opt-in host tones and colour channels as simple thresholded scanlines. Channel colours remain unassigned to real pens.",
  "category": "bitmap-processor",
  "input": "bitmap",
  "outputs": ["vector"],
  "bitmapPreparation": true,
  "controls": [
    { "key": "spacing", "label": "Row spacing", "type": "number", "default": 8, "min": 1, "max": 128, "step": 1, "unit": "source px" },
    { "key": "threshold", "label": "Minimum channel amount", "type": "slider", "default": 128, "min": 1, "max": 255, "step": 1 }
  ]
}
*/
export default function run(input, parameters, context) {
  if (input.kind !== "bitmap" || !input.prepared || input.prepared.version !== 1) {
    throw new Error("Prepared Scanlines requires a host supporting shared bitmap preparation.");
  }
  const prepared = input.prepared;
  const channels = prepared.channels.length ? prepared.channels : [{
    label: "Prepared tones", color: "#000000", model: "ink",
    data: prepared.tones, brightness: true
  }];
  const items = [];
  const spacing = Math.max(1, Math.round(parameters.spacing));
  const pathLimit = context.limits?.paths || 10000;
  const pointLimit = context.limits?.points || 100000;
  let totalPaths = 0;
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex++) {
    const channel = channels[channelIndex];
    const paths = [];
    for (let y = 0; y < input.heightPx; y += spacing) {
      if (context.signal.aborted) throw new Error("Cancelled");
      let start = -1;
      for (let x = 0; x <= input.widthPx; x++) {
        const value = x < input.widthPx ? channel.data[y * input.widthPx + x] : 0;
        const amount = channel.brightness ? 255 - value : value;
        const active = x < input.widthPx && amount >= parameters.threshold;
        if (active && start < 0) start = x;
        if (!active && start >= 0) {
          if (++totalPaths > pathLimit || totalPaths * 2 > pointLimit) {
            throw new Error("The complete scanlines exceed the detail limit. Increase Row spacing or Minimum channel amount, or use fewer separation channels.");
          }
          const rowY = (y + 0.5) * input.height / input.heightPx;
          paths.push({ points: [{ x: start * input.width / input.widthPx, y: rowY },
            { x: x * input.width / input.widthPx, y: rowY }], color: channel.color });
          start = -1;
        }
      }
      context.progress((channelIndex + Math.min(1, (y + spacing) / input.heightPx)) * 100 / channels.length);
    }
    if (paths.length) items.push({ kind: "vector", name: channel.label,
      width: input.width, height: input.height, paths });
  }
  if (!items.length) throw new Error("No prepared tones or channel amounts reached the threshold. Lower Minimum channel amount or adjust the shared preparation controls.");
  return { items, warnings: prepared.channels.length ? [
    "Channel colours and labels are preserved. Assign actual pens in TerraForge before plotting. RGB channels represent additive light on a dark substrate."
  ] : [] };
}
