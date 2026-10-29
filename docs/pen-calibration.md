# Pen calibration

Open **Calibrate** on the toolbar. Each test saves a G-code file and a `.gcode.txt` results sheet. Import the G-code to preview and run it through the normal job controls. It preserves row order and test dimensions without path optimisation. The app does not change the machine profile or start the machine when saving.

Use a fresh flat sheet, the same paper stock as your artwork and the same pen mounting. Write the pen model, ink, mounting and date on the sheet. Work coordinates and machine profile bed dimensions must match the actual setup. Rows are numbered on the paper; look up the corresponding settings in the dialog or results sheet. Repeat tests when remounting a pen.

## Speed and line quality

Start with a speed range you know is suitable for your machine. Speeds in the dialog are **mm/s**; the output uses **mm/min** (multiply by 60). Each row has a long forward and reverse line, sharp direction changes and a circle at the same requested speed. Numbers use a slower reference speed.

Inspect for skips, waviness, changes in width or ink density, rounded corners, overshoot and circles that fail to close. A passing row should match the low-speed reference at your intended viewing distance. Narrow the range around the first failure, repeat, then confirm the fastest consistently passing setting on representative artwork. Allow some speed margin for daily use. No single pattern can guarantee perfect results on every drawing; short segments and circles may remain below the requested feed because of acceleration and controller limits. Longer lines help reveal ink starvation at sustained speed.

Record the chosen feed in the pen's results sheet. Machine settings and generation speed overrides use mm/min.

## Brush width and depth

This test requires a stepper Z lift with increasing Z lifting the pen. It does not infer actuator travel limits. Jog manually to find light contact and a deeper usable position, then check the safe lift. Enter absolute work Z values and a suitable Z movement speed. Never use a guessed deep position to discover the mechanical limit.

Each row draws two opposite-direction strokes at a fixed Z and one ramp from the lightest Z to that row's Z and back. Measure the widths after drying. Choose the lightest Z that consistently contacts the paper and the deepest Z that produces a clean wide stroke without excessive splaying or pooling. Ramps also show whether the pen recovers promptly. Z depth is a proxy for compression, not a force measurement. Coordinated XYZ ramps may run slower than flat strokes, particularly if Z is rate-limited.

Repeat at the intended drawing speed. Record a small Z-to-width table per pen, paper and speed. These results do not automatically add variable-width drawing to ordinary imported artwork.

## Lift clearance

Use the established contact Z for dashes, a checked safe lift Z above the highest candidate, and a candidate range above contact. Six dashes per row are separated by travel at that row's candidate lift Z. Clean gaps indicate sufficient clearance; a connecting mark indicates dragging. Numbers use the checked safe lift.

Choose the lowest repeatedly clean clearance with allowance for paper variation. Maximum lift remains the manually checked safe travel height; it cannot be determined from ink marks alone. Distinguish this pen-up clearance from the brush's lightest/deepest drawing Z values.

## Additional tests to run

- **Pen timing:** repeat the lift sheet with different up/down delays in machine settings; inspect starts, ends and gaps. Too little down delay can omit starts; insufficient up delay can leave tails.
- **Geometry:** plot a measured square, diagonals and circles to check scale and squareness.
- **Repeatability:** retrace a square several times to reveal offsets or mechanical play.
- **Ink and hatching:** compare closely spaced parallel lines, crosshatching and long strokes to find bleeding, drying and starvation limits.

Change one setting at a time. Keep paper, mounting and ink condition consistent so comparisons remain useful.
