import type { PluginControl, PluginPen } from "../../../../types";

/** Only an exact configured colour is suggested. Missing saved IDs never remap. */
export function suggestedPluginPen(control: PluginControl, value: string, palette: PluginPen[]): string {
  if (value || control.type !== "pen" || !control.suggestedColor) return value;
  const matches = palette.filter(pen => pen.color.toLowerCase() === control.suggestedColor!.toLowerCase());
  return matches.length === 1 ? matches[0].id : "";
}
