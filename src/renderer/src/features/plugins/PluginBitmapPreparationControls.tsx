import { Button } from "../../components/ui";
import { DEFAULT_BITMAP_PREPARATION, type PluginBitmapPreparationSettings } from "../../../../types/pluginBitmapPreparation";
import { usePluginStore } from "./pluginStore";

export function PluginBitmapPreparationControls({ pluginId, disabled }: { pluginId: string; disabled: boolean }) {
  const saved = usePluginStore(state => state.bitmapPreparation[pluginId]);
  const set = usePluginStore(state => state.setBitmapPreparation);
  const settings = saved ?? DEFAULT_BITMAP_PREPARATION;
  const change = (patch: Partial<PluginBitmapPreparationSettings>) => set(pluginId, { ...settings, ...patch });
  const numbers = [
    ["blackPoint", "Black level", 0, 254, 1], ["whitePoint", "White level", 1, 255, 1],
    ["gamma", "Gamma", 0.1, 5, 0.1], ["contrast", "Contrast", 0, 3, 0.1],
    ["smoothing", "Smoothing (pixels)", 0, 4, 1],
  ] as const;
  return <fieldset disabled={disabled} className="space-y-2 border border-border-ui rounded p-2">
    <legend className="px-1 text-xs font-medium">Shared bitmap preparation</legend>
    <p className="text-[10px] text-content-muted">The plugin receives original pixels plus prepared tones. Colour channels do not assign pens or plotting order.</p>
    <div className="flex flex-wrap gap-1">
      <Button type="button" size="sm" disabled={disabled} onClick={() => set(pluginId, structuredClone(DEFAULT_BITMAP_PREPARATION))}>Original tones</Button>
      <Button type="button" size="sm" disabled={disabled} onClick={() => change({ contrast: 1.25, gamma: 1 })}>More contrast</Button>
    </div>
    {numbers.map(([key, label, min, max, step]) => <label key={key} className="block text-xs text-content-muted">
      {label}<input aria-label={`Preparation ${label}`} type="number" min={min} max={max} step={step}
        className="mt-1 w-full rounded border border-border-ui bg-app px-2 py-1 text-xs text-content"
        value={settings[key]} onChange={event => change({ [key]: event.target.valueAsNumber })} />
    </label>)}
    <label className="block text-xs text-content-muted">Colour separation
      <select aria-label="Preparation colour separation" value={settings.separation}
        className="mt-1 w-full rounded border border-border-ui bg-app px-2 py-1 text-xs text-content"
        onChange={event => change({ separation: event.target.value as PluginBitmapPreparationSettings["separation"] })}>
        <option value="none">Tones only</option><option value="cmyk">CMYK ink</option>
        <option value="rgb">RGB light (dark substrate)</option><option value="palette">Selected colours</option>
      </select>
    </label>
    {settings.separation === "palette" && <label className="block text-xs text-content-muted">Palette colours
      <input aria-label="Preparation palette colours" type="text" value={settings.palette.join(", ")}
        placeholder="#000000, #ff0000" maxLength={100}
        className="mt-1 w-full rounded border border-border-ui bg-app px-2 py-1 text-xs text-content"
        onChange={event => change({ palette: event.target.value.split(",").map(value => value.trim()) })} />
      <span className="block text-[10px]">Up to eight unique #RRGGBB colours, separated by commas. Choose real pens after Apply.</span>
    </label>}
  </fieldset>;
}
