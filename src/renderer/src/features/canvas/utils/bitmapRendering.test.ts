import { describe, expect, it, vi } from "vitest";
import type { BitmapAsset, BitmapImport, SvgImport } from "../../../../../types";
import { BitmapImageCache } from "./bitmapImageCache";
import { drawImportsLayer } from "./toolpathOverlayDraw";
import { drawBitmapImport } from "./bitmapDraw";
import { MM_TO_PX, PAD } from "../constants";

const asset: BitmapAsset = { id: "image", mimeType: "image/png", data: "cG5n", widthPx: 200, heightPx: 100 };
const bitmap: BitmapImport = { id: "bitmap", kind: "bitmap", name: "reference", assetId: asset.id, opacity: 0.6, x: 10, y: 15, scale: 0.2, scaleX: 0.3, scaleY: 0.4, rotation: 30, visible: true, svgWidth: 200, svgHeight: 100, viewBoxX: 0, viewBoxY: 0 };
function fakeImage(width = 200, height = 100) {
  return { src: "", naturalWidth: width, naturalHeight: height, onload: null, onerror: null } as unknown as HTMLImageElement;
}
function loadedCache() {
  const image = fakeImage();
  const cache = new BitmapImageCache(vi.fn(), () => image);
  cache.sync({ image: asset }, [bitmap]);
  image.onload!.call(image, new Event("load"));
  return { cache, image };
}
function context() {
  const order: string[] = [];
  const ctx = { save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(), translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(), setLineDash: vi.fn(), stroke: vi.fn(() => order.push("vector")), drawImage: vi.fn(() => order.push("bitmap")), fillRect: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), globalAlpha: 1, strokeStyle: "", fillStyle: "", lineWidth: 1, font: "" };
  return { ctx, order, drawing: ctx as unknown as CanvasRenderingContext2D };
}

