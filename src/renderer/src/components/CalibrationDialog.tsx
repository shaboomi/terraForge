import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMachineStore } from "../store/machineStore";
import { Button } from "./ui";
import { generateCalibration, type CalibrationKind } from "../features/calibration/calibration";
import { parseCalibrationFont, type CalibrationFont } from "../features/calibration/calibrationText";

const advice: Record<CalibrationKind, string> = {
  speed: "Compare the long lines in both directions, sharp turns and circles. Reject gaps, waviness, corner rounding, uneven ink or shifted endpoints. Repeat near the first failing speed, then verify the fastest passing row on real artwork. Short paths may never reach the requested speed because of acceleration limits.",
  brush: "Lower Z gives more compression on a conventional Z lift. Measure each row’s two constant-depth strokes, then inspect its thin–thick–thin ramp. Record the lightest reliable contact and deepest clean stroke without splaying, pooling or damaging the tip. Width also depends on speed, direction and paper.",
  lift: "Each row draws six dashes with pen-up travel across the gaps. Gaps must remain completely clean. Select the lowest clearance Z that passes repeatedly across your paper, with a small allowance for paper unevenness. The maximum lift is the checked safe travel height, not a value this sheet can discover automatically.",
  timing: "Compare repeated short dashes while varying one delay at a time. For pen-down delay, find the shortest setting with complete starts. For pen-up delay, find the shortest setting with clean ends and gaps. Confirm the chosen settings together on another sheet.",
  geometry: "Measure the square sides and both diagonals after plotting. Equal sides and diagonals help reveal scale and squareness errors. Compare the circles and corners for uneven curves, overshoot or changes when direction reverses.",
  repeatability: "The pen retraces the same square for every pass, lifting between passes. Look for separated outlines, shifted corners or widening lines that reveal offsets or mechanical play. Use a fine pen so repeated lines are easy to compare.",
  hatching: "Compare parallel lines and crosshatching at each spacing for bleeding, pooling or gaps. Each row also includes a long continuous stroke: compare its beginning and end for fading, skips or ink starvation. Let the ink dry before judging the result.",
};

const ranges: Record<CalibrationKind, [string, string]> = {
  speed: ["600", "3600"], brush: ["", ""], lift: ["", ""],
  timing: ["0", "300"], geometry: ["", ""], repeatability: ["", ""], hatching: ["0.25", "2"],
};
const rangeLabels: Record<CalibrationKind, [string, string]> = {
  speed: ["Start speed (mm/min)", "End speed (mm/min)"],
  brush: ["Deepest test Z (mm)", "Lightest test Z (mm)"],
  lift: ["Lowest clearance Z (mm)", "Highest clearance Z (mm)"],
  timing: ["Start delay (ms)", "End delay (ms)"],
  hatching: ["Minimum line spacing (mm)", "Maximum line spacing (mm)"],
  geometry: ["", ""], repeatability: ["", ""],
};

