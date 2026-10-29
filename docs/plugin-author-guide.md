# Writing a TerraForge plugin

The JavaScript API supports generators and tools that process one selected bitmap or vector item. Plugins return ordinary vector artwork and/or bitmap pixels. Stage 3 adds manual previews, separate generated results and colour-aware output using the user's pens. See [the Stage 3 guide](plugin-stage-3.md) for the workflow and [the bitmap guide](plugin-stage-2.md) for image imports. A font-loading service and detailed artistic filters remain later work.

## Install your first plugin

1. Start TerraForge and choose **Plugins → Add Example Generator**.
2. Choose **Example Grid** in the Generators category. Its controls appear under **Properties**, even on an empty canvas.
3. Set Width, Height, Spacing and Border, then choose **Add artwork**.
4. Move, resize or rotate the resulting vector import using the normal controls. **Undo** removes the generated import in one step. You can save it in a `.tforge` layout and reopen it without the plugin installed.

To install your own file, choose **Plugins → Open Plugin Folder**, save a UTF-8 file ending in `.tf-plugin.js` there, then choose **Plugins → Rescan Plugins**. Use an editor such as Visual Studio Code. If you use Notepad, choose **Save as type: All files** so the filename does not become `.js.txt`.

The installed app uses the `plugins` folder inside its application data directory. Development uses a separate `plugins-dev` folder. Open Plugin Folder takes you to the correct one; you do not need to find AppData manually. Files in this folder survive application upgrades.

## Hide the panel and edit generated artwork later

Use **Minimise plugin panel** to keep a compact header, then **Expand plugin panel** to show its controls again. The **Close plugin panel** X hides the panel without deleting artwork already on the canvas.

To change an existing result, select the generated artwork and choose **Edit with [plugin name]** in Properties. TerraForge restores the settings saved with that item. For a generator, choose **Update artwork**. For a processor, choose **Preview**, inspect the result, then **Update artwork** to apply it. An update replaces the preceding generated result together in one undoable edit. Undo restores the preceding geometry and saved settings. Processor results keep the original source and its full placement frame.

The same flow works after saving and reopening a `.tforge` layout. Keep the original plugin installed and enabled at the same version to reopen its controls. A processor also needs its original canvas source. If either is missing, disabled or incompatible, Properties explains the editing limitation; the saved artwork remains usable. Opening a layout never executes plugin code automatically.

Updating regenerates the vector paths from the saved settings. It does not preserve manual edits to individual generated paths. Opening a tool through the Plugins menu starts a new artwork operation; use the selected item's Edit with action when you intend to update that result.

## A complete rectangle generator

Save this as `rectangle.tf-plugin.js`. The header must be at the start of the file and use JSON, including double quotes and no trailing commas.

```javascript
/* terraforge-plugin
{
  "id": "my-tools.rectangle",
  "name": "Rectangle",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Create a rectangular vector outline.",
  "category": "generator",
  "input": "none",
  "outputs": ["vector"],
  "controls": [
    { "key": "width", "label": "Width", "type": "number", "default": 80, "min": 1, "max": 1000, "step": 1, "unit": "mm" },
    { "key": "height", "label": "Height", "type": "number", "default": 60, "min": 1, "max": 1000, "step": 1, "unit": "mm" },
    { "key": "colour", "label": "Colour", "type": "colour", "default": "#000000" }
  ]
}
*/
export default async function run(input, parameters, context) {
  const { width, height, colour } = parameters;
  context.progress(100);
  return {
    width,
    height,
    paths: [{
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height }
      ],
      closed: true,
      color: colour
    }]
  };
}
```

TerraForge reads the JSON header during startup without running the code below it. The JavaScript module is evaluated when you choose Add artwork. Syntax errors therefore appear when a plugin is run. If a file changes after discovery, choose **Plugins → Rescan Plugins** before running it; TerraForge will not silently run different code from the discovered snapshot. See [Rescan and saved plugin code](plugin-rescan.md).

## Header fields

