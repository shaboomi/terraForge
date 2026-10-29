import { v4 as uuid } from "uuid";
import { isVectorImport } from "../../../../../types";
import { compareColorsLightFirst, normalizeHexColor } from "../../../../../types/colorUtils";
import { parsePenProfile } from "../../../../../types/pens";
import { vectorObjectsForGroup, vectorObjectsUngrouped } from "../services/vectorObjects";
import { pushCanvasUndo } from "../services/history";
import type { CanvasStateCreator, LayerGroupSlice } from "../types";

export const createLayerGroupSlice: CanvasStateCreator<LayerGroupSlice> = (set, get) => ({
  layerGroups: [],
  activePenId: null,
  setActivePen: (id) => {
    if (id !== null && !get().layerGroups.some((group) => group.id === id)) return;
    set((state) => { state.activePenId = id; });
  },
  addLayerGroup: (name, color) => {
    pushCanvasUndo(set, get);
    set((state) => {
      state.layerGroups.push({ id: uuid(), name, color, importIds: [] });
      state.layerGroups.sort((a, b) => compareColorsLightFirst(a.color, b.color));
    });
  },
  addPen: (name, color) => {
    const normalized = normalizeHexColor(color);
    if (!normalized) throw new Error("Choose a valid pen colour.");
    const id = uuid();
    pushCanvasUndo(set, get);
    set((state) => {
      state.layerGroups.push({ id, name: name.trim() || "Pen", color: normalized, importIds: [] });
      state.activePenId = id;
      state.layerGroups.sort((a, b) => compareColorsLightFirst(a.color, b.color));
    });
    return id;
  },
  applyPenToSelection: (groupId) => {
    const state = get();
    const target = state.layerGroups.find((group) => group.id === groupId);
    if (groupId !== null && !target) return;
    const selectedGroup = state.layerGroups.find((group) => group.id === state.selectedGroupId);
    const selectedIds = new Set(state.imports
      .filter((item) => isVectorImport(item) && (state.allImportsSelected ||
        (selectedGroup ? selectedGroup.importIds.includes(item.id) : item.id === state.selectedImportId)))
      .map((item) => item.id));
    if (selectedIds.size === 0) return;
    if (target ? [...selectedIds].every((id) => target.importIds.includes(id))
      : state.layerGroups.every((group) => group.importIds.every((id) => !selectedIds.has(id)))) return;
    pushCanvasUndo(set, get);
    set((draft) => {
      for (const group of draft.layerGroups) group.importIds = group.importIds.filter((id) => !selectedIds.has(id));
      if (groupId !== null) draft.layerGroups.find((group) => group.id === groupId)!.importIds.push(...selectedIds);
      if (selectedGroup) draft.selectedGroupId = groupId;
    });
  },
  removeLayerGroup: (id) => {
    if (!get().layerGroups.some((group) => group.id === id)) return;
    pushCanvasUndo(set, get);
    set((state) => {
      state.layerGroups = state.layerGroups.filter((group) => group.id !== id);
      if (state.selectedGroupId === id) state.selectedGroupId = null;
      if (state.activePenId === id) state.activePenId = null;
    });
  },
  updateLayerGroup: (id, patch) => {
    const group = get().layerGroups.find((item) => item.id === id);
    if (!group) return;
    const nextName = patch.name?.trim() || group.name;
    const nextColor = patch.color === undefined ? group.color : normalizeHexColor(patch.color);
    if (!nextColor) throw new Error("Choose a valid pen colour.");
    const profileInput = patch.penProfile ?? group.penProfile;
    const nextProfile = profileInput ? parsePenProfile({ ...profileInput, name: nextName, color: nextColor }) : undefined;
    if (nextName === group.name && nextColor === group.color && JSON.stringify(nextProfile) === JSON.stringify(group.penProfile)) return;
    pushCanvasUndo(set, get);
    set((state) => {
      const target = state.layerGroups.find((item) => item.id === id)!;
      target.name = nextName;
      target.color = nextColor;
      if (nextProfile) target.penProfile = nextProfile;
      state.layerGroups.sort((a, b) => compareColorsLightFirst(a.color, b.color));
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
