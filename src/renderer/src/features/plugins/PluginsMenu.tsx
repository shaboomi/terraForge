import { useEffect, useRef, useState } from "react";
import { Puzzle } from "lucide-react";
import { Button } from "../../components/ui";
import { PLUGIN_CATEGORIES } from "./pluginHelpers";
import { usePluginStore } from "./pluginStore";

export function PluginsMenu() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const entries = usePluginStore((state) => state.entries);
  const loading = usePluginStore((state) => state.loading);
  const saving = usePluginStore((state) => state.saving);
  const error = usePluginStore((state) => state.error);
  const refresh = usePluginStore((state) => state.refresh);
  const select = usePluginStore((state) => state.select);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  const openFolder = usePluginStore((state) => state.openFolder);
  const installExample = usePluginStore((state) => state.installExample);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  return (
    <div className="relative" ref={container}>
      <Button onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="dialog" icon={<Puzzle size={15} />}>Plugins</Button>
      {open && <div role="dialog" aria-label="Plugins" className="absolute left-0 top-full mt-2 z-70 w-80 max-h-[75vh] overflow-y-auto rounded border border-border-ui bg-panel shadow-xl p-3 space-y-3">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-content">Plugins</h2><Button size="sm" variant="ghost" aria-label="Close Plugins" onClick={() => setOpen(false)}>×</Button></div><p className="text-xs text-content-muted">Save a plugin file in the plugin folder, then restart TerraForge. Enable only plugins you trust.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void openFolder()}>Open Plugin Folder</Button>
          <Button size="sm" disabled={loading} onClick={() => void installExample()}>Add Example Generator</Button>
        </div>
        {loading && <p role="status" className="text-xs text-content-muted">Loading plugins…</p>}
        {error && <p role="alert" className="text-xs text-accent break-words">{error}</p>}
        {PLUGIN_CATEGORIES.map(([category, label]) => {
          const group = entries.filter((entry) => entry.manifest?.category === category && !entry.error);
          return <section key={category} aria-label={label} className="space-y-1">
            <h3 className="text-xs font-semibold text-content-muted">{label}</h3>
            {group.length === 0 && <p className="text-xs text-content-faint">None installed</p>}
            {group.map((entry) => <div key={entry.filename} className="flex items-center gap-2 rounded bg-app p-2">
              <input type="checkbox" aria-label={`Enable ${entry.manifest!.name}`} checked={entry.enabled} disabled={saving.includes(entry.manifest!.id)} onChange={(event) => void setEnabled(entry, event.target.checked)} />
              <Button size="sm" variant="ghost" className="min-w-0 flex-1 justify-start text-left" disabled={!entry.enabled} onClick={() => { select(entry); setOpen(false); window.dispatchEvent(new Event("terraforge:show-properties")); }}>{entry.manifest!.name}</Button>
              <span className="text-[10px] text-content-faint">{entry.enabled ? "Enabled" : "Disabled"}</span>
            </div>)}
          </section>;
        })}
        {entries.some((entry) => entry.error) && <section aria-label="Unavailable plugins" className="space-y-2">
          <h3 className="text-xs font-semibold text-content-muted">Unavailable plugins</h3>
          {entries.filter((entry) => entry.error).map((entry) => <div key={entry.filename} className="text-xs break-words"><p className="text-content">{entry.filename}</p><p role="alert" className="text-accent">{entry.error}</p></div>)}
        </section>}
      </div>}
    </div>
  );
}


