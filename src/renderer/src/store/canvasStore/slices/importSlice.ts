import {
  DEFAULT_HATCH_ANGLE_DEG,
  DEFAULT_HATCH_SPACING_MM,
  type CanvasItem,
  isBitmapImport,
  isVectorImport,
} from "../../../../../types";
import {
  applyImportHatch,
  regenerateImportHatching,
} from "../services/hatching";
import { prepareCanvasAssets, pruneCanvasAssets } from "../services/history";
import { compareColorsLightFirst } from "../../../../../types/colorUtils";
import { vectorObjectsForImports } from "../services/vectorObjects";
import type { CanvasStateCreator, ImportSlice } from "../types";

function withDefaultHatchSettings(imp: CanvasItem): CanvasItem {
  if (isBitmapImport(imp)) return { ...imp };
  const normalizedPaths = imp.paths.map((path) => {
    const sourceOutlineVisible =
      typeof path.sourceOutlineVisible === "boolean"
        ? path.sourceOutlineVisible
        : path.outlineVisible !== false;

    const generatedStrokeEnabled =
      typeof path.generatedStrokeEnabled === "boolean"
        ? sourceOutlineVisible
          ? path.generatedStrokeEnabled
          : path.generatedStrokeEnabled
            ? true
            : undefined
        : undefined;

    return {
      ...path,
      sourceOutlineVisible,
      strokeEnabled: path.strokeEnabled ?? true,
      generatedStrokeEnabled,
    };
  });

  return {
    hatchEnabled: false,
    hatchSpacingMM: DEFAULT_HATCH_SPACING_MM,
    hatchAngleDeg: DEFAULT_HATCH_ANGLE_DEG,
    strokeEnabled: true,
    plotPointsEnabled: false,
    generatedStrokeForNoStroke: false,
    ...imp,
    paths: normalizedPaths,
  };
}

export function createImportSlice(
  pushUndo: () => void,
): CanvasStateCreator<ImportSlice> {
  return (set, get) => ({
    imports: [],
    assets: {},

    addImport: (imp, asset) => {
      if (get().imports.some((item) => item.id === imp.id)) throw new Error("Canvas item ID already exists.");
      const normalized = withDefaultHatchSettings(imp);
      const assets = prepareCanvasAssets(get(), [...get().imports, normalized], asset ? { [asset.id]: asset } : {});
      pushUndo();
      set((state) => {
        state.imports.push(normalized);
        state.assets = assets;
        const activePen = state.layerGroups.find((group) => group.id === state.activePenId);
        if (isVectorImport(normalized) && activePen) activePen.importIds.push(normalized.id);
      });
    },

    replaceImport: (id, replacement) => {
      const index = get().imports.findIndex((item) => item.id === id);
      if (index < 0) return false;
      const normalized = withDefaultHatchSettings({ ...replacement, id });
      const items = [...get().imports];
      items[index] = normalized;
      const assets = prepareCanvasAssets(get(), items);
      pushUndo();
      set((state) => {
        state.imports[index] = normalized;
        state.assets = assets;
        if (state.selectedImportId === id) state.selectedPathId = null;
      });
      return true;
    },
    removeImport: (id) => {
      if (!get().imports.some((item) => item.id === id)) return;
      pushUndo();
      set((state) => {
        state.imports = state.imports.filter((item) => item.id !== id);
        for (const group of state.layerGroups ?? []) group.importIds = group.importIds.filter((itemId) => itemId !== id);
        if (state.selectedImportId === id) {
          state.selectedImportId = null;
          state.selectedPathId = null;
        }
        if (state.allImportsSelected) {
          state.allImportsSelected = false;
          if (state.imports.length === 1) {
            state.selectedImportId = state.imports[0].id;
          } else if (state.imports.length === 0) {
            state.selectedImportId = null;
          }
        }
      });
    },

    editImport: (id, patch) => {
      const current = get().imports.find((item) => item.id === id);
      if (!current || Object.entries(patch).every(([key, value]) => current[key as keyof CanvasItem] === value)) return;
      const normalized = withDefaultHatchSettings({ ...current, ...patch, id, kind: current.kind } as CanvasItem);
      const items = get().imports.map((item) => item.id === id ? normalized : item);
      const assets = prepareCanvasAssets(get(), items);
      pushUndo();
      set((state) => {
        state.imports = items;
        state.assets = assets;
      });
    },
    updateImport: (id, patch) =>
      set((state) => {
        const imp = state.imports.find((item) => item.id === id);
        if (!imp) return;
        Object.assign(imp, patch);
        if (
          isVectorImport(imp) && imp.hatchEnabled &&
          ("scale" in patch || "scaleX" in patch || "scaleY" in patch)
        ) {
          regenerateImportHatching(imp);
        }
      }),

    updatePath: (importId, pathId, patch) =>
      set((state) => {
        const imp = state.imports.find((item) => item.id === importId);
        if (!imp || !isVectorImport(imp)) return;
        const path = imp.paths.find((item) => item.id === pathId);
        if (path) Object.assign(path, patch);
      }),

    updateImportLayer: (importId, layerId, visible) =>
      set((state) => {
        const imp = state.imports.find((item) => item.id === importId);
        if (!imp || !isVectorImport(imp) || !imp.layers) return;
        const layer = imp.layers.find((item) => item.id === layerId);
        if (layer) layer.visible = visible;
      }),

    removePath: (importId, pathId) =>
      set((state) => {
        const imp = state.imports.find((item) => item.id === importId);
        if (!imp || !isVectorImport(imp)) return;
        imp.paths = imp.paths.filter((item) => item.id !== pathId);
        if (state.selectedPathId === pathId) state.selectedPathId = null;
      }),

    clearImports: () => {
      if (get().imports.length === 0 && get().layerGroups.length === 0 && !get().pageTemplate) return;
      pushUndo();
      set((state) => {
        state.imports = [];
        state.selectedImportId = null;
        state.selectedPathId = null;
        state.allImportsSelected = false;
        state.selectedGroupId = null;
        state.layerGroups = [];
        state.activePenId = null;
        state.pageTemplate = null;
        pruneCanvasAssets(state);
      });
    },

    loadLayout: (imports, layerGroups, pageTemplate, incomingAssets, activePenId) => {
      const normalized = imports.map(withDefaultHatchSettings);
      const assets = prepareCanvasAssets(get(), normalized, incomingAssets);
      pushUndo();
      set((state) => {
        state.imports = normalized;
        state.assets = assets;
        state.selectedImportId = null;
        state.selectedPathId = null;
        state.allImportsSelected = false;
        state.selectedGroupId = null;
        state.layerGroups = [...(layerGroups ?? [])].sort((a, b) => compareColorsLightFirst(a.color, b.color));
        state.activePenId = state.layerGroups.some((group) => group.id === activePenId) ? activePenId! : null;
        state.pageTemplate = pageTemplate ?? null;
      });
    },

    selectedImport: () => {
      const { imports, selectedImportId } = get();
      return imports.find((item) => item.id === selectedImportId);
    },

    toVectorObjects: () => vectorObjectsForImports(get().imports, get().layerGroups),

    applyHatch: (importId, spacingMM, angleDeg, enabled) =>
      set((state) => {
        const imp = state.imports.find((item) => item.id === importId);
        if (!imp || !isVectorImport(imp)) return;
        applyImportHatch(imp, spacingMM, angleDeg, enabled);
      }),
  });
}
