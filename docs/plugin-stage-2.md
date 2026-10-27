# Bitmap import and portable layouts — Stage 2

Stage 2 adds PNG and JPEG images as positioned bitmap objects alongside existing vector artwork. It extends the document foundation for future bitmap-processing plugins; bitmap-to-vector conversion and new artistic algorithms are not part of this stage.

These notes record Stage 2. [Stage 3](plugin-stage-3.md) subsequently connects selected artwork to processor plugins, previews and separate generated results.

## Import and place an image

1. Choose **Import** and select a `.png`, `.jpg` or `.jpeg` file. Uppercase extensions work too.
2. The image appears on the canvas and is selected in **Properties**, with its pixel dimensions and a Bitmap badge.
3. Enter physical width/height in millimetres, move it with X/Y or the canvas handles, and rotate it using the ordinary object controls. Aspect ratio starts locked. Unlock it to set width and height independently.
4. Use **Opacity (%)** to make a reference image more transparent. Show/hide, delete, copy/paste, alignment and layer-group assignment work with bitmap items.
5. Save a `.tforge` layout to keep the image and its placement together.

The initial physical size uses 96 pixels per inch. An image larger than the usable active page/bed is reduced uniformly to fit, including the active page margins. Small images are not automatically enlarged. The pixel dimensions remain unchanged: changing physical size does not resample or overwrite the original pixels.

PNG transparency is preserved. JPEG camera orientation is applied before TerraForge reports the image's pixel dimensions or saves its normalised pixels. Images are stored internally as lossless PNG assets, including imported JPEGs. This removes reliance on orientation metadata when reopening the document.

## What is saved

New layouts use version 2 of the `.tforge` JSON format. They contain vector/bitmap items and an embedded asset table. Identical normalised image assets share the same content identifier, so copying an image does not duplicate its encoded pixels in the saved asset table.

The layout is portable: it still opens if the original image is moved or deleted. It does not rely on absolute source-image paths. Existing version-1 vector layouts are migrated when opened without changing their vector geometry or transforms, and subsequent saves use version 2. Older TerraForge releases may not understand the new format; use this updated build for bitmap layouts.

Image assets are immutable. Position, scale, rotation, opacity and visibility live on the canvas item. Undo/redo and clipboard operations retain asset references instead of copying decoded pixels on every edit. Group/item/document changes use the extended document history.

## Plotting and plugins

A bitmap is reference artwork and input material for later processing. It never directly becomes machine paths. **Generate G-code** is disabled for a raster-only scene; mixed scenes generate paths from their visible vector artwork. Adding a bitmap does not change the vector machine commands.

The existing JavaScript generator API continues to work. Bitmap and vector processor input declarations remain unavailable until their next implementation milestone. Stage 2 does not add tracing, stylisation, automatic conversion, raster plugin output, preview overlays or a font-rendering service.

Generated vector items still support **Edit with [plugin name]**, saved parameter restoration, **Update artwork** and one-step undo as described in [the author guide](plugin-author-guide.md).

## Input validation and limits

TerraForge reads a bounded file and inspects PNG/JPEG dimensions before decoding pixels. Invalid headers, unsupported formats, corrupt decoder input and excessive dimensions are reported as import errors. A failed or cancelled import does not add a partial item or asset. If the current document/page changes during decoding, import again into the intended document.

| Budget | Limit |
| --- | --- |
| Source PNG/JPEG file | 20 MiB |
| Width or height | 8,192 pixels |
| Pixels in one decoded image | 16 × 1,024 × 1,024 |
| Encoded normalised PNG asset | 32 MiB |
| Total encoded image assets | 64 MiB |
| Total decoded pixels across retained unique assets | 32 × 1,024 × 1,024 |
| Saved layout input | 96 MiB |

A compressed image can be small on disk and still exceed the pixel budget. Reduce its pixel dimensions in an image editor before importing. Normalising a highly detailed JPEG to lossless PNG can also exceed the asset budget even when the source JPEG is under 20 MiB.

Cancel is available in the existing task toast during import. Browser decoding itself is not forcibly interrupted; its bounded result is discarded and temporary image/canvas resources are released before any document commit.

## Verification

The focused unit checks cover PNG/JPEG header parsing, pre-decode size/pixel rejection, cancelled imports and 96-PPI/page/origin placement. Desktop workflows use deterministic real PNG/JPEG fixtures to check transparency, EXIF orientation, transforms, opacity, copy/undo, visibility, grouping, asset deduplication, portable version-2 saves, version-1 migration, mixed vector plotting and invalid-file/layout handling.

Run from the project folder:

```powershell
npm.cmd run typecheck
npx.cmd vitest run src/renderer/src/features/imports/services/bitmapImport.test.ts
npm.cmd run build
npx.cmd playwright test --config=tests/e2e/playwright.config.ts tests/e2e/bitmap-import.spec.ts
```

The verification record below documents the tested build and packaged coverage. These checks do not send commands to a physical plotter.

## Verification record — 27 October 2026

Verified on Windows x64 with Electron 40.6.0:

- 1,753 unit/component tests passed across 153 files.
- 104 unique desktop workflows passed: 95 existing regression cases and the nine bitmap cases. These include real PNG alpha, real JPEG EXIF orientation, portable saves after source deletion, copy/undo/grouping and an exact comparison of vector-only versus mixed-scene machine commands.
- The final combined bitmap/plugin desktop rerun passed all 18 cases in 42.5 seconds, including the damaged compressed-asset rejection check.
- The malformed-layout workflow was rerun with an embedded PNG whose chunk checksums and dimensions are valid but whose compressed pixel stream is damaged. The browser decoder rejected it before document replacement; the original canvas and a subsequent saved layout were preserved.
- The final unsigned Windows directory build at `release/stage-2/win-unpacked/terraForge.exe` passed `npm.cmd run test:bitmap-package`. The script verified the packaged executable and exact disposable user-data directory before application actions.
- That packaged check imported an uppercase-extension PNG, set its width to 100 mm and opacity to 50%, checked actual rendered canvas pixels, saved its embedded asset, deleted only the temporary source image, restarted and reopened the layout, then verified the same asset, frame and placement. Raster-only plotting remained disabled; adding Example Grid made mixed vector plotting available.
- The smoke-test app closed and its verified temporary profile was removed. A screenshot was inspected to verify the bitmap, opacity controls and mixed vector artwork.

Re-run the check against the existing Stage 2 directory build:

```powershell
npm.cmd run test:bitmap-package
```

To check another packaged Windows executable, pass its path explicitly:

```powershell
npm.cmd run test:bitmap-package -- .\release\stage-2\win-unpacked\terraForge.exe
```

This verifies an unpacked, unsigned Windows application directory. The NSIS installer, macOS and Linux were not tested for Stage 2. These plugin/bitmap checks did not operate a physical plotter.
