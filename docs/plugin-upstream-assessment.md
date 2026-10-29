# Selective upstream plugin integration assessment

Reviewed 29 October 2026 (New Zealand), against working checkout
`C:\Users\rmars\source\TerraForge`, initially commit `4b99c43`.
The older OneDrive copy is outside this work.

## Current upstream and fork state

The live GitHub API reported [upstream PR #128](https://github.com/theworkisthework/terraForge/pull/128)
**open and unmerged**, with head
`cb44a7ced92682f76e01bfbdecc9a64bdbb3ed84`, 106 commits and 294 changed files.
The local `origin/feature/plugin-architecture-for-bitmap-renderer` reference
matched that head. This assessment reads that implementation, including
`pluginManifest.ts`, `pluginSource.ts`, `pluginSandboxAssets.ts`,
`bitmapRenderService.ts`, `toneAdjust.ts`, `colourSeparation.ts`, the authoring
guide and both actual example plugins. It does not assume the PR description
captures all later changes.

The fork's [Stage 1 #3](https://github.com/shaboomi/terraForge/pull/3),
[Stage 2 #4](https://github.com/shaboomi/terraForge/pull/4),
[pens/page #5](https://github.com/shaboomi/terraForge/pull/5),
[processing #6](https://github.com/shaboomi/terraForge/pull/6),
[Spiral Sawtooth #7](https://github.com/shaboomi/terraForge/pull/7),
[cascading menu #8](https://github.com/shaboomi/terraForge/pull/8) and
[resize/return #9](https://github.com/shaboomi/terraForge/pull/9) were merged.
[CMYK Circles #10](https://github.com/shaboomi/terraForge/pull/10) remained
open at `672c572cbde92a234f71a3d21950fbdb47d7336b`; the starting checkout
also included the subsequent plot-start timeout commit. Review branches
must preserve these dependencies and exclude unrelated changes from their
stage diffs. The existing untracked Spiral Sawtooth package is user material.

All eight requested local design/author/stage/menu/CMYK/Spiral documents and
their relevant implementations were reviewed. Some earlier stage notes
describe historical boundaries; the current implementation is the baseline.

## Feature mapping and decisions

| Proposal | Existing fork boundary | Selected approach / dependency |
| --- | --- | --- |
| Rescan | `src/main/plugins/registry.ts`, main plugin IPC, `pluginStore.ts`, cascading menu/management | Add explicit metadata-only discovery, preserve disabled IDs, invalidate active work and previews before publishing a new registry. Never replace applied artwork. |
| Changed source | Registry already detects files edited since discovery; saved provenance is version-based | Add an executable-source fingerprint to discovered entries, run identity and saved provenance. Explain mismatches and missing historical fingerprints. Regeneration remains explicit. Native plugins are self-contained; converted helper sources become part of the executable file. |
| Shared preparation | `pluginProcessing.ts` decodes detached full-frame RGBA; algorithms own their existing adjustments | Add host-controlled opt-in preparation alongside original RGBA/alpha, with deterministic settings and separate colour channels. Existing CMYK and Spiral code must continue receiving unchanged inputs unless explicitly opting in. |
| Performance | Fresh sandboxed host/worker per run, repeated bitmap decode and transfers | Measure before changing runtime. Bound caches by bytes and complete input/settings identity, keep per-run copies private, and retain fresh runtimes unless measurements justify more lifecycle complexity. Record measured results separately from upstream claims. |
| Structured dots | Document already has `SvgPath.pointTap`, hatch flags and `plotPointsEnabled`; plugin results contain polylines | Deferred as a plugin API extension. It requires explicit outline/fill/tap semantics, budgeted validation and integration across preview, transactions, save/load, hatching and ordered G-code. Existing circles retain their present paths. |
| Upstream compatibility | `.tf-plugin.js` ES module input/result contract and folder CommonJS renderer contract both say API 1 | Deliver an offline **generator-only conversion subset**, documented separately. Preserve exact supported line/layer geometry; reject unsupported curves, dots and bitmap contexts. Automatic folder discovery and the broad adapter are deferred. |
| Properties improvements | Validated host-rendered number/slider/select/text/colour/pen controls | Add Original tones / More contrast host presets in shared preparation. The conversion subset accepts existing controls and explicitly refuses upstream nudge/icon extensions until separately supported; no plugin HTML or UI code. |

The existing document transaction, source-frame preservation, result-group
identity, pen assignment and plotting-order pipelines remain the integration
points. Manual Preview → Apply, Standard/Extended limits and atomic undo must
not be bypassed by an upstream service or converter.

## Why the full renderer adapter is separate

The incompatibility is larger than renaming a function. Upstream
`render(context)` receives prepared single-byte tones (0 black, 255 white),
`width`/`height`, one `scale` in millimetres per output unit, `settings`, and
optionally one separated `ink`. Bitmap output units are source pixels;
generator units are millimetres. It returns SVG path text, named coloured
layers, or independent dot outlines with tap centres. Native TerraForge
plugins receive full RGBA plus placement and real-pen IDs and return bounded
structured geometry/raster items.

A broad adapter therefore needs an explicit format discriminator, folder
manifest validation, confined helper snapshots/fingerprints, a CommonJS
loader within the existing sandbox, supported SVG curve handling with
bounded accuracy, dot/fill/tap choices, palette-to-ink translation and
complete workflow tests. A bitmap's unequal X/Y scales cannot honestly be
represented by upstream's single scalar `scale`; an adapter must define its
detail metric without changing the geometry's placement. Optional-source
plugins also need an explicit host input choice. None of this can be guessed
from `apiVersion: 1` or colour hex values.

The [offline conversion tool](renderer-plugin-conversion.md) handles the
source-free portion deliberately: page millimetres, `scale=1`, static
CommonJS helper closures, validated controls, exact M/L/H/V/Z geometry and
layer labels/colours. It leaves both formats distinct and sends converted
results through mandatory Preview → Apply and the native document workflow using an explicit `previewRequired` declaration. It introduces no
CommonJS loader, `eval` permission, folder execution or machine API into
normal application discovery.

The upstream `bitmapRenderService.ts` watches document settings and applies
new geometry automatically. Transplanting it would break this fork's manual
processor workflow and saved-layout execution rule. Its host reuse and
source-reference transport cache also add identity, eviction, cleanup and
stale-message obligations. Their performance measurements are useful leads,
not evidence of benefit in this fork.

## Colour and dot boundaries

Upstream distinguishes additive RGB on dark stock, RGB-on-white ink
unmixing, subtractive CMY/CMYK and custom palettes. Its CMYK uses naive
under-colour removal; its tone pipeline smooths before percentile levels and
contrast. Shared preparation should document its own exact formulas and
order rather than promise calibrated ink mixing or silently substitute those
formulas for CMYK Circles. Separation channels, configured real pens and
execution rank remain separate concepts.

A closed circle path currently means an outline or the explicit ring
toolpaths returned by its plugin. A dot outline can instead mean a hatchable
region or a pen tap at a separate centre. Conversion rejects upstream dots
until these distinctions can be represented and validated end to end. It
never turns an existing circle path into a tap or changes K-last ordering.

## Provenance and licence

The rescan/fingerprint/preparation integration is informed by the upstream
concepts while retaining this fork's engine. The offline converter and its
runtime adapter are independently implemented against the reviewed public
contract. The actual upstream spirograph example and helper are retained as
test fixtures at `tests/fixtures/renderer-spirograph`; their source revision
and upstream MIT licence, copyright 2026 Mark Benson, accompany the files.
The converter retains inline source comments and bundled `LICENSE`/`COPYING`
files in generated output. Do not remove applicable notices when sharing
converted plugins.

No full upstream merge, machine-behaviour change or physical plotter operation
is part of this integration. Verification results and measured cache/runtime
tradeoffs belong in the delivery notes, with platform and packaging limits
stated separately.
