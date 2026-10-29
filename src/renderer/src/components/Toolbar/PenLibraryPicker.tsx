import { useMemo, useState } from "react";
import { PEN_TYPE_LABELS, parsePenProfile, type PenProfile } from "../../../../types/pens";
import { compareColorsLightFirst } from "../../../../types/colorUtils";
import { useCanvasStore } from "../../store/canvasStore";
import { usePenLibraryStore } from "../../store/penLibraryStore";
import { Button } from "../ui";

const inputStyle = "w-full bg-app border border-border-ui rounded px-2 py-1.5 text-sm text-content";

/** Reuses the existing layout pen for a library identity, including its assignments. */
export function selectLibraryPen(profile: PenProfile): string {
  const validated = parsePenProfile(profile);
  const canvas = useCanvasStore.getState();
  const existing = canvas.layerGroups.find((pen) => pen.penProfile?.id === validated.id);
  const id = existing?.id ?? canvas.addPen(validated.name, validated.color);
  canvas.updateLayerGroup(id, { name: validated.name, color: validated.color, penProfile: validated });
  canvas.setActivePen(id);
  canvas.applyPenToSelection(id);
  return id;
}

export function PenLibraryPicker() {
  const pens = usePenLibraryStore((state) => state.pens);
  const removePen = usePenLibraryStore((state) => state.removePen);
  const [filter, setFilter] = useState("");
  const [groupBy, setGroupBy] = useState("type");
  const [selectedId, setSelectedId] = useState("");
  const groups = useMemo(() => {
    const result = new Map<string, PenProfile[]>();
    for (const pen of [...pens].sort((a, b) => compareColorsLightFirst(a.color, b.color) || a.name.localeCompare(b.name))) {
      if (!`${pen.name} ${pen.type} ${pen.color}`.toLowerCase().includes(filter.toLowerCase().trim())) continue;
      const label = groupBy === "type" ? PEN_TYPE_LABELS[pen.type] : pen.color;
      result.set(label, [...(result.get(label) ?? []), pen]);
    }
    return [...result].sort(([a], [b]) => groupBy === "type" ? a.localeCompare(b) : compareColorsLightFirst(a, b));
  }, [pens, filter, groupBy]);
  const selected = groups.flatMap(([, entries]) => entries).find((pen) => pen.id === selectedId);

  return <section className="border-t border-border-ui mt-4 pt-4 space-y-3" aria-label="Saved pen library">
    <h3 className="text-sm font-medium">Pen library ({pens.length})</h3>
    <p className="text-xs text-content-muted">Saved pens are available in every layout.</p>
    {pens.length > 0 ? <>
      <input aria-label="Search pen library" placeholder="Search name, type or colour" value={filter} onChange={(event) => setFilter(event.target.value)} className={inputStyle} />
      <label className="block text-xs text-content-muted">Group library by
        <select aria-label="Group pen library by" value={groupBy} onChange={(event) => setGroupBy(event.target.value)} className={`${inputStyle} mt-1`}>
          <option value="type">Type</option><option value="colour">Colour</option>
        </select>
      </label>
      <select aria-label="Saved pen" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className={inputStyle}>
        <option value="">Choose a saved pen</option>
        {groups.map(([label, entries]) => <optgroup label={label} key={label}>
          {entries.map((pen) => <option key={pen.id} value={pen.id}>{pen.name} · {pen.color} · {pen.tipWidthMM} mm</option>)}
        </optgroup>)}
      </select>
      {groups.length === 0 && <p className="text-xs text-content-muted">No saved pens match this search.</p>}
      {selected && <p className="text-xs text-content-muted">{PEN_TYPE_LABELS[selected.type]} · {selected.color}{selected.maxDrawSpeedMMMin === undefined ? "" : ` · maximum ${selected.maxDrawSpeedMMMin} mm/min`}</p>}
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant="primary" disabled={!selected} onClick={() => { if (selected) selectLibraryPen(selected); }}>Use saved pen</Button>
        <Button size="sm" disabled={!selected} onClick={() => { if (selected) { removePen(selected.id); setSelectedId(""); } }}>Delete saved pen</Button>
      </div>
    </> : <p className="text-xs text-content-muted">Choose a layout pen, enter its specifications, then save it here for future use.</p>}
  </section>;
}
