/**
 * useObjectScaleRotate — single-object scale and rotate gesture state machines.
 *
 * Owns:
 *   - scaling: active scale-handle gesture state (null when idle)
 *   - rotating: active rotate-handle gesture state (null when idle)
 *   - onHandleMouseDown: start a scale gesture
 *   - onRotateHandleMouseDown: start a rotate gesture
 *   - updateScaleMove: update scale on each mousemove
 *   - updateRotateMove: update rotation on each mousemove
 *   - endScale: finish the scale gesture
 *   - endRotate: finish the rotate gesture
 */
import { useState, useCallback, type RefObject } from "react";
import { MM_TO_PX } from "../constants";
import { rotatePoint } from "../utils/geometry";
import type { HandlePos, ScalingState, RotatingState, Vp } from "../types";
import type { CanvasItem } from "../../../../../types";
import { useCanvasStore } from "../../../store/canvasStore";

export function useObjectScaleRotate(
  containerRef: RefObject<HTMLDivElement | null>,
  vpRef: RefObject<Vp>,
  updateImport: (id: string, patch: Partial<CanvasItem>) => void,
  getBedY: (mm: number) => number = (mm) => -mm * MM_TO_PX,
) {
  const [scaling, setScaling] = useState<ScalingState | null>(null);
  const [rotating, setRotating] = useState<RotatingState | null>(null);

  const isNonPrimaryButton = (button: number | undefined) =>
    button !== undefined && button !== 0;

  const onHandleMouseDown = useCallback(
    (e: React.MouseEvent<SVGCircleElement>, id: string, handle: HandlePos) => {
      if (isNonPrimaryButton(e.button)) return;
      e.stopPropagation();
      const imp = useCanvasStore.getState().imports.find((i) => i.id === id);
      if (!imp) return;
      useCanvasStore.getState().snapshotForGesture();
      const sX = imp.scaleX ?? imp.scale;
      const sY = imp.scaleY ?? imp.scale;
      setScaling({
        id,
        handle,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
        startScale: imp.scale,
        startScaleX: sX,
        startScaleY: sY,
        hasAxisScales: imp.scaleX !== undefined || imp.scaleY !== undefined,
        startRotation: imp.rotation ?? 0,
        startZoom: vpRef.current.zoom,
        yDirection: Math.sign(getBedY(1) - getBedY(0)),
        startObjX: imp.x,
        startObjY: imp.y,
        startW: imp.svgWidth * sX * MM_TO_PX,
        startH: imp.svgHeight * sY * MM_TO_PX,
      });
    },
    [vpRef, getBedY],
  );

  const onRotateHandleMouseDown = useCallback(
    (
      e: React.MouseEvent<SVGCircleElement>,
      id: string,
      cxSvg: number,
      cySvg: number,
    ) => {
      if (isNonPrimaryButton(e.button)) return;
      e.stopPropagation();
      useCanvasStore.getState().snapshotForGesture();
      const imp = useCanvasStore.getState().imports.find((i) => i.id === id);
      if (!imp) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const vp = vpRef.current;
      const mx = (e.clientX - rect.left - vp.panX) / vp.zoom;
      const my = (e.clientY - rect.top - vp.panY) / vp.zoom;
      setRotating({
        id,
        cx: cxSvg,
        cy: cySvg,
        startAngle: Math.atan2(my - cySvg, mx - cxSvg),
        startRotation: imp.rotation,
      });
    },
    [containerRef, vpRef],
  );

  const updateScaleMove = useCallback(
    (e: MouseEvent) => {
      if (!scaling) return;
      // The handles are drawn in the artwork's rotated frame. Undo viewport
      // scaling and rotation before measuring the change in its local extents.
      const [dx, dy] = rotatePoint(
        (e.clientX - scaling.startMouseX) / scaling.startZoom,
        (e.clientY - scaling.startMouseY) / scaling.startZoom,
        -scaling.startRotation,
      );
      const h = scaling.handle;
      const hx = h.includes("l") ? -1 : h.includes("r") ? 1 : 0;
      const hy = h.includes("t") ? -1 : h.includes("b") ? 1 : 0;
      const w = scaling.startW;
      const height = scaling.startH;
      if (w <= 0 || height <= 0) return;
      let kX = hx ? 1 + (hx * dx) / w : 1;
      let kY = hy ? 1 + (hy * dy) / height : 1;
      if (!e.ctrlKey) {
        // Project onto the original handle-to-anchor vector so both mouse axes
        // contribute to a corner drag while keeping the gesture-start ratio.
        const vx = hx * w;
        const vy = hy * height;
        const k = Math.max(
          0.001 / Math.min(scaling.startScaleX, scaling.startScaleY),
          1 + (dx * vx + dy * vy) / (vx * vx + vy * vy),
        );
        kX = kY = k;
      } else {
        kX = Math.max(0.001 / scaling.startScaleX, kX);
        kY = Math.max(0.001 / scaling.startScaleY, kY);
      }
      const deltaW = w * (kX - 1);
      const deltaH = height * (kY - 1);
      // Move the center by half the handle displacement. The opposite corner
      // (or opposite edge midpoint) consequently stays fixed in world space.
      const [centerDx, centerDy] = rotatePoint(
        (hx * deltaW) / 2,
        (hy * deltaH) / 2,
        scaling.startRotation,
      );
      const patch: Partial<CanvasItem> = {
        x: scaling.startObjX + (centerDx - deltaW / 2) / MM_TO_PX,
        // Match the existing renderer's getBedY(y + height) placement for
        // either canvas Y direction, including its height-dependent center.
        y: scaling.startObjY +
          (centerDy - (scaling.yDirection + 0.5) * deltaH) /
          (scaling.yDirection * MM_TO_PX),
      };
      if (!e.ctrlKey && !scaling.hasAxisScales) {
        patch.scale = scaling.startScale * kX;
        patch.scaleX = undefined;
        patch.scaleY = undefined;
      } else {
        patch.scaleX = scaling.startScaleX * kX;
        patch.scaleY = scaling.startScaleY * kY;
      }
      updateImport(scaling.id, patch);
    },
    [scaling, vpRef, updateImport],
  );

  const updateRotateMove = useCallback(
    (e: MouseEvent) => {
      if (!rotating) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const vp = vpRef.current;
      const mx = (e.clientX - rect.left - vp.panX) / vp.zoom;
      const my = (e.clientY - rect.top - vp.panY) / vp.zoom;
      const angle = Math.atan2(my - rotating.cy, mx - rotating.cx);
      const delta = (angle - rotating.startAngle) * (180 / Math.PI);
      updateImport(rotating.id, { rotation: rotating.startRotation + delta });
    },
    [rotating, containerRef, vpRef, updateImport],
  );

  const endScale = useCallback(() => {
    setScaling(null);
  }, []);

  const endRotate = useCallback(() => {
    setRotating(null);
  }, []);

  return {
    scaling,
    rotating,
    onHandleMouseDown,
    onRotateHandleMouseDown,
    updateScaleMove,
    updateRotateMove,
    endScale,
    endRotate,
  };
}
