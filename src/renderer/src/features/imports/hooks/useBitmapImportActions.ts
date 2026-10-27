import { useEffect, useRef } from "react";
import { v4 as uuid } from "uuid";
import type { BitmapImport } from "../../../../../types";
import { useCanvasStore } from "../../../store/canvasStore";
import { useMachineStore } from "../../../store/machineStore";
import { useTaskStore } from "../../../store/taskStore";
import { resolvePageBounds } from "../../properties-panel/utils/pageBounds";
import { bitmapInitialPlacement, normaliseBitmapAsset } from "../services/bitmapImport";

/** A bitmap import commits its item and immutable asset in one undoable operation. */
export function useBitmapImportActions() {
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => () => {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
  }, []);

  return async function handleImportBitmapFile(filePath: string): Promise<void> {
    const taskId = uuid();
    const controller = new AbortController();
    controllers.current.set(taskId, controller);
    const tasks = useTaskStore.getState();
    const name = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") || "bitmap";
    const initialCanvas = useCanvasStore.getState();
    const machine = useMachineStore.getState().activeConfig();
    let stale = false;
    const unsubscribeCanvas = useCanvasStore.subscribe((next) => {
      if (next.imports !== initialCanvas.imports || next.layerGroups !== initialCanvas.layerGroups ||
          next.pageTemplate !== initialCanvas.pageTemplate || next.pageSizes !== initialCanvas.pageSizes) stale = true;
    });
    const unsubscribeMachine = useMachineStore.subscribe((next) => {
      if (next.activeConfig() !== machine) stale = true;
    });
    const update = (progress: number | null, status: "running" | "completed" | "cancelled" | "error", label: string, error?: string) => {
      tasks.upsertTask({ id: taskId, type: "bitmap-import", progress, status, label, ...(error ? { error } : {}) });
    };
    tasks.registerCancelCallback(taskId, () => {
      controller.abort();
      update(null, "cancelled", "Bitmap import cancelled");
    });
    update(null, "running", `Importing ${name}…`);
    try {
      const data = await window.terraForge.fs.readBitmapFile(filePath);
      const asset = await normaliseBitmapAsset(data, filePath, controller.signal,
        (progress) => { if (!controller.signal.aborted) update(progress, "running", `Importing ${name}…`); });
      if (controller.signal.aborted) return;
      if (stale) throw new Error("The document or page changed during import. Import the image again.");
      const bedW = machine?.bedWidth ?? 220;
      const bedH = machine?.bedHeight ?? 200;
      const page = resolvePageBounds({ bedW, bedH, pageTemplate: initialCanvas.pageTemplate, pageSizes: initialCanvas.pageSizes });
      const placement = bitmapInitialPlacement(asset.widthPx, asset.heightPx, {
        pageW: page.pageW, pageH: page.pageH, bedW, bedH,
        marginMM: page.canAlignToTemplate ? page.marginMM : 0, origin: machine?.origin ?? "bottom-left",
      });
      const item: BitmapImport = { id: uuid(), kind: "bitmap", name, assetId: asset.id, opacity: 1,
        ...placement, rotation: 0, visible: true, svgWidth: asset.widthPx, svgHeight: asset.heightPx,
        viewBoxX: 0, viewBoxY: 0 };
      useCanvasStore.getState().addImport(item, asset);
      useCanvasStore.getState().selectImport(item.id);
      update(100, "completed", `Bitmap imported: ${name}`);
    } catch (error) {
      if (controller.signal.aborted) {
        if (useTaskStore.getState().tasks[taskId]?.status === "running") {
          update(null, "cancelled", "Bitmap import cancelled");
        }
      } else {
        const detail = (error instanceof Error ? error.message : String(error))
          .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, "")
          .replace(/^(?:Error:\s*)+/, "");
        update(null, "error", "Bitmap import failed", detail);
      }
    } finally {
      unsubscribeCanvas();
      unsubscribeMachine();
      tasks.unregisterCancelCallback(taskId);
      controllers.current.delete(taskId);
    }
  };
}
