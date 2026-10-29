# Comic Ink Vectorizer validation — 29 October 2026 (New Zealand)

Verified on Windows x64, Node 24.21.0, Electron 40.6.0. No host implementation files were changed. The plugin uses the existing API-1 shared preparation and processing workflow.

## Passed

- `npm.cmd run typecheck`: renderer and main/preload strict checks passed.
- `npm.cmd run build`: production main, preload/plugin worker and renderer builds passed.
- Focused unit run: **125 passed across six files**, including **20 Comic Ink Vectorizer checks**, existing preparation, processing validation, capacity, Spiral Sawtooth and CMYK Circles tests.
- Desktop run: **8 passed** across `comic-ink-vectorizer.spec.ts`, `plugin-processing.spec.ts` and `plugin-bitmap-preparation.spec.ts`. These launch the actual built app with verified disposable user-data directories and install the actual plugin file. The new workflow passed discovery, isolated-worker Preview, saved-preview isolation, named separations, explicit real black pen, complete transformed source frame, apply/update/undo/redo, restored controls/preparation, deterministic regeneration and visible saved geometry without the plugin.
- ESLint on the new TypeScript tests and JavaScript syntax checks passed; whitespace checks passed.
- Actual path examples completed within Standard capacity for the portrait, face crop, coffee photograph and synthetic hole fixture. Geometry counts and measured timings are in [statistics.json](images/comic-ink/statistics.json). Colour and black passes were visually inspected separately, along with the composite Clean/Heavy comparison and real desktop preview screenshot.

Commands for the focused tests:

```powershell
npx.cmd vitest run tests/unit/comicInkVectorizer.test.ts tests/unit/pluginProcessingValidation.test.ts tests/unit/pluginBitmapPreparation.test.ts tests/unit/pluginCapacity.test.ts tests/unit/spiralSawtooth.test.ts tests/unit/cmykCircles.test.ts
npx.cmd playwright test --config=tests/e2e/playwright.config.ts tests/e2e/comic-ink-vectorizer.spec.ts tests/e2e/plugin-processing.spec.ts tests/e2e/plugin-bitmap-preparation.spec.ts
```

## Wider-suite failures and environment restrictions

The complete unit/component run reported **2,249 passing tests**, one failed test and one suite that could not load (181 files passed, two failed). This run preceded three additional Comic Ink checks, all of which passed in the final focused run.

- The unchanged `tests/unit/rendererPluginConversion.test.ts` suite fails to load with **SyntaxError: Invalid or unexpected token**, before collecting tests. The same error repeats in an isolated run with ordinary permissions and with the transform cache disabled. Its conversion source files pass Node syntax checking, but this existing suite's Vitest import failure remains unresolved. The broad test suite is therefore **not reported as passing**.
- The registry directory-link check initially failed with **EPERM** while creating a temporary Windows junction in a restricted run. Rerunning `tests/unit/main/plugins.registry.test.ts` with normal file permissions passed all **15** checks. No application or test logic was changed to bypass that check.
- The first desktop run could not launch Electron in the restricted environment. All eight workflows passed when rerun with normal application-launch permissions; the application's own plugin isolation remained enabled.
- Vitest initially encountered an EPERM rename in the environment-provided temporary directory. Subsequent unit runs used the repository-local ignored `.cache/comic-temp` as TEMP/TMP.

The code, tests and documentation for the existing renderer conversion feature were not modified. This release does not claim a clean full-suite result until its loading error is addressed.

## Verification boundary

This verifies the current Windows development build, actual plugin worker and installable single-file distribution. It does not claim verification of an NSIS installer, macOS, Linux, old hosts without shared preparation, or a physical plotter. Previews are plotted-path simulations with explicitly chosen nib widths, not calibrated pen/ink/paper predictions. No comic-reference image is bundled.
