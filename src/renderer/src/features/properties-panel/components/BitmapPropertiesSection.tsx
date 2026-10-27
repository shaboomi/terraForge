import type { BitmapImport, CanvasItem } from "../../../../../types";
import { useCanvasStore } from "../../../store/canvasStore";

export function BitmapPropertiesSection({ imp, onUpdate }: {
  imp: BitmapImport;
  onUpdate: (changes: Partial<CanvasItem>) => void;
}) {
  const asset = useCanvasStore((state) => state.assets[imp.assetId]);
  const opacity = Math.round(imp.opacity * 100);
  return <section aria-label="Bitmap properties" className="space-y-2 border-t border-border-ui/30 pt-2">
    <p className="text-xs text-content-muted">Bitmap · {asset ? `${asset.widthPx} × ${asset.heightPx} pixels` : "Image asset unavailable"}</p>
    <label className="block text-xs text-content-muted">
      Opacity (%)
      <input type="range" aria-label="Opacity (%)" min={0} max={100} step={1} value={opacity}
        className="mt-1 w-full" onChange={(event) => onUpdate({ opacity: Number(event.target.value) / 100 })} />
    </label>
    <p className="text-xs text-content-faint">{opacity}% · Bitmap images are reference artwork. Vector artwork is required for plotting.</p>
  </section>;
}
