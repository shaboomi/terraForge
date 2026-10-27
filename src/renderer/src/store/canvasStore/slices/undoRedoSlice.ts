import type { CanvasSnapshot } from "../../../../../types";
import { canvasSnapshot, pruneCanvasAssets } from "../services/history";
import type { CanvasStateCreator, UndoRedoSlice } from "../types";

let gestureSnapshot: CanvasSnapshot | null = null;
const gestureFingerprint = (snapshot: CanvasSnapshot) => JSON.stringify({
  items: snapshot.imports.map((item) => [item.id, item.x, item.y, item.scale, item.scaleX, item.scaleY, item.rotation]),
  groups: snapshot.layerGroups,
  page: snapshot.pageTemplate,
});

export const createUndoRedoSlice: CanvasStateCreator<UndoRedoSlice> = (set, get) => ({
  undoStack: [], redoStack: [],
  snapshotForGesture: () => { gestureSnapshot = canvasSnapshot(get()); },
  commitGesture: () => {
    const before = gestureSnapshot;
    gestureSnapshot = null;
    if (!before || gestureFingerprint(before) === gestureFingerprint(canvasSnapshot(get()))) return;
    set((state) => {
      state.undoStack.push(before);
      if (state.undoStack.length > 50) state.undoStack.splice(0, state.undoStack.length - 50);
      state.redoStack = [];
      pruneCanvasAssets(state);
    });
  },
  undo: () => {
    const before = get().undoStack.at(-1);
    if (!before) return;
    const current = canvasSnapshot(get());
    set((state) => {
      const snapshot = structuredClone(before);
      state.imports = snapshot.imports;
      state.layerGroups = snapshot.layerGroups;
      state.activePenId = snapshot.activePenId && state.layerGroups.some((group) => group.id === snapshot.activePenId) ? snapshot.activePenId : null;
      state.pageTemplate = snapshot.pageTemplate;
      state.undoStack.pop();
      state.redoStack.push(current);
      if (state.redoStack.length > 50) state.redoStack.splice(0, state.redoStack.length - 50);
      state.selectedImportId = null; state.selectedPathId = null;
      state.allImportsSelected = false; state.selectedGroupId = null;
      pruneCanvasAssets(state);
    });
  },
  redo: () => {
    const next = get().redoStack.at(-1);
    if (!next) return;
    const current = canvasSnapshot(get());
    set((state) => {
      const snapshot = structuredClone(next);
      state.imports = snapshot.imports;
      state.layerGroups = snapshot.layerGroups;
      state.activePenId = snapshot.activePenId && state.layerGroups.some((group) => group.id === snapshot.activePenId) ? snapshot.activePenId : null;
      state.pageTemplate = snapshot.pageTemplate;
      state.redoStack.pop(); state.undoStack.push(current);
      if (state.undoStack.length > 50) state.undoStack.splice(0, state.undoStack.length - 50);
      state.selectedImportId = null; state.selectedPathId = null;
      state.allImportsSelected = false; state.selectedGroupId = null;
      pruneCanvasAssets(state);
    });
  },
});