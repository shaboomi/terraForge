import { isVectorImport, type CanvasItem, type PluginEntry, type SvgImport } from "../../../../types";
import { validatePluginParameters } from "../../../../types/pluginValidation";

/** Reopen only with the exact available plugin that created this artwork. */
export function pluginEditor(artwork: CanvasItem | undefined, entries: PluginEntry[]) {
  if (!artwork || !isVectorImport(artwork) || !artwork.pluginSource) return { error: "Select artwork created by a plugin." };
  const source = artwork.pluginSource;
  const entry = entries.find((item) => item.manifest?.id === source.pluginId);
  if (!entry?.manifest) return { error: "This artwork's plugin is not installed. You can still edit its vectors normally." };
  if (!entry.enabled || entry.error) return { error: "Enable this plugin in Plugins to edit its settings." };
  if (entry.manifest.version !== source.pluginVersion) return { error: `This artwork requires plugin version ${source.pluginVersion} to edit its settings.` };
  if (entry.manifest.input !== "none") return { error: "This plugin's settings cannot be edited in this version of TerraForge." };
  try {
    const parameters = validatePluginParameters(entry.manifest, source.parameters);
    return { entry: { ...entry, manifest: entry.manifest }, parameters };
  } catch {
    return { error: "The saved settings are incompatible with this plugin. You can still edit the artwork's vectors normally." };
  }
}

export function resolvePluginTarget(
  importId: string | null,
  pluginId: string,
  imports: CanvasItem[],
  entries: PluginEntry[],
): { target?: SvgImport; error?: string } {
  if (!importId) return {};
  const target = imports.find((item) => item.id === importId);
  const editor = pluginEditor(target, entries);
  if (!target || !isVectorImport(target) || editor.error || target.pluginSource?.pluginId !== pluginId) {
    return { error: editor.error ?? "The artwork or its plugin is no longer available." };
  }
  return { target };
}
