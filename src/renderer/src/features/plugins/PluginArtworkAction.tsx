import { Button } from "../../components/ui";
import type { CanvasItem } from "../../../../types";
import { useCanvasStore } from "../../store/canvasStore";
import { usePluginStore } from "./pluginStore";
import { pluginEditor } from "./pluginEditing";

export function PluginArtworkAction({ artwork }: { artwork: CanvasItem }) {
  const entries = usePluginStore((state) => state.entries);
  const editImport = usePluginStore((state) => state.editImport);
  const imports = useCanvasStore((state) => state.imports);
  if (!artwork?.pluginSource) return null;
  const editor = pluginEditor(artwork, entries, imports);
  const group = artwork.pluginSource.outputGroupId;
  const count = group ? imports.filter((item) => item.pluginSource?.outputGroupId === group).length : 1;
  const label = editor.entry ? `Edit with ${editor.entry.manifest.name}` : "Edit plugin settings";
  return <div className="pb-3 space-y-1">
    {artwork.pluginSource.outputGroupName && <p className="text-xs text-content-muted">{artwork.pluginSource.outputGroupName} · {count} {count === 1 ? "item" : "items"}</p>}
    <Button size="sm" className="w-full" disabled={!!editor.error}
      onClick={() => editImport(artwork.id)}>{label}</Button>
    {editor.error && <p className="text-xs text-content-muted">{editor.error}</p>}
  </div>;
}
