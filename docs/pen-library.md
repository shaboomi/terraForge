# Pen library

Open **Settings → Pens** to manage physical pens independently of a layout.

1. Enter a name, colour, type and tip width in mm.
2. Enter the highest successful calibrated drawing speed in **mm/min**, or leave it blank to use the job speed. Use the calibration sheet controls above the library to find suitable values.
3. For a brush, enter two measured widths and their absolute work Z heights. The selected tip width determines the contact height by interpolation, clamped to the measured range.
4. Select **Save pen to library**. Search saved pens and group them by type or colour. Choose a saved pen to edit its measurements, or **New pen** to create a separate entry.
5. To use a pen, select artwork on the canvas first, then return to **Settings → Pens**, choose the pen and select **Apply pen to selection**. Save the layout to preserve the assignment.

The assignment uses TerraForge's existing artwork groups. Reusing a saved pen reuses its group; other artwork remains unchanged. Each layout keeps a snapshot of the measurements. Later library edits or deletion do not silently change previously assigned artwork. Apply again to update a layout's snapshot.

Assigned pen speed limits apply to whole-job, per-group, per-colour, per-layer, hatching and point-tap output. The generated feed is the lower of the job speed and the pen's calibrated maximum. Path joining is disabled for assigned pens so different calibrations cannot be combined into one stroke. Path optimisation remains available.

Brush height output requires a stepper Z machine with positive Z lifting the brush. Use an absolute work-Z pen-up command above both measured contact heights, for example `G0 Z5`, and disable ink service. Contact moves use a controlled Z feed of 120 mm/min. The current adaptation uses a fixed contact height for each pen's selected tip width. Variable-width text and moving brush lead-ins belong to the separate font adaptation and are not included yet.

Pen assignments cannot be combined with vinyl cutting output; remove them before generating a cutting job. Machine lift commands and delays remain in **Settings → Machines**. Library pens are stored separately from layouts and survive clearing the canvas.
