# Selective plugin integration delivery

Verified 29 October 2026 (New Zealand), in `C:\Users\rmars\source\TerraForge`.
The final working branch is `codex/plugin-renderer-conversion`, containing all three stages. Existing untracked Spiral Sawtooth files were left untouched. The older OneDrive project was not used.

## Review in GitHub

All changes are committed and published only to `shaboomi/terraForge`. Nothing has been merged.

| Draft | Change | Base |
| --- | --- | --- |
| [#11 — Rescan and source fingerprints](https://github.com/shaboomi/terraForge/pull/11) | Metadata-only live discovery; remembered enable choices; active-run/preview invalidation; pinned requests and portable saved code identity | Existing `codex/plot-start-timeout` working branch |
| [#12 — Shared bitmap preparation](https://github.com/shaboomi/terraForge/pull/12) | Opt-in levels/gamma/contrast/smoothing and colour channels; saved controls; bounded decode/preparation caches; private buffer transfer; Prepared Scanlines example | Stage 1 branch |
| [#13 — Bounded upstream generator conversion](https://github.com/shaboomi/terraForge/pull/13) | Offline manifest/helper conversion; exact supported line/layer geometry; mandatory Preview → Apply; upstream Spirograph fixture and MIT notices; assessment and delivery notes | Stage 2 branch |

These are stacked reviews: each contains the preceding stages, while its GitHub comparison shows only that stage's changes. Open the links in order to read the work. No action is needed immediately; leave them as drafts until reviewed. Do not merge later stages ahead of their prerequisites.

The original checkout already contained unmerged [CMYK PR #10](https://github.com/shaboomi/terraForge/pull/10) and the subsequent local plot-start timeout fix. Its existing `codex/plot-start-timeout` branch was published unchanged as the Stage 1 base so unrelated machine/CMYK changes do not appear in the plugin review. Integrating the stages into `main` later requires deciding how to land those existing prerequisites and then updating review bases. No upstream merge is proposed.

## What remains compatible

Existing `.tf-plugin.js` files require no changes. Categories, cascading menus, Font Tools, Properties, generator actions and manual processor Preview → Apply remain available. Shared preparation appears only for a plugin declaring `bitmapPreparation: true`; CMYK Circles and Spiral Sawtooth keep their original algorithms.

Results retain the source, complete local frame, rotation, independent scaling, margins, seed, saved parameters, result-group identities, real-pen assignments and explicit plotting order. CMYK Black-last and Extended A2 export were exercised. Whole-result apply/update/undo remains atomic. Opening a layout never runs a plugin; missing-plugin artwork remains portable and usable. A changed source fingerprint is explained before explicit regeneration, and older layouts without a fingerprint remain compatible with an unverifiable-code notice.

## Verification

- **2,265 unit/component tests passed across 182 files** on the final code. The suite covers native legacy plugins, complete input/result validation, preparation and exact cache invalidation, cancellation, malformed files, real pen ordering, layout round-trips, source alignment and atomic history.
- TypeScript checks and the production build passed. New/changed focused test files and converter/preparation modules passed ESLint. Existing plugin orchestration functions retain complexity/function-size warnings; there were no lint errors in the targeted production check. Whitespace checks passed.
- **31 unique Windows desktop scenarios passed across the regression and final focused runs.** They include four CMYK workflows (including Black-last and A2 Extended export), two actual Spiral workflows, five native processor workflows, nine generator/security/lifecycle workflows, three menu workflows, page/pen colours, white-pen plotting, three Rescan workflows, two preparation workflows and one converted Spirograph workflow.
- The 30-case broad desktop run passed 29 cases and hit one menu-selection timeout in the existing saved-generator editing case. That case passed when rerun alone on the final build. All six newly added desktop scenarios then passed together on the final build. This records the timing failure rather than treating the broad run as an uninterrupted pass.
- Real desktop preparation checks verified that repeated Preview decodes once, preparation changes invalidate previews, original RGBA/alpha cross the worker boundary, result frames retain transforms, prepared settings survive save/restart/reopen, and no real pens are inferred from channel colours. Converted Spirograph preserved labels/colours, mandatory Preview, whole-result undo and portable geometry after removal of its plugin.
- Desktop checks verified disposable profile paths. The app remained disconnected; no physical plotter was operated. The preparation controls/preview and refreshed menu screenshots were visually inspected.

This verification covers the Windows development desktop build. This integration was not repackaged into an installer; macOS, Linux and installation/upgrade behaviour were not newly exercised. Existing packaging restrictions and fresh sandboxed per-run runtimes remain in place.

Reproduce the main checks from this working folder:

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
node node_modules/@playwright/test/cli.js test --config=tests/e2e/playwright.config.ts tests/e2e/plugin-rescan.spec.ts tests/e2e/plugin-bitmap-preparation.spec.ts tests/e2e/renderer-plugin-conversion.spec.ts
node --experimental-strip-types scripts/plugin-bitmap-benchmark.mts
```

When a managed Windows temporary directory prevents test-cache renames, set `TEMP` and `TMP` to a writable disposable directory before testing. No production directory setting needs to change.

## Performance and scope

Repeated shared CMYK preparation measured **16.20 → 1.45 ms** at 384² and **59.83 → 5.77 ms** at 768²: **10.4–11.2×** faster for that preparation step. These timings include hashing/private cache copies and do not measure total desktop Preview latency. Existing CMYK/Spiral algorithms were unchanged and showed no demonstrated algorithm speedup. The [preparation guide](plugin-bitmap-preparation.md) records baseline/final measurements, exact formulas and memory costs.

Decoded-image retention is bounded to 24 MiB including its encoded string; prepared planes use a 32 MiB cache and a separate 32 MiB per-run plane cap. Keys include actual pixel content, dimensions and every preparation setting/palette entry. Isolated per-run copies and temporary processing buffers consume additional memory. One host-to-worker clone is removed by transferring run-owned buffers; renderer/main/cache buffers remain private.

Fresh runtimes are retained. Runtime reuse was not justified by these preparation/clone measurements and would introduce additional state-cleanup, cancellation and stale-message risks. Full folder-based bitmap renderer compatibility, SVG curves, structured dots/fill/tap semantics, upstream numeric-nudge/icon metadata and calibrated physical colour separation are deferred. The [conversion guide](renderer-plugin-conversion.md) defines the supported source-free generator subset and explicit errors; the [assessment](plugin-upstream-assessment.md) pins the reviewed upstream head and explains these decisions.

To try the new preparation now, use the development build, copy `docs/examples/prepared-scanlines.tf-plugin.js` into the folder opened by Plugins, then choose Rescan Plugins. Import/select an image and choose Bitmap to Vector → Prepared Scanlines. This does not install or replace an application release. Ordinary plugin installation/editing needs no GitHub action.
