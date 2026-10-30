# Pen calibration

Open **Settings → Pens → Create calibration sheet**. Each test saves a G-code file and a `.gcode.txt` results sheet. Import the G-code to preview and run it through the normal job controls. It preserves row order and test dimensions without path optimisation. The app does not change the machine profile or start the machine when saving. Calibration uses the saved active machine profile.

Use a fresh flat sheet, the same paper stock as your artwork and the same pen mounting. Write the pen model, ink, mounting and date on the sheet. Work coordinates and machine profile bed dimensions must match the actual setup. Rows are numbered on the paper; look up the corresponding settings in the dialog or results sheet. Number labels read upright in the schematic and on the paper. The output accounts for top and right origins by reflecting the sheet coordinates to match those axis directions. Geometry has one pattern; repeatability retraces one pattern rather than drawing separate rows. Repeat tests when remounting a pen.

All speed fields, results sheets and G-code feeds use **mm/min**. Speed, timing, geometry, repeatability and ink/hatching tests use the machine profile's pen commands and work with stepper, servo and solenoid lifts. Brush depth and lift clearance require a stepper Z lift. Saving a test does not update machine settings; transfer a chosen setting to the appropriate profile or pen specification after inspecting the plotted sheet.

## Text on the plotted sheet

If you enter a pen name, it is plotted above the patterns as **Pen: …**. Leave the name blank to omit the heading. Names can contain up to 80 characters; long names wrap, and the sheet's bed-size check includes the extra heading space.

All sheet text, including row numbers, uses an installed sans-serif font: Arial is preferred on Windows and macOS; Segoe UI, Liberation Sans or DejaVu Sans provide platform fallbacks. The dialog shows the selected font. Letter outlines are converted to G-code paths, so the actual plot and preview contain the same text; no font file is distributed with the sheet. Export is disabled if the font cannot load or the name contains a character it cannot draw.

Speed sheets label every row with its actual feed, such as **1200 mm/min**, beside the zigzag pattern, clear of the long lines and circle. Text is drawn at the lower of the reference speed and the slowest test speed, so high-speed test failures do not make the labels unreadable. This label speed does not change the feed used by the test patterns themselves.

## Speed and line quality

Start with a speed range you know is suitable for your machine, entered in **mm/min**. Each row has a long forward and reverse line, sharp direction changes and a circle at the same requested speed. Numbers use a slower reference speed.

Inspect for skips, waviness, changes in width or ink density, rounded corners, overshoot and circles that fail to close. A passing row should match the low-speed reference at your intended viewing distance. Narrow the range around the first failure, repeat, then confirm the fastest consistently passing setting on representative artwork. Allow some speed margin for daily use. No single pattern can guarantee perfect results on every drawing; short segments and circles may remain below the requested feed because of acceleration and controller limits. Longer lines help reveal ink starvation at sustained speed.

Record the chosen feed in the pen's results sheet. Machine settings and generation speed overrides use mm/min.

## Brush width and depth

This test requires a stepper Z lift with increasing Z lifting the pen. It does not infer actuator travel limits. Jog manually to find light contact and a deeper usable position, then check the safe lift. Enter absolute work Z values and a suitable Z movement speed. Never use a guessed deep position to discover the mechanical limit.

Each row draws two opposite-direction strokes at a fixed Z and one ramp from the lightest Z to that row's Z and back. Measure the widths after drying. Choose the lightest Z that consistently contacts the paper and the deepest Z that produces a clean wide stroke without excessive splaying or pooling. Ramps also show whether the pen recovers promptly. Z depth is a proxy for compression, not a force measurement. Coordinated XYZ ramps may run slower than flat strokes, particularly if Z is rate-limited.

Repeat at the intended drawing speed. Record a small Z-to-width table per pen, paper and speed. These results do not automatically add variable-width drawing to ordinary imported artwork.

## Lift clearance

Use the established contact Z for dashes, a checked safe lift Z above the highest candidate, and a candidate range above contact. Six dashes per row are separated by travel at that row's candidate lift Z. Clean gaps indicate sufficient clearance; a connecting mark indicates dragging. Numbers use the checked safe lift.

Choose the lowest repeatedly clean clearance with allowance for paper variation. Maximum lift remains the manually checked safe travel height; it cannot be determined from ink marks alone. Distinguish this pen-up clearance from the brush's lightest/deepest drawing Z values.

## Pen timing

Choose **Pen timing**, then select the pen-down or pen-up delay to vary. The default range is 0–300 ms. Each row draws six short dashes in alternating directions using that row's delay. The other delay stays at its machine-profile value, and row numbers use the normal profile delays.

For pen-down delay, inspect whether each dash begins cleanly at its intended start. For pen-up delay, inspect dash ends and the gaps for tails or connecting marks. Start with the other delay at a known reliable value, change one delay at a time, then repeat both tests with the chosen pair. Use the shortest delays that pass repeatedly with some allowance for variation. The results sheet records the tested delay and the fixed opposite delay; saving does not alter the profile.

## Geometry

Choose **Geometry** and enter a square side length of 80–250 mm that fits the bed. The pattern includes a measured square, both diagonals, and two concentric circles with diameters equal to the square side and half the square side. It draws at the specified speed using the profile's pen commands and delays.

Measure both horizontal sides, both vertical sides and both diagonals. Each diagonal should measure the side length multiplied by √2; a 100 mm square has approximately 141.42 mm diagonals. Unequal horizontal and vertical dimensions suggest different scale errors; unequal diagonals suggest the axes are not square. Compare the circles' horizontal and vertical diameters, closure, and changes of direction. Recheck at a slower speed to help distinguish geometry errors from motion at speed.

## Repeatability

Choose **Repeatability**, set the square side length and select 2–10 passes. Each pass retraces exactly the same square in the same direction, with a lift between passes and no deliberate offset. The paper carries one label; the results sheet lists the passes rather than separate positions on the page.

Inspect for doubled edges, separated corners or a widening band as passes accumulate. These can reveal offsets, lost position, mechanical play or movement of the paper or pen. Compare with a single-pass geometry test, and repeat at a slower speed if the traces separate. Retracing can also broaden a line through ink buildup, so use a stable pen and allow for its physical line width when judging alignment.

## Ink and hatching

Choose **Ink and hatching** and sweep line spacing from 0.1–10 mm (default 0.25–2 mm). Each row compares parallel hatching, crosshatching and a long continuous forward-and-return stroke at the fixed drawing speed. The spacing in the results sheet is the distance between line centres, not the remaining white gap.

Inspect the dried patches for bleeding, feathering, merged lines, pooling and paper damage. Compare the beginning and end of the continuous stroke for fading, gaps or reduced width that suggest ink starvation. Use the same paper, speed and pen mounting for comparisons. Repeat at the spacing and speed intended for artwork, since crossing strokes and fresh ink can behave differently from isolated lines.

Change one setting at a time. Keep paper, mounting and ink condition consistent so comparisons remain useful.