| Field | Meaning |
| --- | --- |
| `id` | Stable unique identifier, up to 100 characters: lowercase letters, digits and internal `.`, `_` or `-`. Keep it unchanged when releasing updates. |
| `name` | Display name in the menu and the generated import. |
| `version` | Plugin version in `major.minor.patch` form, for example `1.0.0`. |
| `apiVersion` | Must be `1` for this release. |
| `description` | Short explanation of the tool. |
| `category` | `generator`, `bitmap-processor` or `font-tool`; controls menu placement. |
| `input` | `none` for a generator, `bitmap` for one bitmap source or `vector` for one vector source. Category controls menu placement independently of input kind. |
| `outputs` | A unique list containing `"vector"`, `"bitmap"`, or both. Every returned item must use a declared output kind. |
| `controls` | Optional array of parameter controls. Omit it or use `[]` for a command with no settings. |

Unknown fields are rejected to catch spelling mistakes. Two installed files with the same ID are both unavailable until their IDs are made unique. Do not add `author`, permission declarations or other planned fields until they are part of the implemented schema.

## Properties controls

Every control has a unique `key`, a `label`, a `type` and a `default`. Keys start with a letter and contain letters, digits or underscores. Use their keys to read values from `parameters`.

| Type | Additional fields |
| --- | --- |
| `number` | Required numeric `min`, `max`; optional positive `step` and text `unit`. |
| `slider` | Same fields as `number`. |
| `boolean` | Boolean default; displayed as a checkbox. |
| `select` | `options: [{"label":"Friendly name","value":"value"}]`; default must match an option value. |
| `pen` | String default (usually empty); optional `suggestedColor` six-digit hex. Dropdown lists configured real pens; a unique exact colour can be suggested. Missing saved IDs require a new explicit choice. |
| `text` | Text default; optional `multiline: true`. |
| `colour` | Six-digit hexadecimal default such as `#224466`. |

At most 32 controls are allowed. Defaults and submitted values are validated by TerraForge. Labels, help and errors are rendered as text; plugins cannot insert HTML or React components. Reset restores the defaults declared by the file.

## Input, output and coordinates

The function receives:

```text
input = { kind: "none", page: { widthMM, heightMM } }
parameters = values from the declared controls
context = { runId, signal, progress, seed }
```

The page dimensions are the active page template dimensions, or the machine bed dimensions if no template is selected. They describe the available frame; they do not provide machine-control access. A generator should make its output fit that frame. TerraForge refuses artwork larger than it rather than silently scaling it.

Return an object containing positive `width` and `height` in millimetres and at least one polyline in `paths`. Coordinates are local millimetres with `(0,0)` at the top-left, X increasing right and Y increasing down. Points must lie within `[0,width] × [0,height]`. Each path needs at least two `{x,y}` points; `closed: true` connects the last point to the first. Optional `color` is a six-digit hex colour. Omitted colour is black.

TerraForge creates the SVG paths, IDs and machine-origin placement. Return geometry rather than SVG markup, G-code or document IDs. It preserves the declared full frame, including empty margins. Curves can be approximated with polylines for this first stage.

Optional `warnings` is an array of text messages. This original single-vector return format remains supported for API-1 plugins. A successful generator can add its artwork directly or use the optional Preview action. Reopening the saved layout does not run the plugin. You can edit vector artwork normally; regeneration replaces manual changes to its generated paths.

### Selected-input processors

The supplied snapshot is detached from the document. A plugin can read its copy; changes to that copy never alter the canvas. `input.kind` matches the manifest's declared input.

```text
bitmap = {
  kind: "bitmap", page, palette, sourceId, width, height, placement,
  widthPx, heightPx, data: Uint8Array
}
vector = {
  kind: "vector", page, palette, sourceId, width, height, placement,
  paths: [{ points: [{x,y}, ...], closed?, color?, penId? }]
}
placement = { x, y, scale, scaleX?, scaleY?, rotation }
palette = [{ id, name, color }, ...]
```

