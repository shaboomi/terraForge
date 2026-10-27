import { Button } from "../../components/ui";
import type { SvgImport } from "../../../../types";
import { usePluginStore } from "./pluginStore";
import { pluginEditor } from "./pluginEditing";

export function PluginArtworkAction({ artwork }: { artwork: SvgImport }) {
  const entries = usePluginStore((state) => state.entries);
  const editImport = usePluginStore((state) => state.editImport);
  if (!artwork?.pluginSource) return null;
  const editor = pluginEditor(artwork, entries);
  const label = editor.entry ? `Edit with ${editor.entry.manifest.name}` : "Edit plugin settings";
  return <div className="pb-3 space-y-1">
    <Button size="sm" className="w-full" disabled={!!editor.error}
      onClick={() => editImport(artwork.id)}>{label}</Button>
    {editor.error && <p className="text-xs text-content-muted">{editor.error}</p>}
  </div>;
}
