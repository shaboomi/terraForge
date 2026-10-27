import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { normalizeHexColor } from "../../../../types/colorUtils";
import { Button } from "../ui";

interface ColourPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}

const PALETTE = [
  ["White", "#ffffff"], ["Cream", "#fff4d6"], ["Kraft", "#b99566"],
  ["Yellow", "#facc15"], ["Orange", "#f97316"], ["Red", "#ef4444"],
  ["Pink", "#ec4899"], ["Purple", "#8b5cf6"], ["Blue", "#3b82f6"],
  ["Cyan", "#22d3ee"], ["Green", "#22c55e"], ["Grey", "#9ca3af"],
  ["Charcoal", "#374151"], ["Black", "#000000"],
] as const;

/** Presets and the system colour picker share a validated, opaque hex value. */
export function ColourPicker({ label, value, onChange, disabled = false }: ColourPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const id = useId();
  const color = normalizeHexColor(value) ?? "#ffffff";

  useEffect(() => { setDraft(value); setError(null); }, [value]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (!bounds) return;
      const width = Math.min(256, window.innerWidth - 16);
      const height = popup.current?.getBoundingClientRect().height ?? 320;
      setPosition({
        left: Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8)),
        top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - height - 8)),
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, error]);

  useEffect(() => {
    if (!open) return;
    popup.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, [open]);

  const choose = (next: string, close = false) => {
    setDraft(next);
    setError(null);
    if (next !== color) onChange(next);
    if (close) { setOpen(false); trigger.current?.focus(); }
  };
  const commit = () => {
    const normalized = normalizeHexColor(draft);
    if (!normalized) {
      setError("Enter a hex colour such as #aabbcc or #abc.");
      return;
    }
    choose(normalized);
  };

  return (
    <div ref={container} data-colour-picker={open ? "open" : undefined} className="inline-flex shrink-0" onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <Button ref={trigger} type="button" size="sm" disabled={disabled}
        aria-label={label} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
        title={disabled ? "Choose a page size first" : `Choose ${label.toLowerCase()}`}
        onClick={() => { setDraft(value); setError(null); setOpen((current) => !current); }}>
        <span aria-hidden="true" className="h-4 w-4 rounded border border-border-ui" style={{ backgroundColor: color }} />
        {label}<ChevronDown size={12} aria-hidden="true" />
      </Button>
      {open && <div ref={popup} id={id} role="dialog" aria-label={`${label} picker`}
        className="fixed z-80 w-64 max-w-[calc(100vw-16px)] max-h-[calc(100vh-16px)] overflow-y-auto rounded border border-border-ui bg-panel p-3 shadow-xl space-y-3"
        style={position}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-content">{label}</span>
          <Button type="button" size="sm" variant="ghost" aria-label={`Close ${label.toLowerCase()} picker`}
            onClick={() => { setOpen(false); trigger.current?.focus(); }}>×</Button>
        </div>
        <div role="group" aria-label={`${label} palette`} className="grid grid-cols-7 gap-2">
          {PALETTE.map(([name, hex]) => <button key={hex} type="button"
            aria-label={`${name} (${hex})`} aria-pressed={color === hex} title={`${name} ${hex}`}
            className={`h-6 w-6 rounded border border-border-ui focus-visible:outline-2 focus-visible:outline-accent ${color === hex ? "ring-2 ring-accent ring-offset-1 ring-offset-panel" : ""}`}
            style={{ backgroundColor: hex }} onClick={() => choose(hex, true)} />)}
        </div>
        <label className="flex items-center justify-between gap-2 text-xs text-content">
          Custom colour
          <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={color}
            className="h-8 w-12 cursor-pointer rounded border border-border-ui bg-app p-0.5"
            onChange={(event) => choose(event.target.value)} />
        </label>
        <label className="block space-y-1 text-xs text-content">
          Hex code
          <input type="text" aria-label={`${label} hex code`} value={draft} spellCheck={false}
            aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
            className="w-full rounded border border-border-ui bg-app px-2 py-1 text-sm text-content font-mono"
            onChange={(event) => { setDraft(event.target.value); setError(null); }}
            onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); } }} />
        </label>
        {error && <p id={`${id}-error`} role="alert" className="text-xs text-accent">{error}</p>}
      </div>}
    </div>
  );
}
