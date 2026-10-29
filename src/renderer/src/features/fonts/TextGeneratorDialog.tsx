import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { v4 as uuid } from "uuid";
import { Plus, Trash2, Upload, X } from "lucide-react";
import { isVectorImport, type SvgImport } from "../../../../types";
import type { ProcessedFont } from "../../../../types/fonts";
import { Button } from "../../components/ui";
import { useCanvasStore } from "../../store/canvasStore";
import { createTextImport, DEFAULT_TEXT_SETTINGS, layoutText, MAX_TEXT_CHARACTERS, type TextSettings } from "./textLayout";

const inputStyle = "mt-1 w-full rounded border border-border-ui bg-app px-2 py-1.5 text-sm text-content";

export function TextGeneratorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fonts, setFonts] = useState<ProcessedFont[]>([]);
  const [fontId, setFontId] = useState("");
  const [settings, setSettings] = useState<TextSettings>(DEFAULT_TEXT_SETTINGS);
  const [editing, setEditing] = useState<SvgImport | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const font = fonts.find((item) => item.id === fontId);
  useEffect(() => {
    if (!open) return;
    let current = true;
    const selected = useCanvasStore.getState().selectedImport();
    const textImport = selected && isVectorImport(selected) && selected.textSource ? selected : null;
    setEditing(textImport);
    if (textImport?.textSource) {
      const { text, fontSizeMM, letterSpacingMM, lineSpacing, alignment } = textImport.textSource;
      setSettings({ text, fontSizeMM, letterSpacingMM, lineSpacing, alignment });
    }
    setError(null);
    setBusy("Loading font library…");
    void window.terraForge.fonts.list().then((items) => {
      if (!current) return;
      setFonts(items);
      setFontId((previous) => {
        const preferred = textImport?.textSource?.fontId ?? previous;
        return items.some((item) => item.id === preferred) ? preferred : items[0]?.id ?? "";
      });
      if (textImport?.textSource && !items.some((item) => item.id === textImport.textSource?.fontId)) {
        setError(`The original font “${textImport.textSource.fontName}” is no longer in the library. Import it again or choose another font.`);
      }
    }).catch((reason: unknown) => { if (current) setError(String(reason instanceof Error ? reason.message : reason)); })
      .finally(() => { if (current) setBusy(null); });
    return () => { current = false; };
  }, [open]);

  const preview = useMemo(() => {
    if (!font) return { layout: null, error: null };
    try { return { layout: layoutText(font, settings), error: null }; }
    catch (reason) { return { layout: null, error: reason instanceof Error ? reason.message : String(reason) }; }
  }, [font, settings]);
  const layout = preview.layout;
  const patch = <K extends keyof TextSettings,>(key: K, value: TextSettings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  const importFont = async () => {
    setBusy("Processing font centre lines and stroke widths…"); setError(null);
    try {
      const imported = await window.terraForge.fonts.importFont(settings.text);
      if (imported) { setFonts((items) => [...items.filter((item) => item.id !== imported.id), imported]); setFontId(imported.id); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const removeFont = async () => {
    if (!font) return;
    setBusy("Removing font from library…"); setError(null);
    try {
      await window.terraForge.fonts.remove(font.id);
      const remaining = fonts.filter((item) => item.id !== font.id);
      setFonts(remaining); setFontId(remaining[0]?.id ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  };
  const commit = (replace: boolean) => {
    if (!font || !layout) return;
    try {
      const item = createTextImport(font, settings, layout, replace && editing ? editing.id : uuid());
      const canvas = useCanvasStore.getState();
      if (replace && editing) {
        const current = canvas.imports.find((candidate) => candidate.id === editing.id);
        if (!current) throw new Error("The selected text was removed from the canvas. Add it as new text instead.");
        canvas.replaceImport(editing.id, { ...item, x: current.x, y: current.y, scale: current.scale,
          scaleX: current.scaleX, scaleY: current.scaleY, rotation: current.rotation, visible: current.visible });
      } else { canvas.addImport(item); canvas.selectImport(item.id); }
      onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const canAdd = !busy && !!font && !!layout?.paths.length && !layout.missingCharacters.length;

  return <Dialog.Root open={open} onOpenChange={onOpenChange}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
      <Dialog.Content className="fixed inset-0 z-50 m-auto h-fit max-h-[92vh] w-[960px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border-ui bg-panel p-5 text-content shadow-2xl"
        onKeyDown={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <Dialog.Title className="text-base font-semibold">Text generator</Dialog.Title>
          <Dialog.Close asChild><Button size="icon-sm" aria-label="Close text generator"><X size={16} /></Button></Dialog.Close>
        </div>
        <Dialog.Description className="mb-4 text-sm text-content-muted">Import a TTF or OTF font once, then place text as continuous centre-line vectors on the canvas. Stroke-width samples stay with the artwork for brush plotting.</Dialog.Description>
        <div className="grid gap-5 md:grid-cols-[300px_1fr]">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Font library</h3>
              <Button size="sm" disabled={!!busy} onClick={() => void importFont()}><Upload size={14} />Import TTF / OTF</Button>
            </div>
            <label className="block text-xs text-content-muted">Font
              <select aria-label="Text font" className={inputStyle} value={fontId} disabled={!!busy || !fonts.length} onChange={(event) => { setFontId(event.target.value); setError(null); }}>
                {!fonts.length && <option value="">Import a font to begin</option>}
                {[...fonts].sort((a, b) => a.name.localeCompare(b.name)).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <p className="text-xs text-content-muted">Type your text before importing to prioritise its characters. Large fonts process up to 768 characters.</p>
            {font && <div className="flex items-center justify-between gap-2 text-xs text-content-muted">
              <span>{Object.keys(font.glyphs).length} processed characters</span>
              <Button size="xs" disabled={!!busy} onClick={() => void removeFont()} aria-label="Delete selected font"><Trash2 size={12} />Delete font</Button>
            </div>}
            <label className="block text-xs text-content-muted">Font size (mm, em height)
              <input aria-label="Font size (mm)" className={inputStyle} type="number" min={1} max={1000} step={0.5} value={Number.isNaN(settings.fontSizeMM) ? "" : settings.fontSizeMM} onChange={(event) => patch("fontSizeMM", event.target.valueAsNumber)} />
            </label>
            <label className="block text-xs text-content-muted">Letter spacing (mm)
              <input aria-label="Letter spacing (mm)" className={inputStyle} type="number" min={-settings.fontSizeMM / 2} max={1000} step={0.1} value={Number.isNaN(settings.letterSpacingMM) ? "" : settings.letterSpacingMM} onChange={(event) => patch("letterSpacingMM", event.target.valueAsNumber)} />
            </label>
            <label className="block text-xs text-content-muted">Line spacing (multiplier)
              <input aria-label="Line spacing" className={inputStyle} type="number" min={0.5} max={5} step={0.1} value={Number.isNaN(settings.lineSpacing) ? "" : settings.lineSpacing} onChange={(event) => patch("lineSpacing", event.target.valueAsNumber)} />
            </label>
            <label className="block text-xs text-content-muted">Alignment
              <select aria-label="Text alignment" className={inputStyle} value={settings.alignment} onChange={(event) => patch("alignment", event.target.value as TextSettings["alignment"])}>
                <option value="left">Left</option><option value="center">Centre</option><option value="right">Right</option>
              </select>
            </label>
            <p className="text-xs text-content-muted">Select a pen and set its brush width / height calibration in Pens before creating G-code.</p>
          </div>
          <div className="min-w-0 space-y-3">
            <label className="block text-xs text-content-muted">Text
              <textarea aria-label="Text to generate" className={`${inputStyle} min-h-28 resize-y`} rows={4} value={settings.text} maxLength={MAX_TEXT_CHARACTERS * 2}
                onChange={(event) => patch("text", event.target.value)} placeholder="Enter your text" />
            </label>
            <div className="flex justify-between gap-2 text-xs text-content-muted"><span>Centre-line preview</span><span>{[...settings.text].length} / {MAX_TEXT_CHARACTERS} characters</span></div>
            <div className="flex min-h-52 items-center justify-center overflow-hidden rounded border border-border-ui bg-app p-4">
              {layout?.paths.length ? <svg role="img" aria-label="Text centre-line preview" viewBox={`0 0 ${layout.width} ${layout.height}`} className="max-h-72 w-full text-content" preserveAspectRatio="xMidYMid meet">
                {layout.paths.map((path) => <path key={path.id} d={path.d} fill="none" stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />)}
              </svg> : <p className="text-sm text-content-muted">{font ? "Enter text to preview its centre lines." : "Import a font to preview text."}</p>}
            </div>
            {layout && layout.paths.length > 0 && <p className="text-xs text-content-muted">{layout.width.toFixed(1)} × {layout.height.toFixed(1)} mm · {layout.paths.length} continuous strokes · widths {layout.minStrokeWidth.toFixed(2)}–{layout.maxStrokeWidth.toFixed(2)} mm</p>}
            {!!layout?.missingCharacters.length && <p role="alert" className="text-sm text-warning">This font does not contain these processed characters: {layout.missingCharacters.map((character) => `“${character}”`).join(", ")}. Choose another font or change the text.</p>}
            {font && font.warnings.length > 0 && <details className="text-xs text-content-muted"><summary className="cursor-pointer">Font processing notes</summary><ul className="mt-2 list-disc space-y-1 pl-4">{font.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
          </div>
        </div>
        {busy && <p role="status" className="mt-4 text-sm text-content-muted">{busy}</p>}
        {(error || preview.error) && <p role="alert" className="mt-4 text-sm text-warning">{error || preview.error}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Dialog.Close asChild><Button>Cancel</Button></Dialog.Close>
          {editing && <Button variant="secondary" disabled={!canAdd} onClick={() => commit(true)}>Update selected text</Button>}
          <Button variant="primary" disabled={!canAdd} onClick={() => commit(false)}><Plus size={14} />Add text to canvas</Button>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
