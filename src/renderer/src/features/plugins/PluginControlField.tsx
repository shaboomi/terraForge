import { suggestedPluginPen } from "./pluginPens";
import type { PluginControl, PluginPen } from "../../../../types";

interface PluginControlFieldProps {
  control: PluginControl;
  palette?: PluginPen[];
  value: string | number | boolean;
  disabled: boolean;
  onChange: (value: string | number | boolean) => void;
}
const inputClass = "w-full min-w-0 rounded border border-border-ui bg-app px-2 py-1 text-xs text-content disabled:opacity-50";

export function PluginControlField({ control, value, disabled, onChange, palette = [] }: PluginControlFieldProps) {
  const id = `plugin-control-${control.key}`;
  if (control.type === "boolean") return (
    <label className="flex items-center gap-2 text-xs text-content" htmlFor={id}>
      <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      {control.label}
    </label>
  );
  let field;
  switch (control.type) {
    case "number": case "slider":
      field = <div className="flex items-center gap-2">
        <input id={id} className={inputClass} type={control.type === "slider" ? "range" : "number"} value={typeof value === "boolean" ? "" : value} min={control.min} max={control.max} step={control.step ?? "any"} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} />
        {(control.type === "slider" || control.unit) && <span className="shrink-0 text-xs text-content-muted">{control.type === "slider" ? String(value) : ""}{control.unit ? ` ${control.unit}` : ""}</span>}
      </div>;
      break;
    case "select":
      field = <select id={id} className={inputClass} value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)}>{control.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>;
      break;
    case "pen": {
      const selected = suggestedPluginPen(control, String(value), palette);
      field = <div><select id={id} className={inputClass} value={selected} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="">Choose a configured pen</option>
        {selected && !palette.some(pen => pen.id === selected) && <option value={selected}>Unavailable saved pen</option>}
        {palette.map(pen => <option key={pen.id} value={pen.id}>{pen.name} ({pen.color})</option>)}
      </select><p className="text-[10px] text-content-muted">Exact colour suggestions only. Choose your actual ink; four distinct pens are required for CMYK.</p></div>;
      break;
    }
    case "text":
      field = control.multiline ? <textarea id={id} rows={3} className={inputClass} value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} /> : <input id={id} className={inputClass} type="text" value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
      break;
    case "colour":
      field = <input id={id} className={`${inputClass} h-8`} type="color" value={String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value)} />;
      break;
  }
  return <div className="space-y-1"><label htmlFor={id} className="block text-xs text-content-muted">{control.label}</label>{field}</div>;
}
