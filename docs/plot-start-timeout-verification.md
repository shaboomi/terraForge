# Wi-Fi plot-start timeout correction — 29 October 2026

The reported `fluidnc:runFile` TimeoutError and `Job output channel webclient closed; the job continues` were reproduced as a transport-lifetime problem. The prior safe-return logic was cancelled by the rejected start request even though the controller kept executing the file.

## Cause and correction

- TerraForge uses an independent WebSocket session. Its generic HTTP `commandText` request did not identify that session and could fall back to `plain`.
- `plain` owns a webclient output channel. Recent FluidNC versions defer the file Run acknowledgement until EOF, so a normal ten-second HTTP timeout can close the channel during a valid long plot. Retrying Run through another endpoint also risks executing the side effect twice.
- Wi-Fi Run now sends exactly once through the existing live WebSocket, without HTTP fallback. Matching file progress, a matching EOF message or an immediate legacy acknowledgement confirms start. Once file execution is observed, its duration is not subject to a short command timeout.
- The deferred Run acknowledgement retains its own slot until its terminal response. Reporting-interval setup acknowledgements are drained separately. Lift, dwell and return commands cannot accidentally consume either response.
- Return commands wait behind that slot with cancellation support. Pause, abort, disconnect and manual intervention abort a waiting return before it transmits. An uncertain acknowledgement requires reconnection rather than retrying an uncertain command.
- Completion still requires file-end evidence followed by planner Idle. The configured lift/dwell/work-origin sequence and filename compatibility guard remain intact.

## Validation

- Typecheck and production build passed.
- Full suite: 2,169 tests passed in 177 files.
- Independent integration simulator uses the real transport and completion controller for thirty-second SD and LocalFS plots, delayed Run acknowledgements, the reported webclient INFO message, per-command acknowledgements, interruption and errors. HTTP is prohibited in these simulations.
- IPC regressions verify cancellation signals reach the transport while it waits for the deferred reply.
- The real Electron renderer/preload/IPC path passed the loopback-only long-plot test against both the development app and the packaged Windows app. It held file execution for 12.1 seconds and independently gated each deferred/run/lift/dwell/return acknowledgement. The packaged start resolved in 4.6 ms; no HTTP request or duplicate Run was sent.
- Targeted lint: no errors; existing IPC function-length warning only.

## Controlled device check

With the user's pen removed and authorization to test, the corrected production client was tested against FluidNC v4.1.1 (`main-6735500a`). The active profile was preserved: stepper pen lift `G0Z5`, zero configured lift delay, and travel speed 6000 mm/min. No homing cycle or coordinate reset was sent.

A temporary G-code file contained only known units/modes, the configured pen-up position and a fifteen-second dwell. It contained no drawing or XY travel. Start was confirmed in **105 ms**, while the file continued longer than the old HTTP deadline. At EOF, the deferred Run reply was consumed, then each of these commands was separately acknowledged:

```gcode
G90 G21 G94
G0Z5
G4 P0
G90 G21 G94 G1 X0 Y0 F6000
```

The controller subsequently reported Idle with work position **X0 Y0 Z5**: machine position `(0,10,12)` with unchanged work offset `(0,10,7)`. The app reported `Safe plot return complete; pen left lifted.` The temporary SD verification file was deleted afterward (HTTP 204). Detailed local test events are in `.cache/plot-start-live-verification.json` and `.cache/plot-start-live-events.json`.

The corrected Windows package is at `release/plot-start-timeout/win-unpacked/terraForge.exe`. Packaging does not replace the installed application or user profile. Existing installed plugins, pen/paper controls, cascading menus, Stage 3 and CMYK features are preserved.

## Limits

Actual network loss still cancels automatic return; reconnection alone does not authorize later motion. Missing trustworthy start/EOF/acknowledgement evidence remains a safe stop. USB file-start transport is unchanged by this Wi-Fi correction. No drawing plot was used for hardware verification; only the bounded pen-up dwell and normal return were exercised.

Firmware references: [Run command dispatch](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/FileCommands.cpp), [deferred job acknowledgement](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Job.cpp), [HTTP response lifetime](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/WebUI/WebClient.cpp), [HTTP/session routing](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/WebUI/WebUIServer.cpp).