Bitmap bytes are row-major RGBA8 in sRGB, with straight alpha. Each pixel uses four bytes. Fully transparent pixels have zero RGB. Pixel edges span `[0,widthPx] × [0,heightPx]`, with a top-left origin, X right and Y down. Bitmap `width` and `height` are its full pixel frame. A plugin should explicitly choose how transparent pixels contribute to its algorithm; the scanline example composites them over white.

Vector snapshots contain visible paths flattened to polylines in the source item's local frame. A nonzero source viewBox offset is removed from the points. `width` and `height` retain the complete source frame, including blank margins. The host supplies the effective source/pen colours. Path selection and multiple-item processing are not supported.

Keep every processor output's `width` and `height` equal to the input frame. Do not crop output to its occupied bounds, apply the placement transform yourself or convert to machine-origin coordinates. TerraForge preserves the source's position, rotation and independent X/Y scaling. A bitmap output may change `widthPx`/`heightPx` while retaining the same physical source frame; the host adjusts its pixel scale.

### Multiple results and bitmap output

Return one or more structured items:

```javascript
return {
  items: [
    { kind: "vector", name: "Outlines", width: input.width, height: input.height,
      paths: [{ points: [{ x: 0, y: 0 }, { x: input.width, y: input.height }] }] },
    { kind: "bitmap", name: "Processed image", width: input.width, height: input.height,
      widthPx: input.widthPx, heightPx: input.heightPx, data: new Uint8Array(input.data) }
  ],
  warnings: ["Optional explanation"]
};
```

Raster output is a tightly sized `Uint8Array` or `Uint8ClampedArray` of `widthPx * heightPx * 4` bytes. Shared buffers, image URLs, encoded images and executable SVG are not accepted. TerraForge validates pixels and geometry, encodes bitmap output to portable PNG assets and assigns all document IDs. The original source stays untouched.

All applied items share a named output-group identity in their saved plugin provenance. This processing group is separate from the document's pen groups: a result can contain several pen assignments without a single output-group colour replacing them. Apply and updates commit the entire result, its assets and pen assignments in one undo step.

### The user's pen palette

`input.palette` is the user's configured pen list, including stable `id`, `name` and six-digit `color`. It is available to generators and processors. A vector path may return `penId` from this supplied list. TerraForge assigns that geometry to the corresponding real pen and uses its colour in the preview and normal vector/G-code workflow. Unknown pen IDs are rejected. A path with only `color` keeps that source colour. Processor output is not overwritten by the currently active single pen.

Use the palette in your algorithm to choose colour layers, match sampled image colours or change line density. The API does not prescribe one colour-matching or stylisation method. The [Bitmap Scanlines example](examples/bitmap-scanlines.tf-plugin.js) supplies a deliberately simple nearest-RGB demonstration, not a production artistic vectoriser.

### Preview and stale results

Processor tools use **Preview → Apply artwork**. A preview is temporary display content and cannot be saved, selected, exported or plotted. Cancel preview or close the panel to discard it. Minimising the panel keeps its current valid preview. Editing settings, the source, selection, document, page, machine or pen palette invalidates outdated work; run Preview again before applying.

Saved provenance includes plugin/version/settings, the seed, source reference/revision and output-group identity. A processor update resolves that saved source rather than silently processing whichever item happens to be selected. Missing sources are explained. There is no automatic effects stack and opening a layout never runs saved plugin code.

## Progress, cancellation and limits

Call `context.progress(0..100)` for measurable progress, or `context.progress(null)` while the amount of work is unknown. Avoid posting an update for every point. The host supplies a numeric `seed`; use it in your own seeded random generator when repeatability matters. `Math.random()` is not automatically seeded.

`context.signal` is an AbortSignal for cooperative code. TerraForge also stops the isolated runtime on cancellation or timeout, including a tight loop that never checks the signal. A cancelled, failed or expired run adds no artwork. A result is also discarded if the document, page or active machine changes while it is calculating.

Current bounds:

