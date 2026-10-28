import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Button } from "../../components/ui";
import { usePluginStore } from "./pluginStore";

export function PluginManagement({ open, onOpenChange, onClose }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClose: () => void;
}) {
  const entries = usePluginStore((state) => state.entries);
  const saving = usePluginStore((state) => state.saving);
  const loading = usePluginStore((state) => state.loading);
  const error = usePluginStore((state) => state.error);
  const setEnabled = usePluginStore((state) => state.setEnabled);
  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-70 bg-black/60" />
      <Dialog.Content onCloseAutoFocus={(event) => { event.preventDefault(); onClose(); }}
        onKeyDown={(event) => event.stopPropagation()}
        className="fixed inset-0 z-70 m-auto h-fit w-[420px] max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto rounded-lg border border-border-ui bg-panel p-4 shadow-2xl text-content space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Dialog.Title className="text-sm font-semibold">Manage Plugins</Dialog.Title>
          <Dialog.Close asChild><Button size="icon-sm" variant="ghost" aria-label="Close plugin management"><X size={16} /></Button></Dialog.Close>
        </div>
        <Dialog.Description className="text-xs text-content-muted">Save a plugin file in the plugin folder, then restart TerraForge. Enable only plugins you trust.</Dialog.Description>
        {loading && <p role="status" className="text-xs text-content-muted">Loading plugins…</p>}
        {error && <p role="alert" className="text-xs text-accent break-words">{error}</p>}
        {entries.length === 0 && !loading && <p className="text-xs text-content-muted">No plugins installed.</p>}
        {entries.filter((entry) => entry.manifest && !entry.error).map((entry) => <label key={entry.filename} className="flex items-start gap-3 rounded bg-app p-3 text-xs">
          <input type="checkbox" className="mt-0.5" aria-label={`Enable ${entry.manifest!.name}`} checked={entry.enabled}
            disabled={saving.includes(entry.manifest!.id)} onChange={(event) => void setEnabled(entry, event.target.checked)} />
          <span className="min-w-0 flex-1 break-words"><span className="block font-medium">{entry.manifest!.name}</span>
            <span className="block mt-1 text-content-muted">{entry.manifest!.description}</span>
            <span className="block mt-1 text-[10px] text-content-faint">v{entry.manifest!.version} · {entry.enabled ? "Enabled" : "Disabled"}</span>
          </span>
        </label>)}
        {entries.some((entry) => entry.error) && <section aria-label="Unavailable plugins" className="space-y-2 border-t border-border-ui pt-3">
          <h3 className="text-xs font-semibold text-content-muted">Unavailable plugins</h3>
          {entries.filter((entry) => entry.error).map((entry) => <div key={entry.filename} className="text-xs break-words"><p>{entry.filename}</p><p role="alert" className="text-accent">{entry.error}</p></div>)}
        </section>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
