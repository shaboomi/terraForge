# Working from the developer's latest main

Prepared on 31 October 2026 (New Zealand time).

## Where the work lives

| Purpose | Location |
| --- | --- |
| Original developer repository (`upstream`) | https://github.com/theworkisthework/terraForge |
| Your fork (`origin`) | https://github.com/shaboomi/terraForge |
| Preserved source work | `reference/my-terraforge-additions-2026-10-31`, commit `d296c41` |
| Fresh development branch | `codex/adapt-features-to-main` |
| Starting upstream main | `5b9d388` — shorten config dialog tab labels |
| Reference folder | `C:\Users\rmars\source\TerraForge` |
| New development folder | `C:\Users\rmars\source\TerraForge\upstream-adaptation` |

Both folders are Git worktrees: separate checkouts sharing the repository's history. Keep the reference folder available and make new development changes in the new folder. Do not copy its nested development folder into the reference branch. It is excluded locally from Git's file list.

Your original local `main` and GitHub `main` were left in place. No reset or force push was used. The unfinished merge metadata and index were copied into `.test-temp/migration-backup-2026-10-31` before ending the pending merge state without discarding files. The uncommitted calibration source, documentation and tests were committed on the reference branch and pushed to your fork. Untracked plugin packages and temporary outputs remain in the original folder; they were not published as source changes.

## Run the adapted version

Open a terminal in the new development folder:

```powershell
cd C:\Users\rmars\source\TerraForge\upstream-adaptation
npm run dev
```

Open **Settings → Pens** for calibration and the pen library. This development app uses the normal TerraForge application data when launched manually. Automated app checks use separate temporary profiles.

## How to contribute

Keep `reference/my-terraforge-additions-2026-10-31` as the comparison copy. Commit adapted features on the new branch and push that branch to your fork. A pull request should compare your development branch with `theworkisthework/terraForge:main`. Review and agree scope with the developer before submitting the remaining features.

Before starting a later feature, download upstream updates with `git fetch upstream`. Work on a branch based on the then-current `upstream/main`, or integrate the newly accepted feature branches in dependency order. Fetch downloads history without changing your current files. Avoid GitHub's **Sync fork → Discard commits** option on your existing main.

## Adaptation inventory

The two lines of development share ancestor `e3ad320`. Upstream now includes bitmap renderers, renderer plugins, paper/pen preview colours and a reorganised generation pipeline. Existing functionality needs comparison before replacing it.

| Feature from the reference branch | Current status / next approach |
| --- | --- |
| Pen calibration: speed, brush, lift, timing, geometry, repeatability, hatching | Adapted to Settings → Pens with existing calibration tests |
| Physical pen library and calibrated speed limits | Adapted to Settings → Pens and upstream artwork groups/generation pipeline |
| Brush measurements | Stored and used for fixed contact height; variable-width text and lead-ins await font adaptation |
| Font library, centreline conversion and text generation | Not ported yet; separate feature after pen profiles |
| Standalone plugin engine, processing, rescan and bitmap preparation | Not ported; compare with upstream renderer-plugin contracts first |
| CMYK Circles, Spiral Sawtooth, Comic Ink and sculptural generators | Reference implementations preserved; adapt to upstream plugin API individually |
| Bitmap layouts/import changes | Compare against upstream's bitmap model; retain upstream save format in this branch |
| Pen/page colour workflow and lightest-first export | Library colours supported; other preview and ordering changes need separate comparison |
| FluidNC, plot lifecycle and rotated resize fixes | Compare each fix with upstream changes and reproduce the issue before porting |

This branch starts from the developer's current code and adds the requested first features. It does not merge the full reference branch or claim the remaining features are adapted.

## Validation

- Type checks and production build pass.
- Full unit/component suite: 2,304 tests pass.
- Final pen settings, library and G-code checks: 78 tests pass after the selector accessibility correction.
- Actual app checks: two calibration scenarios and one library persistence/layout-assignment scenario pass.
- Lint: no errors; one pre-existing function-length warning in `useImportPropertiesFormModel.ts`.
- No physical plotter test has been performed for this adaptation.

The test configuration now resolves its setup file from the configuration directory, allowing the suite to run correctly from this nested worktree.

## Calibration text enhancement

Pen names now plot above the patterns, all row numbers use system-font outlines, and speed sheets include actual mm/min labels beside each row. Arial is preferred, with installed platform sans-serif fallbacks. Text paths are shared by the preview and G-code; long headings wrap within the checked sheet size. No system font files are committed or bundled.

Validation after this enhancement: build and type checks pass; lint has only the existing function-length warning; both calibration app checks pass with the installed Arial font. The full suite passed 2,314 of 2,315 tests at its default five-second timeout. The sole failure was an unchanged cooperative path-sorting timing test; all ten tests in that file passed when rerun with a 30-second timeout (the slow test completed in about six seconds). No timing-related application or test code was changed.
