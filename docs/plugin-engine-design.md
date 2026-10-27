# TerraForge plugin engine and bitmap support — proposed design

Date: 27 October 2026 (New Zealand)
Review baseline: fork `shaboomi/terraForge`, main commit `5e554c6d5823f36214a5bed4982057ec5e5e71e8`.
Status: this change implements the Stage 1 generator engine; bitmap import and processing remain planned. See [the Stage 1 scope](plugin-stage-1.md) and [the author guide](plugin-author-guide.md) for the current supported contract. This document retains the full proposed roadmap; its bitmap inputs, preview/apply and broader v1 contract describe later capabilities rather than Stage 1 features.

## Decisions already agreed

- User plugins use JavaScript in the first release.
- A bitmap-to-vector plugin adds separate vector artwork and keeps the original bitmap.
- A user can save a plugin file in a plugin directory and see it after the next TerraForge launch.
- Plugins are organised into categories, initially Bitmap Processors, Generators and Font Tools.
- A plugin's optional controls appear in the right pane under Properties.
- Detailed artistic/vectorisation algorithms will be specified later.

## Proposed experience after the bitmap stages

1. Choose Plugins → Open Plugin Folder.
2. Save a self-contained `my-tool.tf-plugin.js` file in that folder.
3. Restart TerraForge. A valid plugin appears in its category.
4. Import a PNG or JPEG, then position and size it on the canvas using normal object controls.
5. Choose a compatible plugin. Its controls open under Properties.
6. Choose Preview to inspect temporary output, then Apply to add the finished artwork.
7. The original bitmap remains available. One Undo removes the entire applied result.

A plugin without controls offers a Run action; a successful run adds its output as one undoable edit. Saving a plugin file makes its metadata discoverable; its computation runs only when the user invokes it.

## Architecture review

The current Electron / React / Zustand separation is suitable for this feature. The essential addition is a stable document and computation boundary; plugin code should not reach into application internals.

| Area | Current source and finding | Required extension |
| --- | --- | --- |
| Canvas model | `src/types/index.ts:316`: `SvgImport` requires vector paths and SVG dimensions | Common positioned canvas item with explicit vector and bitmap variants |
| Document/store | `store/canvasStore/slices/importSlice.ts:13,150`: normalisation and projection assume vectors | Shared item operations, plus vector-only processing and export |
| Visible artwork | `features/canvas/components/ToolpathOverlay.tsx:160`, `features/canvas/utils/toolpathOverlayDraw.ts:41`: Canvas2D draws artwork | Bitmap image drawing/cache and explicit stacking order |
| Hit testing | `features/canvas/components/ImportLayer.tsx:37`: SVG rectangles handle interaction | Reuse selection/drag/scale/rotation for both item types |
| File import | `src/main/ipc/fs.ts:17,94` and `features/imports/hooks/useImportActions.ts:449` | Explicit PNG/JPEG binary import and unsupported-format handling |
| Properties | `components/PropertiesPanel.tsx:15` is a small composition point | Add active plugin controls independently of the layers body |
| Empty canvas | `features/properties-panel/components/LayersPanelContent.tsx:158` hides existing content when empty | Generator controls must remain available on an empty document |
| Saved layout | `src/types/index.ts:399`, `features/layout/hooks/useLayoutActions.ts:35,81`: version 1 JSON, shallow validation | Version 2 schema, bitmap assets, complete validation and v1 migration |
| Undo | `store/canvasStore.ts:17`, `slices/undoRedoSlice.ts:23`: snapshots clone imports; groups are outside snapshots | Atomic transactions covering items, generated groups and metadata |
| Tasks | `src/tasks/taskManager.ts`, `components/TaskBar.tsx:57` | Reuse progress/error/cancel presentation; add guarded plugin-run lifecycle |
| Process boundary | `src/preload/index.ts:224–234` exposes the normal file/machine bridge; `src/main/bootstrap/window.ts:30–33` sets sandbox false | Dedicated restricted plugin runtime without the normal app bridge |
| Plot output | `store/canvasStore/services/vectorObjects.ts:99` projects paths to vectors | Bitmap references are excluded; generated vectors use the current G-code pipeline |
| Packaging | `package.json:133` packages `out/**/*` | Bundle runtime resources/templates; keep user files outside installed application |

