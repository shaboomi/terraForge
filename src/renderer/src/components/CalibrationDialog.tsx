import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useMachineStore } from "../store/machineStore";
import { Button } from "./ui";
import { generateCalibration, type CalibrationKind } from "../features/calibration/calibration";

const advice: Record<CalibrationKind, string> = {
  speed: "Compare the long lines in both directions, sharp turns and circles. Reject gaps, waviness, corner rounding, uneven ink or shifted endpoints. Repeat near the first failing speed, then verify the fastest passing row on real artwork. Short paths may never reach the requested speed because of acceleration limits.",
  brush: "Lower Z gives more compression on a conventional Z lift. Measure each row’s two constant-depth strokes, then inspect its thin–thick–thin ramp. Record the lightest reliable contact and deepest clean stroke without splaying, pooling or damaging the tip. Width also depends on speed, direction and paper.",
  lift: "Each row draws six dashes with pen-up travel across the gaps. Gaps must remain completely clean. Select the lowest clearance Z that passes repeatedly across your paper, with a small allowance for paper unevenness. The maximum lift is the checked safe travel height, not a value this sheet can discover automatically.",
};

export function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const config = useMachineStore(s => s.configs.find(c => c.id === s.activeConfigId));
  const [kind, setKind] = useState<CalibrationKind>("speed");
  const [pen, setPen] = useState("");
  const [start, setStart] = useState("10");
  const [end, setEnd] = useState("60");
  const [rows, setRows] = useState("6");
  const [speed, setSpeed] = useState(String((config?.drawSpeed ?? 1200) / 60));
  const [length, setLength] = useState("100");
  const [liftZ, setLiftZ] = useState("");
  const [contactZ, setContactZ] = useState("");
  const [zFeed, setZFeed] = useState("120");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const result = useMemo(() => {
    if (!config) return { error: "Select a machine profile first." };
    try {
      const number = (value: string) => value.trim() ? Number(value) : NaN;
      return { sheet: generateCalibration(config, { kind, pen, start: number(start), end: number(end), rows: number(rows), speed: number(speed), length: number(length), liftZ: number(liftZ), contactZ: number(contactZ), zFeed: number(zFeed) }) };
    } catch (e) { return { error: (e as Error).message }; }
  }, [config, kind, pen, start, end, rows, speed, length, liftZ, contactZ, zFeed]);
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
          <label className="flex flex-col gap-1 text-xs">Test<select value={kind} onChange={e => { const next = e.target.value as CalibrationKind; setKind(next); setStart(next === "speed" ? "10" : ""); setEnd(next === "speed" ? "60" : ""); setMessage(""); }} className="bg-secondary border border-border-ui rounded p-1.5"><option value="speed">Speed and line quality</option><option value="brush">Brush width and depth</option><option value="lift">Lift clearance</option></select></label>
          <label className="flex flex-col gap-1 text-xs">Pen name<input value={pen} onChange={e => {setPen(e.target.value); setMessage("");}} placeholder="e.g. black felt tip, 0.8 mm" className="bg-secondary border border-border-ui rounded p-1.5" /></label>
        </div>
        <p className="text-sm text-content-muted">{advice[kind]}</p>
        {kind !== "speed" && <p className="text-sm">For stepper Z lifts with positive Z moving up. First jog to establish contact, check the entire test depth range and safe lift within the mechanism’s travel. Values below are absolute work Z in mm. Servo and solenoid lifts can use the speed test.</p>}
        <div className="grid grid-cols-3 gap-3">
          {field(kind === "speed" ? "Start speed (mm/s)" : kind === "brush" ? "Deepest test Z (mm)" : "Lowest clearance Z (mm)", start, setStart)}
          {field(kind === "speed" ? "End speed (mm/s)" : kind === "brush" ? "Lightest test Z (mm)" : "Highest clearance Z (mm)", end, setEnd)}
          {field("Rows (2–10)", rows, setRows)}
          {field("Reference / brush speed (mm/s)", speed, setSpeed)}
          {field("Long line length (mm)", length, setLength)}
          {kind !== "speed" && <>{field("Safe lift Z (mm)", liftZ, setLiftZ)}{field("Contact Z for labels / dashes (mm)", contactZ, setContactZ)}{field("Z movement speed (mm/min)", zFeed, setZFeed)}</>}
        </div>
        <p className="text-xs text-content-muted">Use a flat sheet at the configured work origin. Sheets extend inward from the origin corner (from the minimum X/Y corner for a centre origin). Keep the saved size and row order. Speed tests use the machine’s pen commands; all tests retain its pen delays.</p>
        {result.error && <p role="alert" className="text-sm text-content-muted">{result.error}</p>}
        {result.sheet && <div className="grid grid-cols-2 gap-4">
          <svg viewBox={`0 0 ${result.sheet.width} ${result.sheet.height}`} className="w-full max-h-64 border border-border-ui bg-white" aria-label="Calibration pattern schematic; rows progress away from the origin">
            {result.sheet.strokes.map((s,i) => <polyline key={i} points={s.points.map(p => `${p[0]},${p[1]}`).join(" ")} stroke="#222" strokeWidth="0.4" fill="none" />)}
          </svg>
          <div className="text-xs space-y-1"><p>{result.sheet.width} × {result.sheet.height} mm · numbered rows</p>{result.sheet.values.map((v,i) => <p key={i}>Row {i+1}: {Number(v.toFixed(4))} {kind === "speed" ? `mm/s (${Number((v*60).toFixed(1))} mm/min)` : "mm Z"}</p>)}</div>
        </div>}
        <details className="text-sm text-content-muted"><summary>Other useful calibration tests</summary><ul className="list-disc pl-5 space-y-1 mt-2"><li>Pen timing: repeated short dashes to find delays that prevent missing starts or trailing marks.</li><li>Geometry: a measured square, diagonals and circles to check scale, squareness and direction changes.</li><li>Repeatability: retrace the same square several times to reveal offsets or mechanical play.</li><li>Ink and hatching: compare line spacing, crosshatching and a long continuous stroke for bleeding or ink starvation.</li></ul></details>
        {message && <p role="status" className="text-sm">{message}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose} disabled={saving}>Close</Button><Button variant="primary" disabled={!result.sheet || saving} onClick={save}>{saving ? "Saving…" : "Save calibration test"}</Button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
