# Plugin engine — Stage 1

Stage 1 proves a directory-based JavaScript plugin engine using vector generators. It is the first implementation milestone in [the plugin/bitmap design proposal](plugin-engine-design.md), not completion of the entire bitmap and plugin roadmap.

These notes record Stage 1. The current processing workflow is documented in [Stage 3](plugin-stage-3.md).

## Included

- Discover one self-contained `.tf-plugin.js` file per tool at launch; read the JSON metadata header without executing plugin code.
- List tools under Bitmap Processors, Generators and Font Tools, with enable/disable and useful per-file errors.
- Open Plugin Folder and Add Example Generator actions. The explicit example install refreshes the list; ordinary file edits/additions require restart.
- Structured controls beneath Properties, including generators on an empty canvas and tools without settings. The panel can be minimised, expanded or closed without deleting generated artwork.
- Select existing generated artwork and choose Edit with its plugin to restore saved settings. Update artwork regenerates that same item in one undoable edit while preserving its position, scale and rotation, including after saving/reopening a layout.
- Run generators in a dedicated Electron sandbox host and worker, without the normal application bridge or Node integration.
- Host-controlled cancellation and a 30-second deadline; progress and errors in the existing task display.
- Validate input, parameters and vector results before adding ordinary editable vector imports. Add one result as one undoable edit.
- Keep generated artwork in existing `.tforge` saves, with plugin identity/version/parameters, independently of the plugin file.
- Refuse stale results when document/page/machine context changes.

## Following stages

Stage 2 adds PNG/JPEG import, image assets, the shared vector/bitmap canvas-item model and portable version-2 image layouts; see [the Stage 2 notes](plugin-stage-2.md). Bitmap/vector processing inputs, raster output, preview/apply overlays, atomic plugin multi-item/group changes and detailed stylised-vector algorithms remain later milestones. Font Tools currently means a category for generator code that supplies its own geometry; there is no installed-font browser, font shaping service or editable text object.

Stage 1 vector results are polylines in local millimetres. The later bitmap input contract must preserve the bitmap's complete source frame and placement so traced vectors align with the image. It must not reuse SVG file-import tight cropping or auto-placement.

## Try it

1. Open TerraForge, choose **Plugins → Add Example Generator**, then choose **Example Grid**.
2. Close the Plugins menu if it is still open. Adjust its controls under **Properties**.
3. Choose **Add artwork**. Move or resize the new import with normal controls.
4. Minimise or close the plugin panel when finished. Select the generated item and choose **Edit with Example Grid** to change its saved settings later, then choose **Update artwork**. Undo reverses the update in one step. Saving/opening a `.tforge` layout preserves this edit-again workflow.
5. To write your own plugin, follow [the author guide](plugin-author-guide.md). Save it in the folder opened by **Plugins → Open Plugin Folder**, then restart TerraForge.

No GitHub action is needed to install a local plugin. Follow [the author guide](plugin-author-guide.md) to create and install a file.

## Developer verification

Run the production build before launching the desktop workflow tests:

```powershell
npm run typecheck
npm run build
npx playwright test --config=tests/e2e/playwright.config.ts tests/e2e/plugins.spec.ts
```

The desktop plugin tests use unique temporary plugin/user-data directories. They cover restart discovery without top-level evaluation, generated artwork editing/undo/save/open, invalid metadata and duplicate IDs, persisted disable state, runtime permission probes against a real local HTTP endpoint, tight-loop cancellation and timeout cleanup. These tests require an Electron sandbox-enabled desktop host; they are explicitly skipped on the existing Linux test setup, which disables Chromium sandboxing.

Development and test processes use `plugins-dev` rather than the installed application's `plugins` directory. Nonpackaged processes may set the absolute `TERRAFORGE_PLUGIN_DIR` environment variable to use a dedicated directory and `TERRAFORGE_PLUGIN_TIMEOUT_MS` to shorten deadlines within the host's permitted range. Installed builds ignore these testing overrides.

Keep automated tests away from physical plotter controls. The sample produces vector artwork only; normal G-code generation and deliberate machine actions remain the user's existing workflow.

## Completion boundary

A successful Stage 1 desktop test run demonstrates the tested development build on that host. Installed application packaging and supported platforms require their own smoke tests. Do not describe the full plugin/bitmap engine as complete until the later acceptance checks in the proposal also pass. Test results and any untested packaging/platform limitations should be reported with the implementation delivery.

## Previous Stage 1 validation — 27 October 2026

These results were recorded for the earlier Stage 1 implementation on Windows x64 with Electron 40.6.0, after the panel/reopen update. Current bitmap-foundation validation is recorded in [the Stage 2 notes](plugin-stage-2.md).

- 1,699 unit/component tests passed.
- All nine plugin desktop workflows were covered: the existing eight passed together, then the new minimise/close/reopen/update workflow passed separately against the final build. The new check verifies a stable item ID, preserved nontrivial placement/scale/rotation, one-step undo, and restored settings after saving and restarting.
- An unsigned Windows directory build passed the packaged smoke test. The script verified `app.isPackaged`, checked the isolated temporary profile before acting, installed Example Grid through the UI, generated and saved eight paths in a 50 × 40 mm frame with plugin provenance, and rediscovered the plugin after restarting.
- The packaged flow also verified minimise/expand, closing without deleting artwork, reopening saved controls, updating the same item to 60 mm width, undoing back to 50 mm, and restoring its saved settings after reopening the layout.
- The packaged build used its `plugins` directory and ignored the development directory override. A temporary generator that waited 250 ms completed with the test timeout override set to 100 ms, proving that override is ignored in the packaged app too.
- The smoke-test app closed and its verified temporary profile was removed. A screenshot was inspected to verify the controls and generated artwork.

To reproduce a default packaged check from the project folder after installing dependencies:

```powershell
npm.cmd run build
npm.cmd run package -- --win --x64
npm.cmd run test:plugin-package
```

The smoke script also accepts a packaged executable path:

```powershell
npm.cmd run test:plugin-package -- .\path\to\terraForge.exe
```

This validates the unpacked Windows application directory, not an installed NSIS package. macOS, Linux and the NSIS installer have not been tested in this milestone. Physical machine control was not exercised by these plugin checks.
