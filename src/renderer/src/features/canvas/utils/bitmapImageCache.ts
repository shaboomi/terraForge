import { BITMAP_LIMITS } from "../../../../../types/bitmapValidation";
import type { BitmapAsset, BitmapAssetTable, CanvasItem } from "../../../../../types";

interface CachedBitmap {
  asset: BitmapAsset;
  image?: HTMLImageElement;
  status: "loading" | "ready" | "error";
}

/** The asset table has the same 32 MP aggregate limit; visible images never evict one another. */
export class BitmapImageCache {
  private readonly entries = new Map<string, CachedBitmap>();
  static readonly pixelBudget = BITMAP_LIMITS.totalDecodedPixels;

  constructor(
    private readonly invalidate: () => void,
    private readonly createImage: () => HTMLImageElement = () => new Image(),
  ) {}

  sync(assets: BitmapAssetTable, items: CanvasItem[]): void {
    const visible = new Set(items.filter((item) => item.kind === "bitmap" && item.visible).map((item) => item.kind === "bitmap" ? item.assetId : ""));
    for (const [id, entry] of this.entries) {
      const asset = assets[id];
      if (!visible.has(id) || !asset || asset.data !== entry.asset.data ||
          asset.widthPx !== entry.asset.widthPx || asset.heightPx !== entry.asset.heightPx) {
        this.release(entry);
        this.entries.delete(id);
      }
    }
    let pixels = 0;
    for (const id of visible) {
      const asset = assets[id];
      if (!asset) continue;
      pixels += asset.widthPx * asset.heightPx;
      if (this.entries.has(id)) continue;
      const entry: CachedBitmap = { asset, status: "loading" };
      this.entries.set(id, entry);
      if (!Number.isFinite(pixels) || pixels > BitmapImageCache.pixelBudget) {
        entry.status = "error";
        continue;
      }
      const image = this.createImage();
      entry.image = image;
      image.onload = () => {
        if (this.entries.get(id) !== entry) return;
        entry.status = image.naturalWidth === asset.widthPx && image.naturalHeight === asset.heightPx ? "ready" : "error";
        this.invalidate();
      };
      image.onerror = () => {
        if (this.entries.get(id) !== entry) return;
        entry.status = "error";
        this.invalidate();
      };
      image.src = `data:image/png;base64,${asset.data}`;
    }
  }

  get(id: string) {
    return this.entries.get(id);
  }

  clear(): void {
    for (const entry of this.entries.values()) this.release(entry);
    this.entries.clear();
  }

  private release(entry: CachedBitmap): void {
    if (!entry.image) return;
    entry.image.onload = null;
    entry.image.onerror = null;
    entry.image.src = "";
  }
}
