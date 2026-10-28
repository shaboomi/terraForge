# Plugin processing — Stage 3

Stage 3 connects local JavaScript plugins to selected bitmap and vector artwork. The original source stays on the canvas and generated results are added separately.

The initial scope includes manual Preview and Apply, atomic undo/redo for complete results, saved settings and source references, portable bitmap output and preservation of source-frame alignment. Detailed artistic filters and font services follow later.

User-configured pens form the palette for colour-aware plugins. Generated pen assignments must survive preview, apply and save/open without being replaced by the active single pen.

## Try a processor

1. Start TerraForge and choose **Plugins → Open Plugin Folder**.
2. Copy the `.tf-plugin.js` files from [the examples folder](examples/README.md) into that folder, then restart TerraForge. **Add Example Generator** continues to install the existing grid generator only.
3. Import a PNG or JPEG and select the image itself. Set its width, height, position and rotation using Properties.
4. Choose **Plugins → Bitmap Filters → Bitmap Tones**. Its controls appear under Properties and the menu closes. Choose Greyscale or Invert, then **Preview**.
5. The canvas labels the temporary preview. Choose **Cancel preview** to discard it, or **Apply artwork** to add a separate bitmap. The original image remains unchanged.
6. Select a generated result and choose **Edit with Bitmap Tones**. Change its settings, choose **Preview**, then **Update artwork**. This replaces the preceding generated result together. One Undo restores the whole previous result.

**Bitmap Scanlines** demonstrates bitmap-to-vector output. Row spacing and Darkness threshold control the example's simple horizontal marks. **Match my pens** compares sampled colours to the pens defined in **Pens** and assigns the marks to those real pen groups. Add at least two different pens and use a colour image to see multiple vector colours. Without configured pens it returns black vector marks. This is a small engine example; it does not implement DrawingBotV3's artistic algorithms.

**Reverse Vectors** demonstrates one selected vector as input and a plugin with no parameter controls. Find it under **Plugins → Generators**, labelled **Vector input**. Bitmap-to-vector tools such as **Bitmap Scanlines** and **Spiral Sawtooth** are under **Plugins → Bitmap to Vector**. The menu uses existing input/output metadata; plugins explicitly categorised as font tools appear under **Font Tools**. See [the Plugins menu guide](plugins-menu.md).

## Preview, Properties and editing

Preview is display-only: it is excluded from layout saves, clipboard, hit testing, plotting and undo/redo. Apply commits the complete result as one history step. Cancelling, failing or timing out adds no partial items or assets. Outdated work is rejected after settings, selection, document, source, page, machine or pen changes. Preview again before applying.

When updating an existing result, its old items are temporarily replaced on screen by the preview. They remain unchanged in the document until Apply. Copying an individual result creates an independent output-group identity so editing the copy cannot replace the original group.

Minimise keeps the current valid preview and saved control values. Closing the panel cancels work and clears the preview while retaining artwork already applied. Select an applied result and use its **Edit with** action to reopen the controls after closing or saving/reopening a layout.

Each generated result stores a named processing-group identity, saved settings and source reference in its items' plugin provenance. This result group is independent of the existing pen groups. A multi-colour result can therefore keep several pen assignments. Updating one of its members replaces the result group together; it does not replace the source. Updates regenerate paths and do not retain manual changes to generated geometry.

The exact plugin version must still be installed and enabled to rerun it. A processor needs its original canvas source; a missing source is explained instead of silently using the current selection. Saved results remain ordinary usable artwork when the plugin is missing. Opening a layout never runs plugin code.

## Coordinates and saved data

Input is a detached snapshot of one complete bitmap or vector item. Output retains that item's full frame, including blank margins, and preserves position, rotation and independent X/Y scaling. It bypasses normal file-import cropping and auto-placement. All machine-origin handling stays in TerraForge's normal vector pipeline.

Bitmap snapshots use row-major, straight-alpha RGBA8 pixels in sRGB; transparent RGB is zero. Bitmap output is encoded by the host to an immutable PNG asset. A changed pixel resolution retains the same physical source frame. Applied images and plugin provenance save in the portable version-2 layout alongside the original image; original image files are not needed when reopening.

Existing API-1 generator files and their original single-vector result format continue to work. The author guide describes [selected inputs, multiple results and the pen palette](plugin-author-guide.md#selected-input-processors).

## Verification boundary

Stage 3 verification covers input/output validation and resource budgets; source-frame alignment across every supported machine origin; empty margins, rotation and non-uniform scaling; preview isolation; atomic apply/update undo and redo; portable saves; pen assignments; stale-result rejection; cancellation, timeout and runtime errors. Desktop and packaged checks use disposable profiles and do not operate a physical plotter.

Detailed stylisation, alternative path-finding filters, installed-font loading/shaping, editable text, multiple selected inputs and an automatic effects stack remain later milestones. The plugin input/output and pen-palette contracts provide their foundation without selecting those artistic algorithms in advance.

## Verification record — 28 October 2026 (New Zealand)

Verified on Windows x64 with Electron 40.6.0, starting from the merged pen/page update in PR #5:

- TypeScript checks and the production build passed. The changed implementation, test and package-check files have no ESLint errors, and `git diff --check` passed.
- All 1,873 unit/component tests passed across 169 files. Focused checks cover bounded input/output, source frames across all five origins, raster resampling, transparent pixels, pen partitions, provenance, complete-result undo/redo and stale/cancelled work.
- 77 unique desktop checks passed: the 76-case bitmap/plugin/processing/pen/layout/SVG/PDF/Properties run plus the vector-processor workflow. The final five processing workflows were rerun together against the final build and all passed.
- The unsigned Windows directory application at `release/stage-3/win-unpacked/terraForge.exe` passed all five packaged processing workflows. Each launch verified `app.isPackaged` and its disposable user-data directory before acting.
- Packaged checks processed real RGBA bitmap data, preserved a rotated/non-uniformly scaled source, previewed without changing saves or plotting, applied bitmap plus two configured-pen vectors atomically, undid/redid the complete result, restored saved controls and stable result IDs, reopened without the plugin, rejected outdated work, cancelled a tight loop, and processed vector curves with viewBox offsets and no parameter controls.
- Canvas pixels changed during preview while saved artwork remained unchanged. Screenshots were inspected for preview controls, alignment, separate bitmap output and White/Red pen assignments. Temporary test applications closed and their test directories were removed.

To reproduce from the project folder after installing dependencies:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright test --config=tests/e2e/playwright.config.ts tests/e2e/plugin-processing.spec.ts
npm.cmd run package -- --win --x64 --config.directories.output=release/stage-3
npm.cmd run test:processing-package
```

The packaged check accepts a different Windows executable as an optional argument:

```powershell
npm.cmd run test:processing-package -- .\path\to\terraForge.exe
```

This validates the unpacked unsigned Windows application, not an NSIS installation. macOS, Linux and physical plotting were not tested locally for Stage 3.
