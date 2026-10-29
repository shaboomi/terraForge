import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PenLine, Plus, X } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { isVectorImport, type LayerGroup } from "../../../../types";
import { compareColorsLightFirst } from "../../../../types/colorUtils";
import { useCanvasStore } from "../../store/canvasStore";
import { ColourPicker } from "./ColourPicker";
import { Button } from "../ui";
import { PenSpecificationsEditor } from "./PenSpecificationsEditor";
import { PenLibraryPicker } from "./PenLibraryPicker";

function PenEditor({ pen }: { pen: LayerGroup }) {
  const updatePen = useCanvasStore((state) => state.updateLayerGroup);
  const [name, setName] = useState(pen.name);
  useEffect(() => setName(pen.name), [pen.name]);
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label="Pen name"
        value={name}
        maxLength={80}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed) updatePen(pen.id, { name: trimmed });
          else setName(pen.name);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="min-w-0 flex-1 bg-app border border-border-ui rounded px-2 py-1 text-sm text-content"
      />
      <ColourPicker label="Pen colour" value={pen.color} onChange={(color) => updatePen(pen.id, { color })} />
    </div>
  );
}

/** Named pens share the layout's existing multi-pen artwork groups. */
export function PenColourControls() {
  const { layerGroups, imports, selectedImportId, selectedGroupId, allImportsSelected, activePenId, setActivePen, addPen, applyPenToSelection, removeLayerGroup } = useCanvasStore(useShallow((state) => ({
    layerGroups: state.layerGroups,
    imports: state.imports,
    selectedImportId: state.selectedImportId,
    selectedGroupId: state.selectedGroupId,
    allImportsSelected: state.allImportsSelected,
    activePenId: state.activePenId,
    setActivePen: state.setActivePen,
    addPen: state.addPen,
    applyPenToSelection: state.applyPenToSelection,
    removeLayerGroup: state.removeLayerGroup,
  })));
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#000000");
  const pens = [...layerGroups].sort((a, b) => compareColorsLightFirst(a.color, b.color));
  const activePen = pens.find((pen) => pen.id === activePenId);
  const selectedGroup = layerGroups.find((group) => group.id === selectedGroupId);
  const selectionCount = imports.filter((item) => isVectorImport(item) && (
    allImportsSelected || item.id === selectedImportId || !!selectedGroup?.importIds.includes(item.id)
  )).length;

  const choosePen = (id: string | null) => {
    setActivePen(id);
    applyPenToSelection(id);
  };

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button size="sm" aria-label="Pen colours" title="Choose and add pen colours">
          <PenLine size={14} aria-hidden="true" />
          {activePen && <span aria-hidden="true" className="h-3 w-3 rounded border border-border-ui" style={{ backgroundColor: activePen.color }} />}
          <span className="max-w-32 truncate">{activePen ? `Pens: ${activePen.name}` : `Pens${pens.length > 0 ? ` (${pens.length})` : ""}`}</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content onEscapeKeyDown={(event) => {
          if (event.target instanceof Element && event.target.closest('[data-colour-picker="open"]')) event.preventDefault();
        }} className="fixed inset-0 m-auto h-fit z-50 w-[420px] max-w-[calc(100vw-2rem)] max-h-[90vh] rounded-lg border border-border-ui bg-panel p-5 shadow-2xl text-content overflow-y-auto">
          <div className="flex items-center justify-between gap-3 mb-2">
            <Dialog.Title className="font-semibold text-base">Pen colours</Dialog.Title>
            <Dialog.Close asChild>
              <Button size="icon-sm" aria-label="Close pen colours"><X size={16} /></Button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-sm text-content-muted mb-4">
            Choose a pen for selected artwork and future vector imports. Pens are ordered from lightest to darkest.
          </Dialog.Description>
          {pens.length > 0 && (
              <label className="block text-xs text-content-muted">
                Pen
                <select
                  aria-label="Pen"
                  value={activePen?.id ?? ""}
                  onChange={(event) => choosePen(event.target.value || null)}
                  className="block w-full mt-1 bg-app border border-border-ui rounded px-2 py-1.5 text-sm text-content"
                >
                  <option value="">Original SVG colours</option>
                  {pens.map((pen, index) => <option key={pen.id} value={pen.id}>{index + 1}. {pen.name} ({pen.color})</option>)}
                </select>
              </label>
          )}
          {activePen ? (
            <div className="space-y-3">
              <PenEditor key={activePen.id} pen={activePen} />
              <PenSpecificationsEditor key={`specs-${activePen.id}`} pen={activePen} />
              <div className="flex items-center justify-between gap-2">
                <Button size="sm" variant="primary" disabled={selectionCount === 0} onClick={() => applyPenToSelection(activePen.id)}>
                  Apply pen to selection
                </Button>
                <Button size="sm" onClick={() => removeLayerGroup(activePen.id)} title="Remove pen and keep its artwork">Remove pen</Button>
              </div>
              <p className="text-xs text-content-muted" aria-live="polite">
                {selectionCount > 0 ? `${selectionCount} vector object${selectionCount === 1 ? "" : "s"} selected.` : "Select vector artwork on the canvas to apply a pen."}
              </p>
            </div>
          ) : <p className="text-sm text-content-muted mb-3">{pens.length > 0 ? "Original SVG colours will be used. Choose a pen above to override them." : "Add your first pen below."}</p>}
          <div className="border-t border-border-ui mt-4 pt-4 space-y-3">
            <h3 className="text-sm font-medium">Add a pen</h3>
            <input
              aria-label="New pen name"
              value={newName}
              maxLength={80}
              placeholder="e.g. Warm grey"
              onChange={(event) => setNewName(event.target.value)}
              className="w-full bg-app border border-border-ui rounded px-2 py-1.5 text-sm text-content"
            />
            <div className="flex items-center justify-between gap-2">
              <ColourPicker label="New pen colour" value={newColor} onChange={setNewColor} />
              <Button size="sm" variant="primary" onClick={() => {
                choosePen(addPen(newName.trim() || `Pen ${pens.length + 1}`, newColor));
                setNewName("");
              }}><Plus size={14} />Add pen</Button>
            </div>
          </div>
          <PenLibraryPicker />
          <p className="text-xs text-content-muted mt-4">Save your layout to keep its page colour, pen assignments and artwork. Save pens to the library to reuse them in other layouts.</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
