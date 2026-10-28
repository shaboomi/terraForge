import type { StateCreator } from "zustand";
import type {
  CanvasItem,
  BitmapAsset,
  BitmapAssetTable,
  CanvasSnapshot,
  SvgPath,
  VectorObject,
  LayerGroup,
  PageSize,
  PageTemplate,
} from "../../../../types";
import type { GcodeToolpath } from "../../utils/gcodeParser";

export interface ImportSlice {
  imports: CanvasItem[];
  assets: BitmapAssetTable;
  addImport: (imp: CanvasItem, asset?: BitmapAsset) => void;
  replaceImport: (id: string, replacement: CanvasItem) => boolean;
  /** Commit a complete plugin result, its assets and pen memberships in one undo step. */
  commitPluginResult: (result: {
    items: CanvasItem[];
    assets?: BitmapAssetTable;
    replaceIds?: string[];
    penAssignments?: Record<string, string>;
  }) => boolean;
  removeImport: (id: string) => void;
  updateImport: (id: string, patch: Partial<CanvasItem>) => void;
  editImport: (id: string, patch: Partial<CanvasItem>) => void;
  updatePath: (
    importId: string,
    pathId: string,
    patch: Partial<SvgPath>,
  ) => void;
  updateImportLayer: (
    importId: string,
    layerId: string,
    visible: boolean,
  ) => void;
  removePath: (importId: string, pathId: string) => void;
  clearImports: () => void;
  loadLayout: (
    imports: CanvasItem[],
    layerGroups?: LayerGroup[],
    pageTemplate?: PageTemplate | null,
    assets?: BitmapAssetTable,
    activePenId?: string | null,
  ) => void;
  selectedImport: () => CanvasItem | undefined;
  toVectorObjects: () => VectorObject[];
  applyHatch: (
    importId: string,
    spacingMM: number,
    angleDeg: number,
    enabled: boolean,
  ) => void;
}

export interface SelectionSlice {
  selectedImportId: string | null;
  selectedPathId: string | null;
  allImportsSelected: boolean;
  toolpathSelected: boolean;
  selectedGroupId: string | null;
  selectImport: (id: string | null) => void;
  selectToolpath: (selected: boolean) => void;
  selectGroup: (id: string | null) => void;
}

export interface ClipboardSlice {
  clipboardImport: CanvasItem | null;
  copyImport: (id: string) => void;
  cutImport: (id: string) => void;
  pasteImport: () => void;
  selectAllImports: () => void;
}

export interface UndoRedoSlice {
  undoStack: CanvasSnapshot[];
  redoStack: CanvasSnapshot[];
  undo: () => void;
  redo: () => void;
  snapshotForGesture: () => void;
  commitGesture: () => void;
}

export interface ToolpathSlice {
  gcodeToolpath: GcodeToolpath | null;
  gcodeSource: {
    path: string;
    name: string;
    source: "local" | "fs" | "sd";
  } | null;
  showCentreMarker: boolean;
  toolpathVisible: boolean;
  toolpathColorized: boolean;
  toolpathOpacity: number;
  plotProgressCuts: string;
  plotProgressRapids: string;
  /** Index of the last completed segment in gcodeToolpath.segments, or null.
   *  Set by the coordinate-matching fallback tracker (usePlotProgress) so
   *  consumers like the job ETA can estimate progress even when FluidNC
   *  doesn't report Ln: in its status. */
  plotProgressFrontierIndex: number | null;
  gcodePreviewLoading: boolean;
  setGcodeToolpath: (tp: GcodeToolpath | null) => void;
  setGcodeSource: (
    src: { path: string; name: string; source: "local" | "fs" | "sd" } | null,
  ) => void;
  toggleCentreMarker: () => void;
  setToolpathVisible: (visible: boolean) => void;
  setToolpathColorized: (colorized: boolean) => void;
  setToolpathOpacity: (opacity: number) => void;
  setGcodePreviewLoading: (loading: boolean) => void;
  setPlotProgress: (
    cuts: string,
    rapids: string,
    frontierIndex?: number | null,
  ) => void;
  clearPlotProgress: () => void;
}

export interface PageTemplateSlice {
  pageTemplate: PageTemplate | null;
  setPageTemplate: (t: PageTemplate | null) => void;
  pageSizes: PageSize[];
  setPageSizes: (sizes: PageSize[]) => void;
}

export interface LayerGroupSlice {
  layerGroups: LayerGroup[];
  activePenId: string | null;
  setActivePen: (id: string | null) => void;
  addLayerGroup: (name: string, color: string) => void;
  addPen: (name: string, color: string) => string;
  applyPenToSelection: (groupId: string | null) => void;
  removeLayerGroup: (id: string) => void;
  updateLayerGroup: (
    id: string,
    patch: Partial<Pick<LayerGroup, "name" | "color">>,
  ) => void;
  assignImportToGroup: (importId: string, groupId: string | null) => void;
  toVectorObjectsForGroup: (groupId: string) => VectorObject[];
  toVectorObjectsUngrouped: () => VectorObject[];
}

export interface CanvasState
  extends
    ImportSlice,
    SelectionSlice,
    ClipboardSlice,
    UndoRedoSlice,
    ToolpathSlice,
    PageTemplateSlice,
    LayerGroupSlice {}

export type CanvasStateCreator<T> = StateCreator<
  CanvasState,
  [["zustand/immer", never]],
  [],
  T
>;