describe("bitmap image cache", () => {
  it("decodes a shared visible asset once and redraws when ready", () => {
    const invalidate = vi.fn(); const image = fakeImage(); const create = vi.fn(() => image);
    const cache = new BitmapImageCache(invalidate, create);
    cache.sync({ image: asset }, [bitmap, { ...bitmap, id: "copy" }]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(image.src).toBe("data:image/png;base64,cG5n");
    expect(cache.get(asset.id)?.status).toBe("loading");
    image.onload!.call(image, new Event("load"));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(cache.get(asset.id)?.status).toBe("ready");
    cache.sync({ image: asset }, [{ ...bitmap, x: 30 }]);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it("releases changed, hidden and removed image resources", () => {
    const first = fakeImage(); const second = fakeImage();
    const create = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const cache = new BitmapImageCache(vi.fn(), create);
    cache.sync({ image: asset }, [bitmap]);
    cache.sync({ image: { ...asset, data: "changed" } }, [bitmap]);
    expect(first.src).toBe(""); expect(first.onload).toBeNull();
    expect(second.src).toBe("data:image/png;base64,changed");
    cache.sync({ image: asset }, [{ ...bitmap, visible: false }]);
    expect(second.src).toBe(""); expect(cache.get(asset.id)).toBeUndefined();
    cache.clear();
    expect(second.onerror).toBeNull();
  });
  it("reports failed or dimension-mismatched decoding and does not repaint-loop", () => {
    const image = fakeImage(1, 1); const invalidate = vi.fn(); const cache = new BitmapImageCache(invalidate, () => image);
    cache.sync({ image: asset }, [bitmap]);
    image.onload!.call(image, new Event("load"));
    expect(cache.get(asset.id)?.status).toBe("error");
    cache.sync({ image: asset }, [bitmap]);
    expect(invalidate).toHaveBeenCalledTimes(1);
    image.onerror!.call(image, new Event("error"));
    expect(cache.get(asset.id)?.status).toBe("error");
  });
  it("bounds decoded pixels without evicting and repeatedly decoding visible images", () => {
    const a = { ...asset, id: "a", widthPx: 4096, heightPx: 4096 };
    const b = { ...a, id: "b" }; const c = { ...asset, id: "c", widthPx: 1, heightPx: 1 };
    const items = [a, b, c].map((entry) => ({ ...bitmap, id: entry.id, assetId: entry.id }));
    const create = vi.fn(() => fakeImage()); const cache = new BitmapImageCache(vi.fn(), create);
    cache.sync({ a, b, c }, items);
    expect(create).toHaveBeenCalledTimes(2);
    expect(cache.get("c")?.status).toBe("error");
    cache.sync({ a, b, c }, items);
    expect(create).toHaveBeenCalledTimes(2);
    cache.clear(); expect(cache.get("a")).toBeUndefined();
  });
});

describe("bitmap drawing", () => {
  it.each([true, false])("matches vector frame transforms with nonuniform scale and rotation, bottom origin %s", (isBottom) => {
    const { cache, image } = loadedCache();
    const { kind, assetId, opacity, ...frame } = bitmap;
    const vector: SvgImport = { ...frame, paths: [{ id: "p", d: "M0 0L20 20", svgSource: "<path/>", visible: true }] };
    const vp = { zoom: 1.8, panX: 12, panY: 30 }; const canvasH = 800;
    const raster = context(); const vectors = context();
    drawBitmapImport(raster.drawing, bitmap, cache, vp, 2, isBottom, canvasH);
    drawImportsLayer({ ctx: vectors.drawing, dpr: 2, vp, imports: [vector], layerGroups: [], selectedImportId: vector.id, allImportsSelected: false, selectedGroupId: null, isBottom, canvasH, respectSvgColorsOnCanvas: false, cache: new Map() });
    expect(raster.ctx.setTransform.mock.calls).toEqual(vectors.ctx.setTransform.mock.calls);
    expect(raster.ctx.translate.mock.calls).toEqual(vectors.ctx.translate.mock.calls);
    expect(raster.ctx.rotate.mock.calls).toEqual(vectors.ctx.rotate.mock.calls);
    expect(raster.ctx.scale.mock.calls).toEqual(vectors.ctx.scale.mock.calls);
    expect(raster.ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 200, 100);
    expect(raster.ctx.globalAlpha).toBe(0.6);
    expect(raster.ctx.stroke).not.toHaveBeenCalled();
  });
  it("keeps bitmap/vector stacking order and image colours when selected or grouped", () => {
    const { cache } = loadedCache(); const { ctx, order, drawing } = context();
    const vector: SvgImport = { id: "vector", name: "vector", paths: [], x: 0, y: 0, scale: 1, rotation: 0, visible: true, svgWidth: 20, svgHeight: 20, viewBoxX: 0, viewBoxY: 0 };
    drawImportsLayer({ ctx: drawing, dpr: 1, vp: { zoom: 1, panX: 0, panY: 0 }, imports: [bitmap, vector, { ...bitmap, id: "copy" }], layerGroups: [{ id: "g", name: "red", color: "#ff0000", importIds: [bitmap.id] }], selectedImportId: bitmap.id, allImportsSelected: false, selectedGroupId: null, isBottom: true, canvasH: 800, respectSvgColorsOnCanvas: false, cache: new Map(), bitmapCache: cache });
    expect(order).toEqual(["bitmap", "vector", "vector", "bitmap"]);
    expect(ctx.drawImage).toHaveBeenCalledTimes(2);
  });
  it("shows an unavailable image frame when decoding fails", () => {
    const { drawing, ctx } = context();
    drawBitmapImport(drawing, bitmap, undefined, { zoom: 1, panX: 0, panY: 0 }, 1, true, 800);
    expect(ctx.fillText).toHaveBeenCalledWith("Image unavailable", 10, 50, 180);
    expect(ctx.drawImage).not.toHaveBeenCalled();
    expect(ctx.scale).toHaveBeenCalledWith(0.3 * MM_TO_PX, 0.4 * MM_TO_PX);
    expect(ctx.translate).toHaveBeenCalledWith(PAD + 10 * MM_TO_PX + 200 * 0.3 * MM_TO_PX / 2, 800 - PAD - (15 + 100 * 0.4) * MM_TO_PX + 100 * 0.4 * MM_TO_PX / 2);
  });
});