Paths beginning with `components/`, `features/` or `store/` above are relative to `src/renderer/src/`.

## Broader proposed plugin contract

This section is a roadmap for later bitmap and processing capabilities. The implemented Stage 1 contract is the [author guide](plugin-author-guide.md): no selected input, vector polyline output and existing version-1 vector layout saves.

### File and discovery

- One UTF-8 JavaScript ES module per plugin, with the suffix `.tf-plugin.js`.
- Directory: `join(app.getPath("userData"), "plugins")`, resolved by TerraForge. Open Plugin Folder reveals the actual location; users do not need to find AppData themselves.
- The directory survives application upgrades. Development/test runs use an isolated directory so they do not disturb installed plugins.
- Startup scans this directory, with deterministic ordering. No watcher, installer or hot reload is needed for v1.
- A strict JSON header comment supplies metadata. The discovery scanner parses data without evaluating the JavaScript.
- A default exported `run(input, parameters, context)` function performs computation when invoked. The exact JSON header marker is fixed in the author guide when the API is implemented.
- Plugin files are self-contained. No runtime npm installation, Node imports, Python runtime or direct TypeScript execution in v1.
- Authors may bundle pure JavaScript dependencies into their file, subject to the same runtime restrictions.
- File size and metadata size are bounded. Accept regular files only; do not follow links outside the plugin directory.
- Duplicate IDs, malformed metadata and incompatible API versions are listed with an actionable reason. They do not prevent startup or hide unrelated plugins.
- The manager supports enable/disable and shows filename, name, version, category and load/run errors. Disabled plugins are never executed. Removing a file removes its entry at the next launch.

### Metadata

Required: stable ID, display name, plugin version, engine API version, category, description, accepted input and declared output kinds.

Optional: author, parameter-schema version, controls, help text and deterministic-seed support.

The initial category IDs are `bitmap-processor`, `generator` and `font-tool`. Category controls menu placement; input/output declarations control eligibility. A Font Tool can be a generator or a processor. Additional categories can be added through the registry without changing the document model.

API version 1 is an explicit supported integer. Unsupported versions are rejected clearly; changing a plugin's own version does not imply an engine API change.

### Input and selection

The v1 API supports no input, one selected bitmap, or one selected vector item. Arbitrary mixed/multiple selection and per-path processing are later extensions.

- Generators run without a selection and receive page dimensions, placement context and parameters.
- Bitmap processors require one bitmap.
- A tool accepting vectors receives a read-only path snapshot, not a store reference.
- Text is a parameter value, not a new editable document object.
- Ineligible commands explain why, for example: “Select one bitmap to use this plugin.”

A run receives an immutable snapshot with document/session ID, input item ID/revision, source-local frame, placement transform, relevant page dimensions and approved asset data. It cannot mutate the canvas while calculating.

### Controls in Properties

TerraForge renders standard controls from a declaration supplied in metadata:

- Number and slider: default, min/max, step and optional unit.
- Checkbox.
- Choice/select.
- Text and multiline text.
- Colour.
- Headings, groups and help text.

Every parameter has a stable key, label, type and default. TerraForge validates the declaration and values. No arbitrary HTML, React components or direct DOM/store access in v1.

One active plugin panel appears beneath the Properties heading while normal item controls remain available. Controls use a vertical layout suited to the current 256-pixel pane and work on an empty canvas.

Preview, Apply, Cancel and Reset are host actions. Editing parameters does not change the document. Preview is optional for simple panel-free commands. Parameter defaults may be remembered per plugin, and applied values are saved with output provenance.

### Results and lifecycle

Logical API:

```text
run(inputSnapshot, parameters, context) → PluginResult
context: run ID, progress(percent or unknown), cancellation signal, seed
result: vector items and/or bitmap data, source frame, warnings
```

