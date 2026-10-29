import { useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import type { LayerGroup } from "../../../../types";
import { PEN_TYPES, PEN_TYPE_LABELS, parsePenProfile, type DrawingPenType, type PenProfile } from "../../../../types/pens";
import { useCanvasStore } from "../../store/canvasStore";
import { usePenLibraryStore } from "../../store/penLibraryStore";
import { Button } from "../ui";

const inputStyle = "block w-full mt-1 bg-app border border-border-ui rounded px-2 py-1.5 text-sm text-content";
const numeric = (value: string) => value.trim() ? Number(value) : NaN;

function initial(pen: LayerGroup) {
  const profile = pen.penProfile;
  return {
    type: profile?.type ?? "fineliner" as DrawingPenType,
    tipWidth: String(profile?.tipWidthMM ?? 0.5),
    speed: profile?.maxDrawSpeedMMMin === undefined ? "" : String(profile.maxDrawSpeedMMMin),
    minWidth: String(profile?.brush?.minWidthMM ?? 0.2),
    maxWidth: String(profile?.brush?.maxWidthMM ?? 3),
    minZ: String(profile?.brush?.minZ ?? 0),
    maxZ: String(profile?.brush?.maxZ ?? -2),
  };
}

export function PenSpecificationsEditor({ pen }: { pen: LayerGroup }) {
  const [draft, setDraft] = useState(() => initial(pen));
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const updatePen = useCanvasStore((state) => state.updateLayerGroup);
  const savePen = usePenLibraryStore((state) => state.savePen);
  useEffect(() => { setDraft(initial(pen)); setError(""); }, [pen.id, pen.penProfile]);

  const apply = (toLibrary: boolean) => {
    setMessage("");
    try {
      const profile: PenProfile = parsePenProfile({
        id: pen.penProfile?.id ?? uuid(), name: pen.name, color: pen.color,
        type: draft.type, tipWidthMM: numeric(draft.tipWidth),
        ...(draft.speed.trim() ? { maxDrawSpeedMMMin: numeric(draft.speed) } : {}),
        ...(draft.type === "brush" ? { brush: {
          minWidthMM: numeric(draft.minWidth), maxWidthMM: numeric(draft.maxWidth),
          minZ: numeric(draft.minZ), maxZ: numeric(draft.maxZ),
        } } : {}),
      });
      if (toLibrary) savePen(profile);
      updatePen(pen.id, { penProfile: profile });
      setError("");
      setMessage(toLibrary ? "Pen saved to your library." : "Pen specifications applied to this layout.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the pen specifications."); }
  };

  const field = (key: keyof Omit<typeof draft, "type">, label: string, step = "0.01") => (
    <label className="block text-xs text-content-muted">{label}
      <input aria-label={label} type="number" step={step} value={draft[key]} onChange={(event) => {
        setDraft((current) => ({ ...current, [key]: event.target.value })); setMessage("");
      }} className={inputStyle} />
    </label>
  );

  return <section className="space-y-3 border-t border-border-ui pt-3" aria-label="Pen specifications">
    <h3 className="text-sm font-medium">Tip specifications</h3>
    <div className="grid grid-cols-2 gap-3">
      <label className="block text-xs text-content-muted">Pen type
        <select aria-label="Pen type" value={draft.type} onChange={(event) => {
          setDraft((current) => ({ ...current, type: event.target.value as DrawingPenType })); setMessage("");
        }} className={inputStyle}>
          {PEN_TYPES.map((type) => <option key={type} value={type}>{PEN_TYPE_LABELS[type]}</option>)}
        </select>
      </label>
      {field("tipWidth", "Tip width (mm)")}
    </div>
    {field("speed", "Maximum drawing speed (mm/min)", "1")}
    <p className="text-xs text-content-muted">Enter the highest successful speed from the pen calibration test. Leave blank to use the machine speed.</p>
    {draft.type === "brush" && <>
      <div className="grid grid-cols-2 gap-3">
        {field("minWidth", "Minimum brush width (mm)")}
        {field("maxWidth", "Maximum brush width (mm)")}
        {field("minZ", "Z at minimum width (mm)")}
        {field("maxZ", "Z at maximum width (mm)")}
      </div>
      <p className="text-xs text-content-muted">Measure two stroke widths and their absolute work Z heights. Centreline text interpolates between these heights and clamps to this measured range. Use a stepper Z machine where positive Z lifts the brush, with an absolute pen-up height above both measurements (for example G0 Z5). Disable ink service for height-controlled brush output.</p>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={() => apply(false)}>Apply specifications</Button>
      <Button size="sm" variant="primary" onClick={() => apply(true)}>Save pen to library</Button>
    </div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    {message && <p role="status" className="text-xs text-content-muted">{message}</p>}
  </section>;
}
