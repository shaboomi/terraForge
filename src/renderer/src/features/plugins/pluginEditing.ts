import { isBitmapImport, type CanvasItem, type PluginEntry } from "../../../../types";
import { validatePluginParameters } from "../../../../types/pluginValidation";

/** Code differences are disclosed; only explicit Preview/Update can regenerate saved geometry. */
export function pluginEditor(artwork: CanvasItem | undefined, entries: PluginEntry[], imports?: CanvasItem[]) {
  if (!artwork?.pluginSource) return { error: "Select artwork created by a plugin." };
  const source = artwork.pluginSource;
  const entry = entries.find((item) => item.manifest?.id === source.pluginId);
  if (!entry?.manifest) return { error: "This artwork's plugin is not installed. The saved artwork is still available." };
  if (!entry.enabled || entry.error) return { error: "Enable this plugin in Plugins to edit its settings." };
  if (entry.manifest.version !== source.pluginVersion) return { error: `This artwork requires plugin version ${source.pluginVersion} to edit its settings.` };
  if (source.bitmapPreparation && !entry.manifest.bitmapPreparation) return { error: "The installed plugin no longer supports this result's saved bitmap preparation. The saved artwork remains usable." };
  if (entry.manifest.input !== "none") {
    if (!source.sourceId) return { error: "This result has no saved source reference. Select source artwork and open the plugin from Plugins to create a new result." };
    if (imports) {
      const input = imports.find((item) => item.id === source.sourceId);
      if (!input) return { error: "The source artwork is missing. The saved result remains available; restore its source to edit these settings." };
      if ((entry.manifest.input === "bitmap") !== isBitmapImport(input)) return { error: "The source artwork is no longer compatible with this plugin." };
    }
  }
  try {
    const parameters = validatePluginParameters(entry.manifest, source.parameters);
    const notice = !source.sourceFingerprint
      ? "This older result has no saved code fingerprint. Its original plugin code cannot be verified. Update artwork explicitly regenerates it with the installed code."
      : source.sourceFingerprint !== entry.sourceFingerprint
        ? "This result was created by different plugin code, even if the version is unchanged. Update artwork explicitly regenerates it with the installed code."
        : undefined;
    return { entry: { ...entry, manifest: entry.manifest }, parameters, notice };
  } catch {
    return { error: "The saved settings are incompatible with this plugin. The saved artwork is still available." };
  }
}

export function resolvePluginTarget(
  importId: string | null,
  pluginId: string,
  imports: CanvasItem[],
  entries: PluginEntry[],
): { target?: CanvasItem; error?: string } {
  if (!importId) return {};
  const target = imports.find((item) => item.id === importId);
  const editor = pluginEditor(target, entries, imports);
  if (!target || editor.error || target.pluginSource?.pluginId !== pluginId) {
    return { error: editor.error ?? "The artwork or its plugin is no longer available." };
  }
  return { target };
}
