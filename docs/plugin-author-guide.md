# Writing a TerraForge plugin (Stage 1)

The current JavaScript API adds generators that create ordinary, editable vector artwork. Stage 2 also adds PNG/JPEG canvas images and portable bitmap layouts; see [the bitmap guide](plugin-stage-2.md). Bitmap/vector processor inputs, raster plugin output, preview overlays and a font-loading service remain later stages. The category names are available, but a plugin requiring `bitmap` or `vector` input cannot run yet.

## Install your first plugin

1. Start TerraForge and choose **Plugins → Add Example Generator**.
2. Choose **Example Grid** in the Generators category. Its controls appear under **Properties**, even on an empty canvas.
3. Set Width, Height, Spacing and Border, then choose **Add artwork**.
4. Move, resize or rotate the resulting vector import using the normal controls. **Undo** removes the generated import in one step. You can save it in a `.tforge` layout and reopen it without the plugin installed.

To install your own file, choose **Plugins → Open Plugin Folder**, save a UTF-8 file ending in `.tf-plugin.js` there, then restart TerraForge. Use an editor such as Visual Studio Code. If you use Notepad, choose **Save as type: All files** so the filename does not become `.js.txt`.

The installed app uses the `plugins` folder inside its application data directory. Development uses a separate `plugins-dev` folder. Open Plugin Folder takes you to the correct one; you do not need to find AppData manually. Files in this folder survive application upgrades.

## Hide the panel and edit generated artwork later

Use **Minimise plugin panel** to keep a compact header, then **Expand plugin panel** to show its controls again. The **Close plugin panel** X hides the panel without deleting artwork already on the canvas.

To change an existing result, select the generated artwork and choose **Edit with [plugin name]** in Properties. TerraForge restores the settings saved with that item. Change the values, then choose **Update artwork**. This regenerates the same item rather than adding a second copy, keeps its placement/scale/rotation, and creates one undoable edit. Undo restores the preceding geometry and saved settings.

The same flow works after saving and reopening a `.tforge` layout. Keep the original plugin installed and enabled at the same version to reopen its controls. If it is missing, disabled or incompatible, Properties explains why editing with the plugin is unavailable; the saved vector artwork remains usable.

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

TerraForge reads the JSON header during startup without running the code below it. The JavaScript module is evaluated when you choose Add artwork. Syntax errors therefore appear when a plugin is run. If a file changes after startup, restart before running it; TerraForge will not silently run a different version from the one it discovered.

## Header fields

| Field | Meaning |
| --- | --- |
| `id` | Stable unique identifier, up to 100 characters: lowercase letters, digits and internal `.`, `_` or `-`. Keep it unchanged when releasing updates. |
| `name` | Display name in the menu and the generated import. |
| `version` | Plugin version in `major.minor.patch` form, for example `1.0.0`. |
| `apiVersion` | Must be `1` for this release. |
| `description` | Short explanation of the tool. |
| `category` | `generator`, `bitmap-processor` or `font-tool`; controls menu placement. |
| `input` | Use `none` for a runnable Stage 1 plugin. `bitmap` and `vector` are reserved for later selection-processing stages. |
| `outputs` | Must be `["vector"]` in Stage 1. |
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

Optional `warnings` is an array of text messages. A successful result adds one ordinary vector import. Its plugin ID, version and parameters are stored as provenance; reopening the saved layout does not run the plugin. You can edit the vector artwork normally. There is no live link that recalculates an existing result when settings change.

## Progress, cancellation and limits

Call `context.progress(0..100)` for measurable progress, or `context.progress(null)` while the amount of work is unknown. Avoid posting an update for every point. The host supplies a numeric `seed`; use it in your own seeded random generator when repeatability matters. `Math.random()` is not automatically seeded.

`context.signal` is an AbortSignal for cooperative code. TerraForge also stops the isolated runtime on cancellation or timeout, including a tight loop that never checks the signal. A cancelled, failed or expired run adds no artwork. A result is also discarded if the document, page or active machine changes while it is calculating.

Current bounds:

- One plugin file: 1 MiB; JSON header: 64 KiB; plugin files per folder: 256.
- At most 10,000 output paths and 100,000 points in total.
- Width and height: greater than zero and no more than 10,000 mm, then checked against the current page.
- Runtime deadline: 30 seconds in an installed app.
- At most 20 warnings, each no more than 512 characters.

A plugin is a self-contained JavaScript ES module. Pure JavaScript library code can be bundled into that file beforehand. Runtime npm packages, Node imports, Python, arbitrary files, network requests, shell commands, the application bridge and direct DOM/store access are unavailable. Plugins cannot control or upload to the plotter. This is a restricted computation host, not a claim that arbitrary downloaded code is harmless.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Plugin missing | Check the folder opened by TerraForge, the exact `.tf-plugin.js` suffix and restart. |
| Unavailable plugin | Read the filename and reason in Plugins; check header JSON, unique ID and `apiVersion`. |
| Disabled | Tick its Enable checkbox. Disabling is remembered after restart. |
| File changed since startup | Restart to load the edited file. |
| Syntax/runtime error | Check JavaScript and the returned object; no partial artwork is applied. |
| Artwork too large | Reduce the dimensions to fit the current page/bed. |
| Bitmap/vector processing message | Stage 1 runs generators only; those input types need the later document/bitmap work. |
| Timeout | Reduce the work or point count. Use Cancel plugin to stop an active run. |
| Sandbox unavailable | Run a supported desktop configuration with Electron sandboxing enabled. The plugin runtime does not run with global `--no-sandbox` flags. |

The broader roadmap and bitmap contract are in [the design proposal](plugin-engine-design.md). Stage 1's delivered scope is recorded in [the Stage 1 notes](plugin-stage-1.md).
