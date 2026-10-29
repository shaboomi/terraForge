import { useId } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { Button } from "../../components/ui";
import { usePluginStore } from "./pluginStore";
import { PluginControlField } from "./PluginControlField";
import { useCanvasStore } from "../../store/canvasStore";
import { selectedPluginSource } from "./pluginProcessing";
import { pluginEditor } from "./pluginEditing";

export function PluginPanel() {
  const bodyId = useId();
  const entries = usePluginStore((state) => state.entries);
  const activeFilename = usePluginStore((state) => state.activeFilename);
  const editingImportId = usePluginStore((state) => state.editingImportId);
  const collapsed = usePluginStore((state) => state.collapsed);
  const canvas = useCanvasStore();
  const editingArtwork = canvas.imports.find((item) => item.id === editingImportId);
  const parameters = usePluginStore((state) => state.parameters);
  const detailBudgets = usePluginStore(state => state.detailBudgets);
  const setDetailBudget = usePluginStore(state => state.setDetailBudget);
  const running = usePluginStore((state) => state.running);
  const error = usePluginStore((state) => state.runError);
  const setCollapsed = usePluginStore((state) => state.setCollapsed);
  const closePanel = usePluginStore((state) => state.closePanel);
  const setParameter = usePluginStore((state) => state.setParameter);
  const resetParameters = usePluginStore((state) => state.resetParameters);
  const run = usePluginStore((state) => state.run);
  const cancel = usePluginStore((state) => state.cancel);
  const preview = usePluginStore((state) => state.preview);
  const previewRun = usePluginStore((state) => state.previewRun);
  const applyPreview = usePluginStore((state) => state.applyPreview);
  const discardPreview = usePluginStore((state) => state.discardPreview);
  const entry = entries.find((item) => item.filename === activeFilename);
  const manifest = entry?.manifest;
  if (!manifest) return null;
  const pluginUnavailable = !entry.enabled || !!entry.error;
  const unavailable = pluginUnavailable || (!!editingImportId && !editingArtwork);
  const processor = manifest.input !== "none";
  let selectionError: string | undefined;
  try { selectedPluginSource(manifest, canvas, editingImportId ?? undefined); }
  catch (reason) { selectionError = reason instanceof Error ? reason.message : String(reason); }
  const busy = !!running;
  const toggleLabel = collapsed ? "Expand plugin panel" : "Minimise plugin panel";
  return (
    <section aria-label={`Plugin: ${manifest.name}`} className="shrink-0 max-h-[55%] overflow-y-auto border-b border-border-ui p-3 space-y-3">
      <div className="flex items-center gap-1">
        <Button type="button" size="icon-sm" variant="ghost" aria-label={toggleLabel} title={toggleLabel}
          aria-expanded={!collapsed} aria-controls={bodyId} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </Button>
        <h3 className="min-w-0 flex-1 truncate text-xs font-semibold text-content" title={manifest.name}>{manifest.name}</h3>
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Close plugin panel" title="Close plugin panel" onClick={closePanel}>
          <X size={15} />
        </Button>
      </div>
      {!collapsed && <div id={bodyId} className="space-y-3">
        <div>
          <p className="text-[10px] text-content-faint">Plugin · v{manifest.version}</p>
          {editingArtwork && <p className="text-xs text-content-muted">Editing {editingArtwork.name}</p>}
          {editingArtwork && pluginEditor(editingArtwork, entries, canvas.imports).notice && <p role="status" className="text-xs text-content-muted">{pluginEditor(editingArtwork, entries, canvas.imports).notice}</p>}
          {editingImportId && !editingArtwork && <p className="text-xs text-content-muted">This artwork no longer exists. Open a plugin from Plugins to create new artwork.</p>}
          <p className="mt-1 text-xs text-content-muted">{manifest.description}</p>
        </div>
        {pluginUnavailable && <p className="text-xs text-content-muted">This plugin is disabled or unavailable. Enable it from Plugins to use it.</p>}
        {selectionError && <p className="text-xs text-content-muted">{selectionError}</p>}
        {processor && <p className="text-xs text-content-muted">Preview keeps the source artwork unchanged. Apply adds a separate result.</p>}
        {preview && <p role="status" className="text-xs text-content">Preview · {preview.items.length} {preview.items.length === 1 ? "item" : "items"}. Apply to keep this artwork.</p>}
        <form noValidate onSubmit={(event) => { event.preventDefault(); void (processor ? previewRun() : run()); }} className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="plugin-detail-budget" className="block text-xs text-content-muted">Artwork capacity</label>
            <select id="plugin-detail-budget" className="w-full rounded border border-border-ui bg-app px-2 py-1 text-xs text-content"
              value={detailBudgets[manifest.id] ?? "standard"} disabled={busy || unavailable}
              onChange={event => setDetailBudget(manifest.id, event.target.value === "extended" ? "extended" : "standard")}>
              <option value="standard">Standard — 100,000 points / 10,000 paths</option>
              <option value="extended">Extended 6× — 600,000 points / 60,000 paths</option>
            </select>
            <p className="text-[10px] text-content-muted">More capacity for detailed artwork. Your size settings stay unchanged. Calculation can take up to three minutes.</p>
          </div>
          {(manifest.controls ?? []).map((control) => <PluginControlField key={control.key} control={control} palette={canvas.layerGroups} value={parameters[manifest.id]?.[control.key] ?? control.default} disabled={busy || unavailable} onChange={(value) => setParameter(manifest.id, control.key, value)} />)}
          {error && <p role="alert" className="text-xs text-accent break-words">{error}</p>}
          <div className="flex flex-wrap gap-2">
            {busy ? <Button size="sm" type="button" onClick={cancel}>Cancel plugin</Button> : <>
              <Button size="sm" variant="primary" type="submit" disabled={unavailable || !!selectionError}>{processor ? "Preview" : editingImportId ? "Update artwork" : "Add artwork"}</Button>
              {!processor && <Button size="sm" type="button" disabled={unavailable || !!selectionError} onClick={() => void previewRun()}>Preview</Button>}
            </>}
            {preview && !busy && <>
              <Button size="sm" variant="primary" type="button" disabled={unavailable || !!selectionError} onClick={applyPreview}>{editingImportId ? "Update artwork" : "Apply artwork"}</Button>
              <Button size="sm" type="button" onClick={discardPreview}>Cancel preview</Button>
            </>}
            <Button size="sm" type="button" disabled={busy || unavailable} onClick={() => resetParameters(manifest.id)}>Reset</Button>
          </div>
        </form>
      </div>}
    </section>
  );
}
