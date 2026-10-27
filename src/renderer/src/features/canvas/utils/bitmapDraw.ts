import type { BitmapImport } from "../../../../../types";
import type { Vp } from "../types";
import { MM_TO_PX, PAD } from "../constants";
import type { BitmapImageCache } from "./bitmapImageCache";

export function drawBitmapImport(ctx: CanvasRenderingContext2D, item: BitmapImport, cache: BitmapImageCache | undefined, vp: Vp, dpr: number, isBottom: boolean, canvasH: number): void {
  const sx = (item.scaleX ?? item.scale) * MM_TO_PX;
  const sy = (item.scaleY ?? item.scale) * MM_TO_PX;
  const left = PAD + item.x * MM_TO_PX;
  const top = isBottom
    ? canvasH - PAD - (item.y + item.svgHeight * (item.scaleY ?? item.scale)) * MM_TO_PX
    : PAD + (item.y + item.svgHeight * (item.scaleY ?? item.scale)) * MM_TO_PX;
  const cached = cache?.get(item.assetId);
  ctx.save();
  ctx.setTransform(vp.zoom * dpr, 0, 0, vp.zoom * dpr, vp.panX * dpr, vp.panY * dpr);
  ctx.translate(left + item.svgWidth * sx / 2, top + item.svgHeight * sy / 2);
  ctx.rotate((item.rotation ?? 0) * Math.PI / 180);
  ctx.scale(sx, sy);
  ctx.translate(-(item.viewBoxX + item.svgWidth / 2), -(item.viewBoxY + item.svgHeight / 2));
  ctx.globalAlpha = Math.max(0, Math.min(1, item.opacity));
  if (cached?.status === "ready" && cached.image) {
    ctx.drawImage(cached.image, item.viewBoxX, item.viewBoxY, item.svgWidth, item.svgHeight);
  } else {
    ctx.fillStyle = "#64748b22";
    ctx.fillRect(item.viewBoxX, item.viewBoxY, item.svgWidth, item.svgHeight);
    ctx.strokeStyle = cached?.status === "loading" ? "#64748b" : "#e26060";
    ctx.lineWidth = 1 / Math.max(Math.abs(sx), Math.abs(sy), 0.001);
    ctx.strokeRect(item.viewBoxX, item.viewBoxY, item.svgWidth, item.svgHeight);
    ctx.fillStyle = cached?.status === "loading" ? "#64748b" : "#e26060";
    ctx.font = `${Math.max(1, Math.min(item.svgWidth, item.svgHeight) / 12)}px sans-serif`;
    ctx.fillText(cached?.status === "loading" ? "Loading image…" : "Image unavailable", item.viewBoxX + item.svgWidth / 20, item.viewBoxY + item.svgHeight / 2, item.svgWidth * 0.9);
  }
  ctx.restore();
}
