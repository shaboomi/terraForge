import type { CanvasItem, CanvasSnapshot, BitmapAssetTable } from "../../../../../types";
import { isBitmapImport } from "../../../../../types";
import { assertBitmapAssetBudget, validateBitmapAsset } from "../../../../../types/bitmapValidation";
import type { CanvasState } from "../types";

export function canvasSnapshot(state: Pick<CanvasState, "imports" | "layerGroups" | "pageTemplate">): CanvasSnapshot {
  return structuredClone({ imports: state.imports, layerGroups: state.layerGroups ?? [], pageTemplate: state.pageTemplate ?? null });
}

function references(items: CanvasItem[], ids: Set<string>): void {
  for (const item of items) if (isBitmapImport(item)) ids.add(item.assetId);
}

export function referencedAssets(items: CanvasItem[], assets: BitmapAssetTable): BitmapAssetTable {
  const ids = new Set<string>();
  references(items, ids);
  const result: Record<string, typeof assets[string]> = {};
  for (const id of ids) {
    if (!assets[id]) throw new Error("A bitmap asset is missing from this document.");
    result[id] = assets[id];
  }
  return result;
}

/** Keep bytes referenced by the live document, both history stacks or clipboard. */
export function pruneCanvasAssets(state: CanvasState): void {
  if (!state.assets) return;
  const ids = new Set<string>();
  references(state.imports, ids);
  for (const snapshot of [...(state.undoStack ?? []), ...(state.redoStack ?? [])]) references(snapshot.imports ?? [], ids);
  if (state.clipboardImport && isBitmapImport(state.clipboardImport)) ids.add(state.clipboardImport.assetId);
  const current = Object.keys(state.assets);
  if (current.length === ids.size && current.every((id) => ids.has(id))) return;
  const assets: Record<string, typeof state.assets[string]> = {};
  for (const id of ids) if (state.assets[id]) assets[id] = state.assets[id];
  state.assets = assets;
}

/** Preflight a new document edit before changing either content or history. */
export function prepareCanvasAssets(state: CanvasState, items: CanvasItem[], incoming: BitmapAssetTable = {}): BitmapAssetTable {
  const available = { ...(state.assets ?? {}) };
  for (const [id, value] of Object.entries(incoming)) {
    const asset = validateBitmapAsset(value);
    if (asset.id !== id) throw new Error("Bitmap asset table key does not match its ID.");
    const existing = available[id];
    if (existing && (existing.data !== asset.data || existing.widthPx !== asset.widthPx || existing.heightPx !== asset.heightPx)) throw new Error("Conflicting bitmap content uses the same asset ID.");
    available[id] = existing ?? asset;
  }
  const futureHistory = [...(state.undoStack ?? []), { imports: state.imports }].slice(-50);
  const allItems = [...items, ...futureHistory.flatMap((snapshot) => snapshot.imports)];
  if (state.clipboardImport) allItems.push(state.clipboardImport);
  const retained = referencedAssets(allItems, available);
  for (const item of items) {
    if (!isBitmapImport(item)) continue;
    const asset = retained[item.assetId];
    if (item.svgWidth !== asset.widthPx || item.svgHeight !== asset.heightPx || item.viewBoxX !== 0 || item.viewBoxY !== 0 || !Number.isFinite(item.opacity) || item.opacity < 0 || item.opacity > 1) throw new Error("Bitmap frame or opacity is invalid.");
  }
  assertBitmapAssetBudget(retained);
  return retained;
}
/** Shared document-history entry point for groups, pages and artwork edits. */
export function pushCanvasUndo(
  set: (recipe: (state: CanvasState) => void) => void,
  get: () => CanvasState,
): void {
  const snapshot = canvasSnapshot(get());
  set((state) => {
    state.undoStack ??= [];
    state.undoStack.push(snapshot);
    if (state.undoStack.length > 50) state.undoStack.splice(0, state.undoStack.length - 50);
    state.redoStack = [];
    pruneCanvasAssets(state);
  });
}