import { v4 as uuid } from "uuid";
import { vectorObjectsForGroup, vectorObjectsUngrouped } from "../services/vectorObjects";
import { pushCanvasUndo } from "../services/history";
import type { CanvasStateCreator, LayerGroupSlice } from "../types";

export const createLayerGroupSlice: CanvasStateCreator<LayerGroupSlice> = (set, get) => ({
  layerGroups: [],
  addLayerGroup: (name, color) => {
    pushCanvasUndo(set, get);
    set((state) => { state.layerGroups.push({ id: uuid(), name, color, importIds: [] }); });
  },
  removeLayerGroup: (id) => {
    if (!get().layerGroups.some((group) => group.id === id)) return;
    pushCanvasUndo(set, get);
    set((state) => {
      state.layerGroups = state.layerGroups.filter((group) => group.id !== id);
      if (state.selectedGroupId === id) state.selectedGroupId = null;
    });
  },
  updateLayerGroup: (id, patch) => {
    const group = get().layerGroups.find((item) => item.id === id);
    if (!group || ((patch.name === undefined || patch.name === group.name) && (patch.color === undefined || patch.color === group.color))) return;
    pushCanvasUndo(set, get);
    set((state) => {
      const target = state.layerGroups.find((item) => item.id === id)!;
      if (patch.name !== undefined) target.name = patch.name;
      if (patch.color !== undefined) target.color = patch.color;
    });
  },
  assignImportToGroup: (importId, groupId) => {
    if (!get().imports.some((item) => item.id === importId)) return;
    if (groupId !== null && !get().layerGroups.some((group) => group.id === groupId)) return;
    const current = get().layerGroups.filter((group) => group.importIds.includes(importId));
    if ((groupId === null && current.length === 0) || (current.length === 1 && current[0].id === groupId)) return;
    pushCanvasUndo(set, get);
    set((state) => {
      for (const group of state.layerGroups) group.importIds = group.importIds.filter((id) => id !== importId);
      if (groupId !== null) state.layerGroups.find((group) => group.id === groupId)!.importIds.push(importId);
    });
  },
  toVectorObjectsForGroup: (groupId) => vectorObjectsForGroup(get().imports, get().layerGroups, groupId),
  toVectorObjectsUngrouped: () => vectorObjectsUngrouped(get().imports, get().layerGroups),
});