- Vector output is structured paths plus optional layers/colours. It contains no executable SVG markup, scripts, file paths or custom UI.
- Raster output is validated RGBA pixel data with dimensions and an explicit frame. TerraForge encodes it as a lossless PNG asset for portable saves, preserving alpha; plugins do not need to supply image codecs.
- The host assigns document IDs and translates validated results into normal canvas items.
- A plugin result is artwork, not G-code. Machine control, uploads, arbitrary file writes, network access and shell commands are outside v1.
- Preview is an overlay excluded from save files, plot export and undo history.
- Apply atomically creates new items and a named output group. The original input remains intact.
- Source ID/revision, document/session ID, parameter generation and run ID are checked before use. Results from old previews, changed/deleted sources or closed documents cannot silently apply.
- Cancel, failure, crash and timeout leave the document unchanged. A run reaches a terminal state once; late messages are ignored.
- The supervisor must terminate a tight loop without needing the plugin to cooperate.
- Store plugin ID/version, API/parameter versions, parameters, seed and source references as provenance. Reopening never automatically executes saved plugin code.
- Generated vector artwork remains editable and plottable when its plugin is absent or disabled. Generated bitmaps remain ordinary bitmap items and require vector conversion for plotting. V1 does not promise a live effects stack or automatic regeneration.

## Bitmap foundation

### Supported import and editing

Guarantee PNG and JPEG (`.png`, `.jpg`, `.jpeg`, case-insensitive) initially. Additional formats such as WebP and BMP should be separately tested and added explicitly; “etc.” must not mean every image format is silently accepted.

Preserve PNG transparency. Apply JPEG orientation before reporting dimensions or exposing pixels. Report corrupt, unsupported and oversized files clearly.

Each bitmap has an immutable asset reference and common item properties: ID, name, visibility, position, local dimensions, uniform/per-axis scale, rotation and stacking order. Properties shows physical width/height in millimetres, with aspect ratio locked initially. Include move, resize, rotate, show/hide, delete, copy/paste, alignment and ordinary grouping.

Use the existing SVG default of 96 pixels per inch for initial physical sizing, with large images uniformly fitted to the usable page/bed. Exact millimetre dimensions remain editable. This is a placement convention, not a promise that a photograph's metadata reflects its intended printed size.

### Assets, saves and history

Keep encoded image assets separate from mutable item state. Decode/cache images for display, and release unused display resources. History and clipboard retain asset references instead of copying full pixel buffers for every edit.

Propose a version-2 `.tforge` JSON document with vector/bitmap items, an embedded deduplicated asset table and output provenance. Encoded assets make files portable if the original PNG/JPEG moves or is deleted. Base64 increases saved size, so enforce encoded-file, decoded-pixel, total-document and output-geometry limits. Concrete budgets must be measured and fixed before release.

Read version-1 files through a migration that preserves all existing vector transforms. Validate the whole document before replacing current content. Reject unsupported newer versions clearly. Do not silently reinterpret them as version 1.

Undo/redo covers items, generated groups and associated metadata as one transaction. Asset cleanup must account for references held by undo, redo and clipboard.

### Coordinates and vector alignment

Define bitmap pixels as row-major RGBA8, sRGB, straight/unpremultiplied alpha, top-left origin, X right and Y down. State exactly how fully transparent pixels are interpreted; plugins may choose a background parameter.

Pixel edges span `[0,widthPx] × [0,heightPx]`. A bitmap processor returns vector paths in this full source-local frame. TerraForge preserves the input's position, per-axis scale and rotation. A result with changed raster dimensions must declare how its frame maps to the input.

Do not feed results through normal file-import cropping/auto-placement. `useImportActions.ts:275–317` tight-crops imported SVGs, which would change margins and rotation centres. Retain the full bitmap frame even when output paths occupy only part of it.

TerraForge applies the drawing-origin/machine transform once, through the existing vector pipeline. Plugin authors do not need to handle FluidNC origin variants.

Bitmap images serve as reference/processing inputs. They never directly generate machine paths. Raster-only documents explain that vector artwork is required for plotting; mixed documents plot only visible vector content.

## Plugin execution boundary

Stage 1 uses a dedicated sandboxed Electron computation host, a plugin worker and a main-process supervisor outside both the worker and its renderer. The broader bitmap and processing capabilities in this proposal need additional validation as they are introduced.

