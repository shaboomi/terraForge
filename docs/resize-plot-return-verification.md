# Resize and plot-return verification — 28 October 2026

Branch: `codex/rotated-resize-plot-return`, based on `9238d21` in `shaboomi/terraForge` (including the merged cascading Plugins menu). The checks below were completed before PR publication.

The three pre-existing deleted example plugins and untracked Spiral Sawtooth package were preserved. Installed plugins and the normal app profile were not changed. Desktop tests used isolated temporary profiles and plugin directories; no physical plotter was connected or operated.

## Changes

- All eight single-artwork resize handles convert mouse movement from viewport coordinates into the artwork's rotated frame. Corner and edge anchors stay fixed in world space; dimensions and placement are updated together using the existing canvas placement convention.
- Resize cursors follow artwork rotation, rounded to the native cursor's nearest 45-degree direction. Default resizing preserves the ratio at gesture start, even when width and height already have different scale factors. Ctrl enables independent axes. Each gesture remains one Undo entry. Hints say “Hold Ctrl to resize freely.”
- Automatic return is armed when a job is started by the app. File-end evidence (matching file notification or observed file progress ending) must be followed by planner Idle; line count, Start acknowledgment and transient mid-file Idle are insufficient.
- The return uses the existing work-coordinate origin X0 Y0, without a homing cycle or limit bypass. It establishes G90/G21/G94, sends the configured servo/stepper pen-up command, waits through the configured G4 lift delay, then sends feed-limited XY travel at the configured jog speed. Existing work offsets remain in force and controller soft limits remain enabled. The pen stays lifted.
- Wi-Fi return commands require live WebSocket parser acknowledgments; USB uses the existing serial command acknowledgment queue. No retry or HTTP fallback can duplicate uncertain return movement. New jobs are blocked until return arrival is observed. Already-at-origin artwork lifts without another XY return.
- Pause, abort, reset, disconnect, alarm, errors and manual commands prevent or interrupt automatic return. Generated G-code with the existing Return to origin option now lifts and honors the lift delay before that footer's travel, even if Lift pen at end is unchecked.

## Verification

- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Targeted ESLint: no errors; six existing large-function/complexity warnings in the affected large modules.
- Desktop: 19/19 Electron tests passed (about 1.1 minutes), using actual mouse and keyboard events. Coverage includes all corner directions at 0, 37, 90, 180 and 270 degrees; zoom variants; all eight cursor directions; Ctrl free scaling; retaining a newly unequal ratio; edge handles; anchored opposite corners; Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y. Anchor displacement tolerance is 0.6 screen pixels; dimension tolerances allow native integer mouse-coordinate rounding.
- The same desktop run passed cascading Plugins mouse/keyboard navigation, Stage 3 preview/apply/cancellation/portable saved results, Spiral Sawtooth processing and history, paper colours, and white-pen G-code output.
- Mock controller, transport and IPC tests cover EOF versus execution completion, dwell-related Idle, both transport routes, exactly-once return, pen-up failure, parser errors, timeout, pause during lift, cancellation, disconnect, configured servo/stepper delays, modal feed settings and destination-arrival gating.

Final full suite: 2,088 passed, four failed, across 173 test files (172 passed). All four remaining failures match the initial baseline and occur because locally deleted `bitmap-tones`, `bitmap-scanlines` and `reverse-vectors` example files are absent. Those files were not restored.

## Evidence and limits

Screenshots: [90-degree locked resize](images/artwork-resize-90-locked.png), [Ctrl free resize](images/artwork-resize-90-ctrl-free.png), and [existing unequal proportions preserved](images/artwork-resize-unequal-ratio-locked.png).

The corrected drag geometry covers individual imported artwork (including SVGs and bitmaps). Group-selection resize geometry is unchanged; group cursors now follow the displayed group's rotation.

Automatic return fails closed when the firmware supplies no trustworthy completion signal, the Wi-Fi parser acknowledgment is unavailable, or a command fails. A very short job missed by every status report with no file-end notification cannot be confirmed; disconnect/reconnect clears its pending-job guard. Return arrival also needs a trustworthy work or machine position report. A plot held and resumed solely from an external pendant requires Resume in the app (or raw `~`) to clear the conservative pause latch. Hardware motion and firmware-specific physical lift timing were intentionally not tested.

Firmware semantics were checked against FluidNC primary sources: [file progress](https://github.com/bdring/FluidNC/blob/v3.9.7/FluidNC/src/InputFile.cpp), [status reporting](https://github.com/bdring/FluidNC/blob/v3.9.7/FluidNC/src/Report.cpp), [protocol execution](https://github.com/bdring/FluidNC/blob/v3.9.7/FluidNC/src/Protocol.cpp), [HTTP command handling](https://github.com/bdring/FluidNC/blob/v4.0.1/FluidNC/src/WebUI/WebUIServer.cpp), and [HTTP client execution](https://github.com/bdring/FluidNC/blob/v4.0.1/FluidNC/src/WebUI/WebClient.cpp).