- One plugin file: 1 MiB; JSON header: 64 KiB; plugin files per folder: 256.
- Standard capacity: at most 10,000 output paths and 100,000 points in total. Extended 6×: at most 60,000 paths and 600,000 points, selected explicitly in Properties.
- At most 16 result items and 16 × 1,024 × 1,024 bitmap pixels in total per result; each pixel dimension is at most 8,192. Input bitmap snapshots have the same pixel limits.
- Width and height: greater than zero and no more than 10,000 mm, then checked against the current page.
- Runtime deadline: 30 seconds for Standard, 180 seconds for Extended 6× in an installed app.
- At most 20 warnings, each no more than 512 characters.

A plugin is a self-contained JavaScript ES module. Pure JavaScript library code can be bundled into that file beforehand. Runtime npm packages, Node imports, Python, arbitrary files, network requests, shell commands, the application bridge and direct DOM/store access are unavailable. Plugins cannot control or upload to the plotter. This is a restricted computation host, not a claim that arbitrary downloaded code is harmless.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Plugin missing | Check the folder opened by TerraForge, the exact `.tf-plugin.js` suffix and choose Rescan Plugins. |
| Unavailable plugin | Read the filename and reason in Plugins; check header JSON, unique ID and `apiVersion`. |
| Disabled | Tick its Enable checkbox. Disabling is remembered after restart. |
| File changed since startup or scan | Choose Rescan Plugins to load the edited file. |
| Syntax/runtime error | Check JavaScript and the returned object; no partial artwork is applied. |
| Artwork too large | Reduce the dimensions to fit the current page/bed. |
| Select one bitmap/vector | Select exactly one compatible source item, then reopen the processor from Plugins. Group, multiple-item and path-only selections are not processor inputs. |
| Missing source | Restore the original source item to update this result, or select another source and start a new operation from Plugins. Saved results remain usable. |
| Preview disappeared | Settings or document context changed. Preview again before applying. |
| Timeout | Reduce the work or point count. Use Cancel plugin to stop an active run. |
| Sandbox unavailable | Run a supported desktop configuration with Electron sandboxing enabled. The plugin runtime does not run with global `--no-sandbox` flags. |

The broader roadmap is in [the design proposal](plugin-engine-design.md). [Stage 1](plugin-stage-1.md), [Stage 2](plugin-stage-2.md) and [Stage 3](plugin-stage-3.md) record the milestone boundaries and verification. Example processor files are in [examples](examples/README.md).

### Ordered real-pen outputs

Structured vector items may additionally declare `penId` from the supplied palette and `plotOrder` (integer 0–15). Item-level `penId` supplies the real pen for every path; conflicting per-path IDs are rejected. A vector item with a real item-level pen may have `paths: []`, preserving an empty channel without dummy marks. Legacy single-vector results still require nonempty paths.

`plotOrder` persists in saved plugin provenance and takes precedence over colour batching in combined and per-pen export. Unordered geometry precedes ordered passes; optimization remains inside ordered pen batches, and path joining is disabled for ordered jobs to preserve exclusions. Per-pen filenames include their pass number. Colour/SVG-layer split export and vinyl mode are rejected for ordered artwork with guidance to use combined or per-group pen output. Pen ID markers identify the ink; they do not operate a pen changer. These optional API-1 extensions do not change legacy plugin output. See [CMYK Circles](cmyk-circles.md).

### Host-selected artwork capacity

Properties offers Standard (10,000 paths / 100,000 points / 30 seconds) and Extended 6× (60,000 paths / 600,000 points / 180 seconds). Standard remains the default for old requests and saved results. The optional request/provenance field `detailBudget` is `standard` or `extended`; unknown values are rejected. Every result-validation boundary uses the host-approved request allowance. Plugins cannot raise it in returned output.

The frozen `context.limits` supplies `{ paths, points, executionMs }`. Algorithms that honor it can use the larger allowance; existing plugins with their own lower internal caps remain compatible but do not automatically become more detailed. CMYK Circles honors these limits while retaining Standard behavior on older hosts. Source-pixel/image limits and the 96 MiB saved-layout limit are unchanged. Capacity changes invalidate previews, and the chosen allowance is saved/restored with the output.
