import { validateCanvasLayoutImages } from "../services/validateLayoutImages";
import { useState, useRef } from "react";
import { v4 as uuid } from "uuid";
import { useShallow } from "zustand/react/shallow";
import { useCanvasStore } from "../../../store/canvasStore";
import { selectLayoutActionsCanvasState } from "../../../store/canvasSelectors";
import { useTaskStore } from "../../../store/taskStore";
import { type CanvasLayout } from "../../../../../types";
import { parseCanvasLayout, serializeCanvasLayout } from "../../../../../types/layoutValidation";

/** Orchestrates save, load, and close operations for canvas layout files. */
export function useLayoutActions() {
  const { imports, assets, layerGroups, pageTemplate, loadLayout, clearImports } =
    useCanvasStore(useShallow(selectLayoutActionsCanvasState));
  const upsertTask = useTaskStore((s) => s.upsertTask);

  const [showCloseDialog, setShowCloseDialog] = useState(false);
  const [pendingLayout, setPendingLayout] = useState<CanvasLayout | null>(null);

  const hasLayout = imports.length > 0 || layerGroups.length > 0 || !!pageTemplate;

  /** Prompts for a save path and writes the current canvas layout to disk. */
  const handleSaveLayout = async () => {
    if (!hasLayout) return;
    const taskId = uuid();
    const baseName = imports.length === 1 ? imports[0].name : "layout";
    const defaultFilename = `${baseName}.tforge`;
    const savePath =
      await window.terraForge.fs.saveLayoutDialog(defaultFilename);
    if (!savePath) return;
    upsertTask({
      id: taskId,
      type: "svg-parse",
      label: "Saving layout…",
      progress: null,
      status: "running",
    });
    try {
      const layout: CanvasLayout = {
        tfVersion: 2,
        assets,
        savedAt: new Date().toISOString(),
        imports,
        layerGroups,
        pageTemplate,
      };
      await window.terraForge.fs.writeFile(
        savePath,
        serializeCanvasLayout(layout),
      );
      upsertTask({
        id: taskId,
        type: "svg-parse",
        label: "Layout saved",
        progress: 100,
        status: "completed",
      });
    } catch (err) {
      upsertTask({
        id: taskId,
        type: "svg-parse",
        label: "Save failed",
        progress: null,
        status: "error",
        error: String(err),
      });
    }
  };

  /** Prompts for a layout file and loads it, warning before overwriting an existing canvas. */
  const handleLoadLayout = async () => {
    const filePath = await window.terraForge.fs.openLayoutDialog();
    if (!filePath) return;
    const taskId = uuid();
    upsertTask({
      id: taskId,
      type: "svg-parse",
      label: "Loading layout…",
      progress: null,
      status: "running",
    });
    try {
      const raw = await (window.terraForge.fs.readLayoutFile ?? window.terraForge.fs.readFile)(filePath);
      const layout = parseCanvasLayout(raw);
      await validateCanvasLayoutImages(layout);
      upsertTask({
        id: taskId,
        type: "svg-parse",
        label: "Layout ready",
        progress: 100,
        status: "completed",
      });
      const current = useCanvasStore.getState();
      if (current.imports.length > 0 || current.layerGroups.length > 0 || current.pageTemplate) {
        setPendingLayout(layout);
      } else {
        loadLayout(layout.imports, layout.layerGroups, layout.pageTemplate, layout.assets);
      }
    } catch (err) {
      upsertTask({
        id: taskId,
        type: "svg-parse",
        label: "Load layout failed",
        progress: null,
        status: "error",
        error: String(err),
      });
    }
  };

  /** Initiates the close-layout flow — shows a confirmation dialog if the canvas has content. */
  const handleCloseLayout = () => {
    if (!hasLayout) return;
    setShowCloseDialog(true);
  };

  /** Confirms and executes the close — clears all canvas imports. */
  const doCloseLayout = () => {
    clearImports();
    setShowCloseDialog(false);
  };

  // Keep refs current so IPC listeners (subscribed once on mount) always call
  // the latest function closures without stale-closure reads.
  const saveLayoutRef = useRef(handleSaveLayout);
  const loadLayoutRef = useRef(handleLoadLayout);
  const closeLayoutRef = useRef(handleCloseLayout);
  saveLayoutRef.current = handleSaveLayout;
  loadLayoutRef.current = handleLoadLayout;
  closeLayoutRef.current = handleCloseLayout;

  return {
    handleSaveLayout,
    handleLoadLayout,
    handleCloseLayout,
    doCloseLayout,
    saveLayoutRef,
    loadLayoutRef,
    closeLayoutRef,
    showCloseDialog,
    setShowCloseDialog,
    pendingLayout,
    setPendingLayout,
  };
}
