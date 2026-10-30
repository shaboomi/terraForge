import { useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import { PEN_TYPES, PEN_TYPE_LABELS, parsePenProfile, type PenProfile, type DrawingPenType } from "../../../../../types/pens";
import { compareColorsLightFirst } from "../../../../../types/colorUtils";
import { usePenLibraryStore } from "../../../store/penLibraryStore";
import { useCanvasStore } from "../../../store/canvasStore";
import { Button } from "../../ui";

const inputStyle = "block w-full mt-1 bg-app border border-border-ui rounded px-2 py-1.5 text-sm text-content";
const emptyDraft = () => ({ id: uuid(), name: "", color: "#000000", type: "fineliner" as DrawingPenType,
  tipWidth: "0.5", speed: "", minWidth: "0.2", maxWidth: "3", minZ: "0", maxZ: "-2" });
const numeric = (value: string) => value.trim() ? Number(value) : NaN;

/** Apply a detached calibration snapshot using upstream's existing artwork groups. */
export function applyLibraryPen(profile: PenProfile): string {
  const pen = parsePenProfile(profile);
  const canvas = useCanvasStore.getState();
  const selectedGroup = canvas.layerGroups.find(group => group.id === canvas.selectedGroupId);
  const selected = canvas.imports.filter(item => canvas.allImportsSelected ||
    (selectedGroup ? selectedGroup.importIds.includes(item.id) : item.id === canvas.selectedImportId));
  if (!selected.length) throw new Error("Select artwork on the canvas before applying a pen.");
  let group = canvas.layerGroups.find(entry => entry.penProfile?.id === pen.id);
  if (!group) {
    canvas.addLayerGroup(pen.name, pen.color);
    group = useCanvasStore.getState().layerGroups.at(-1)!;
  }
  canvas.updateLayerGroup(group.id, { name: pen.name, color: pen.color, penProfile: pen });
  for (const item of selected) canvas.assignImportToGroup(item.id, group.id);
  canvas.selectGroup(group.id);
  return group.id;
}

export function PenLibrarySettings() {
  const pens = usePenLibraryStore(s => s.pens);
  const savePen = usePenLibraryStore(s => s.savePen);
  const removePen = usePenLibraryStore(s => s.removePen);
  const [draft, setDraft] = useState(emptyDraft);
  const [filter, setFilter] = useState("");
  const [groupBy, setGroupBy] = useState("type");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const groups = useMemo(() => {
    const result = new Map<string, PenProfile[]>();
    for (const pen of [...pens].sort((a, b) => compareColorsLightFirst(a.color, b.color) || a.name.localeCompare(b.name))) {
      if (!`${pen.name} ${pen.type} ${pen.color}`.toLowerCase().includes(filter.trim().toLowerCase())) continue;
      const label = groupBy === "type" ? PEN_TYPE_LABELS[pen.type] : pen.color;
      result.set(label, [...(result.get(label) ?? []), pen]);
    }
    return [...result].sort(([a], [b]) => groupBy === "type" ? a.localeCompare(b) : compareColorsLightFirst(a, b));
  }, [pens, filter, groupBy]);
  const load = (id: string) => {
    const pen = pens.find(entry => entry.id === id);
    setDraft(pen ? { id: pen.id, name: pen.name, color: pen.color, type: pen.type,
      tipWidth: String(pen.tipWidthMM), speed: pen.maxDrawSpeedMMMin === undefined ? "" : String(pen.maxDrawSpeedMMMin),
      minWidth: String(pen.brush?.minWidthMM ?? 0.2), maxWidth: String(pen.brush?.maxWidthMM ?? 3),
      minZ: String(pen.brush?.minZ ?? 0), maxZ: String(pen.brush?.maxZ ?? -2) } : emptyDraft());
    setMessage(""); setError("");
  };
  const profile = () => parsePenProfile({ id: draft.id, name: draft.name, color: draft.color, type: draft.type,
    tipWidthMM: numeric(draft.tipWidth), ...(draft.speed.trim() ? { maxDrawSpeedMMMin: numeric(draft.speed) } : {}),
    ...(draft.type === "brush" ? { brush: { minWidthMM: numeric(draft.minWidth), maxWidthMM: numeric(draft.maxWidth),
      minZ: numeric(draft.minZ), maxZ: numeric(draft.maxZ) } } : {}) });
  const act = (action: () => void) => {
    setError(""); setMessage("");
    try { action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const field = (key: keyof Omit<typeof draft, "type" | "id">, label: string, type = "number") =>
    <label className="block text-xs text-content-muted">{label}<input type={type} step="any" value={draft[key]}
      onChange={event => { setDraft(current => ({ ...current, [key]: event.target.value })); setMessage(""); }} className={inputStyle} /></label>;
  const saved = pens.some(pen => pen.id === draft.id);
  return <section aria-label="Pen library" className="border-t border-border-ui pt-5 space-y-3">
    <h2 className="text-base font-semibold">Pen library ({pens.length})</h2>
    <p className="text-sm text-content-muted">Save physical pens and measured speeds for use across layouts. Applying a pen assigns the selected artwork to its named group.</p>
    <div className="grid grid-cols-2 gap-3">
      <label className="text-xs text-content-muted">Search pen library<input type="search" value={filter} onChange={e => setFilter(e.target.value)} className={inputStyle} /></label>
      <label className="text-xs text-content-muted">Group library by<select aria-label="Group library by" value={groupBy} onChange={e => setGroupBy(e.target.value)} className={inputStyle}><option value="type">Type</option><option value="colour">Colour</option></select></label>
    </div>
    <label className="block text-xs text-content-muted">Saved pen<select aria-label="Saved pen" value={saved ? draft.id : ""} onChange={e => load(e.target.value)} className={inputStyle}>
      <option value="">New pen</option>{groups.map(([label, entries]) => <optgroup label={label} key={label}>
        {entries.map(pen => <option key={pen.id} value={pen.id}>{pen.name} · {pen.color} · {pen.tipWidthMM} mm</option>)}
      </optgroup>)}
    </select></label>
    <div className="grid grid-cols-2 gap-3">
      {field("name", "Pen name", "text")}{field("color", "Pen colour", "color")}
      <label className="text-xs text-content-muted">Pen type<select aria-label="Pen type" value={draft.type} onChange={e => setDraft(current => ({ ...current, type: e.target.value as DrawingPenType }))} className={inputStyle}>
        {PEN_TYPES.map(type => <option key={type} value={type}>{PEN_TYPE_LABELS[type]}</option>)}
      </select></label>
      {field("tipWidth", "Tip width (mm)")}{field("speed", "Maximum drawing speed (mm/min)")}
    </div>
    <p className="text-xs text-content-muted">Enter the highest successful calibration speed, or leave blank to use the job speed. Assigned pens cap drawing speeds in generated G-code.</p>
    {draft.type === "brush" && <>
      <div className="grid grid-cols-2 gap-3">{field("minWidth", "Minimum brush width (mm)")}{field("maxWidth", "Maximum brush width (mm)")}{field("minZ", "Z at minimum width (mm)")}{field("maxZ", "Z at maximum width (mm)")}</div>
      <p className="text-xs text-content-muted">Measure widths at two absolute work Z heights. Plotting uses the height for the selected tip width, clamped to this range. Requires a stepper Z lift, positive Z lifting the brush, an absolute pen-up command above both heights, and ink service disabled.</p>
    </>}
    <div className="flex flex-wrap gap-2">
      <Button variant="primary" onClick={() => act(() => { savePen(profile()); setMessage("Pen saved to your library."); })}>Save pen to library</Button>
      <Button onClick={() => act(() => { applyLibraryPen(profile()); setMessage("Pen applied to selected artwork. Save the layout to keep this assignment."); })}>Apply pen to selection</Button>
      <Button onClick={() => load("")}>New pen</Button>
      <Button disabled={!saved} onClick={() => { removePen(draft.id); load(""); setMessage("Saved pen removed. Existing layout assignments are unchanged."); }}>Delete saved pen</Button>
    </div>
    {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

