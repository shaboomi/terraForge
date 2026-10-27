import type { CanvasItem } from "../../../../../types";
import { useCanvasStore } from "../../../store/canvasStore";
import { useShallow } from "zustand/react/shallow";
import { selectPropertiesPanelStoreBindingsState } from "../../../store/canvasSelectors";
import { useMachineStore } from "../../../store/machineStore";

function updateProperty(id: string, patch: Partial<CanvasItem>): void {
  const store = useCanvasStore.getState();
  if (store.imports.find((item) => item.id === id)?.kind === "bitmap") store.editImport(id, patch);
  else store.updateImport(id, patch);
}

export function usePropertiesPanelStoreBindings() {
  const canvasBindings = useCanvasStore(
    useShallow(selectPropertiesPanelStoreBindingsState),
  );
  const activeConfig = useMachineStore((s) => s.activeConfig);
  const machineStatus = useMachineStore((s) => s.status);

  return {
    ...canvasBindings,
    updateImport: updateProperty,
    activeConfig,
    machineStatus,
  };
}