export function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const config = useMachineStore(s => s.configs.find(c => c.id === s.activeConfigId));
  const [kind, setKind] = useState<CalibrationKind>("speed");
  const [pen, setPen] = useState("");
  const [start, setStart] = useState("600");
  const [end, setEnd] = useState("3600");
  const [rows, setRows] = useState("6");
  const [speed, setSpeed] = useState(String(config?.drawSpeed ?? 1200));
  const [timingMode, setTimingMode] = useState<"up" | "down">("down");
  const [length, setLength] = useState("100");
  const [liftZ, setLiftZ] = useState("");
  const [contactZ, setContactZ] = useState("");
  const [zFeed, setZFeed] = useState("120");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [font, setFont] = useState<CalibrationFont>();
  const [fontError, setFontError] = useState("");
  useEffect(() => {
    let cancelled = false;
    window.terraForge.fs.getCalibrationFont().then(parseCalibrationFont).then(loaded => {
      if (!cancelled) setFont(loaded);
    }).catch(error => { if (!cancelled) setFontError(`Could not load calibration text: ${String(error)}`); });
    return () => { cancelled = true; };
  }, []);
  const explicitZ = kind === "brush" || kind === "lift";
  const squareTest = kind === "geometry" || kind === "repeatability";
  const result = useMemo(() => {
    if (!config) return { error: "Select a machine profile first." };
    if (!font) return { error: fontError || "Loading system font for plotted labels…" };
    try {
      const number = (value: string) => value.trim() ? Number(value) : NaN;
      return { sheet: generateCalibration(config, { kind, pen, start: number(start), end: number(end), rows: number(rows), speed: number(speed), length: number(length), liftZ: number(liftZ), contactZ: number(contactZ), zFeed: number(zFeed), timingMode }, font) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [config, kind, pen, start, end, rows, speed, length, liftZ, contactZ, zFeed, timingMode, font, fontError]);
  const field = (label: string, value: string, setter: (v: string) => void) => <label className="flex flex-col gap-1 text-xs">{label}<input type="number" step="any" value={value} onChange={e => { setter(e.target.value); setMessage(""); }} className="bg-secondary border border-border-ui rounded px-2 py-1.5 text-content" /></label>;
  const save = async () => {
    if (!result.sheet) return;
    setSaving(true); setMessage("");
    try {
      const path = await window.terraForge.fs.saveGcodeDialog(`calibration-${kind}-${pen.replace(/[^a-z0-9_-]/gi, "_") || "pen"}.gcode`);
      if (!path) return;
      await window.terraForge.fs.writeFile(path, result.sheet.gcode);
      await window.terraForge.fs.writeFile(`${path}.txt`, result.sheet.record);
      setMessage("Saved the test and its row-by-row results sheet. Import the G-code to preview and plot it.");
    } catch (e) { setMessage(`Could not save the complete test: ${(e as Error).message}`); }
    finally { setSaving(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-panel border border-border-ui rounded-xl shadow-2xl p-6 w-[780px] max-w-[95vw] max-h-[90vh] overflow-auto text-content space-y-4">
        <Dialog.Title className="text-lg font-semibold">Pen calibration</Dialog.Title>
        <Dialog.Description className="text-sm text-content-muted">Create repeatable test sheets for each pen and paper combination. {config?.name}</Dialog.Description>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-xs">Test<select aria-label="Test" value={kind} onChange={e => { const next = e.target.value as CalibrationKind; setKind(next); setStart(ranges[next][0]); setEnd(ranges[next][1]); setMessage(""); }} className="bg-secondary border border-border-ui rounded p-1.5"><option value="speed">Speed and line quality</option><option value="brush">Brush width and depth</option><option value="lift">Lift clearance</option><option value="timing">Pen timing</option><option value="geometry">Geometry</option><option value="repeatability">Repeatability</option><option value="hatching">Ink and hatching</option></select></label>
          <label className="flex flex-col gap-1 text-xs">Pen name<input value={pen} maxLength={80} onChange={e => {setPen(e.target.value); setMessage("");}} placeholder="e.g. black felt tip, 0.8 mm" className="bg-secondary border border-border-ui rounded p-1.5" /></label>
        </div>
        <p className="text-sm text-content-muted">{advice[kind]}</p>
        {font && <p className="text-xs text-content-muted">Sheet text: {font.family}. Pen names are plotted on the sheet. Speed tests also include each row’s speed.</p>}
        {explicitZ && <p className="text-sm">For stepper Z lifts with positive Z moving up. First jog to establish contact, check the entire test depth range and safe lift within the mechanism’s travel. Values below are absolute work Z in mm.</p>}
        {kind === "timing" && <div className="space-y-2">
          <label className="flex flex-col gap-1 text-xs">Delay to test<select aria-label="Delay to test" value={timingMode} onChange={e => { setTimingMode(e.target.value as "up" | "down"); setMessage(""); }} className="bg-secondary border border-border-ui rounded p-1.5"><option value="down">Pen-down delay</option><option value="up">Pen-up delay</option></select></label>
          <p className="text-xs text-content-muted">The {timingMode === "down" ? "pen-up" : "pen-down"} delay stays at {timingMode === "down" ? config?.penUpDelayMs : config?.penDownDelayMs} ms from the machine profile. Saving a test does not change the profile.</p>
        </div>}
        <div className="grid grid-cols-3 gap-3">
          {!squareTest && <>
            {field(rangeLabels[kind][0], start, setStart)}
            {field(rangeLabels[kind][1], end, setEnd)}
          </>}
          {kind !== "geometry" && field(kind === "repeatability" ? "Passes (2–10)" : "Rows (2–10)", rows, setRows)}
          {field("Drawing / reference speed (mm/min)", speed, setSpeed)}
          {field(squareTest ? "Square side length (mm)" : "Long line length (mm)", length, setLength)}
          {explicitZ && <>{field("Safe lift Z (mm)", liftZ, setLiftZ)}{field("Contact Z for labels / dashes (mm)", contactZ, setContactZ)}{field("Z movement speed (mm/min)", zFeed, setZFeed)}</>}
        </div>
        <p className="text-xs text-content-muted">Use a flat sheet at the configured work origin. Sheets extend inward from the origin corner (from the minimum X/Y corner for a centre origin). Keep the saved size and drawing order. {explicitZ ? "This test uses the entered Z heights and the machine’s pen delays." : kind === "timing" ? "This test uses the machine’s pen commands and varies only the selected delay." : "This test uses the machine’s pen commands and delays."}</p>
        {result.error && <p role="alert" className="text-sm text-content-muted">{result.error}</p>}
        {result.sheet && <div className="grid grid-cols-2 gap-4">
          <svg viewBox={`0 0 ${result.sheet.width} ${result.sheet.height}`} className="w-full max-h-64 border border-border-ui bg-white" aria-label="Calibration pattern schematic; labels match the plotted orientation">
            <g transform={`translate(0 ${result.sheet.height}) scale(1 -1)`}>
              {result.sheet.strokes.map((s,i) => <polyline key={i} data-label={s.label} data-row={s.row} points={s.points.map(p => `${p[0]},${p[1]}`).join(" ")} stroke="#222" strokeWidth={s.label ? "0.15" : "0.4"} fill="none" />)}
            </g>
          </svg>
          <div className="text-xs space-y-1"><p>{result.sheet.width} × {result.sheet.height} mm</p>{result.sheet.rowDescriptions.map((description,i) => <p key={i}>{description}</p>)}</div>
        </div>}
        {message && <p role="status" className="text-sm">{message}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={saving}>Close</Button><Button variant="primary" disabled={!result.sheet || saving} onClick={save}>{saving ? "Saving…" : "Save calibration test"}</Button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
