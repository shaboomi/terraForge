import type { PluginEntry, PluginManifest } from "../../../../types";

/** Menu groupings are a presentation concern; the plugin manifest API stays unchanged. */
export const PLUGIN_MENU_CATEGORIES = [
  ["bitmap-filters", "Bitmap Filters"],
  ["bitmap-to-vector", "Bitmap to Vector"],
  ["generators", "Generators"],
  ["font-tools", "Font Tools"],
] as const;

export type PluginMenuCategory = typeof PLUGIN_MENU_CATEGORIES[number][0];

export function pluginMenuCategories(manifest: PluginManifest): PluginMenuCategory[] {
  if (manifest.category === "font-tool") return ["font-tools"];
  if (manifest.input === "bitmap") {
    const categories: PluginMenuCategory[] = [];
    if (manifest.outputs.includes("bitmap")) categories.push("bitmap-filters");
    if (manifest.outputs.includes("vector")) categories.push("bitmap-to-vector");
    return categories;
  }
  return ["generators"];
}

export function pluginsInCategory(entries: PluginEntry[], category: PluginMenuCategory): PluginEntry[] {
  return entries.filter((entry) => entry.manifest && !entry.error && pluginMenuCategories(entry.manifest).includes(category));
}
