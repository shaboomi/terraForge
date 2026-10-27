import { useCallback } from "react";
import type { LayerGroup, CanvasItem } from "../../../../../types";

interface UseSyncedStrokeWidthArgs {
  imports: CanvasItem[];
  layerGroups: LayerGroup[];
  importGroupId: (importId: string) => string | null;
  updateImport: (importId: string, changes: Partial<CanvasItem>) => void;
}

export function useSyncedStrokeWidth({
  imports,
  layerGroups,
  importGroupId,
  updateImport,
}: UseSyncedStrokeWidthArgs) {
  return useCallback(
    (changedId: string, widthMM: number) => {
      const groupId = importGroupId(changedId);
      const siblingIds = groupId
        ? (layerGroups.find((group) => group.id === groupId)?.importIds ?? [])
        : imports
            .filter((imp) => importGroupId(imp.id) === null)
            .map((imp) => imp.id);

      for (const id of siblingIds) {
        if (imports.some((item) => item.id === id && item.kind !== "bitmap")) updateImport(id, { strokeWidthMM: widthMM });
      }
    },
    [imports, layerGroups, importGroupId, updateImport],
  );
}