- No ordinary TerraForge preload or `window.terraForge` bridge.
- Node integration disabled, context isolation enabled and sandbox explicitly enabled.
- Narrow typed message protocol; validate sender, run ID, message shape and payload size.
- Dedicated restrictive session/content policy: block network, navigation, popups and permission requests.
- No arbitrary filesystem access. Only host-supplied snapshot/asset data crosses the boundary.
- Validate results before previewing or committing them, including finite coordinates, permitted path syntax, dimensions, array lengths and resource limits.
- Do not relax the main application's content policy to load plugins.
- Destroy runtimes on cancellation, document close and app shutdown. Hidden hosts must not keep the app alive or interfere with macOS main-window activation.

A worker alone does not establish the full permission boundary. Electron's official [sandbox documentation](https://www.electronjs.org/docs/latest/tutorial/sandbox) describes privileged operations being delegated through IPC; its [security guidance](https://www.electronjs.org/docs/latest/tutorial/security) calls for restrictive policies and validated IPC senders. The proposed host still needs a focused prototype and packaged-build tests. No claim of safe execution of arbitrary untrusted code is made by this review.

## Font Tools scope

The existing SVG importer skips live text and asks users to convert it to outlines (`useImportActions.ts:176,328`). A category and text control do not supply a font renderer.

V1 supports text parameters and ordinary vector output. A plugin can embed its own small stroke alphabet or bundled pure-JavaScript font logic. Installed-font discovery, host-provided TTF/OTF files, shaping/kerning/complex scripts, editable text objects and text-on-path need separate requirements. A host-controlled font-asset picker is a possible later capability.

## Suggested build order

1. Prove the execution boundary, single-file metadata scan, lifecycle/cancellation, packaging and one simple generator. Finalise API version 1 after this spike.
2. Add the shared canvas-item model and PNG/JPEG assets; extend rendering, interaction, Properties, history and versioned save/load.
3. Connect plugin input snapshots and raster/vector results to the document transaction layer; complete Properties controls, preview and stale-result handling.
4. Deliver small demonstration plugins and an author guide. Use a rectangle/grid generator, a bitmap greyscale/invert example, and a minimal bitmap-to-path example to prove alignment and plotting. A panel-free command proves controls are optional.
5. Specify and implement the actual stylised-vector and font plugins after the engine meets the acceptance checks.

Application implementation remains TypeScript, React 19, Zustand and Tailwind, with shared interfaces in `src/types/index.ts` and typed IPC. Suggested module homes: `src/main/plugins/`, `src/renderer/src/features/plugins/` and a bundled isolated computation-host entry. Keep algorithms out of toolbar/store internals.

## Acceptance checks before calling the engine complete

- A saved valid plugin appears in the right category after restarting a packaged build.
- A generator works on an empty canvas; a bitmap processor explains unsupported selections.
- Missing controls, disable/remove, duplicate IDs, bad metadata, syntax errors and incompatible versions behave predictably.
- Long-running plugins keep the UI responsive. Cancel, timeout, crash and late messages never change the document.
- Preview never changes saved content or history. Apply creates exactly one undo step, including generated groups.
- PNG alpha and oriented JPEGs import correctly; corrupt and oversized inputs fail clearly.
- Moving/resizing/rotating, non-uniform scaling, ordering, copy/paste and undo/redo preserve bitmap content and placement.
- Output overlays the source correctly with empty margins, rotation and non-uniform scale; check every supported machine origin.
- Bitmap-only and mixed scenes export appropriately. Existing vector G-code output remains unchanged.
- Version-1 layouts retain geometry. Version-2 layouts reopen with embedded images after source files and plugins are removed.
- Runtime resource and permission boundaries are tested in installed Windows builds and then on every other platform claimed as supported.
- Regression checks cover existing SVG/PDF import, Properties, grouping, task cancellation and machine-control workflows.

## Remaining decisions

The agreed JavaScript/source-preservation decisions above are settled. Defaults proposed for the next implementation are manual Preview then Apply, PNG/JPEG first, structured controls and one selected input. The implemented Stage 1 limits and runtime contract are documented in the author guide; extensions for bitmap and processing workloads need their own resource-budget validation. Detailed bitmap stylisation and font algorithms remain deliberately open for later requirements.
