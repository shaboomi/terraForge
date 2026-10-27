import type { DragEvent, ReactNode } from "react";
import type { LayerGroup, CanvasItem } from "../../../../../types";

export interface UngroupedImportsSectionProps {
  imports: CanvasItem[];
  layerGroups: LayerGroup[];
  dragOverGroupId: string | null;
  showUngroupedHint: boolean;
  onUngroupedDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onUngroupedDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  onUngroupedDrop: (event: DragEvent<HTMLDivElement>) => void;
  renderImport: (imp: CanvasItem, indented: boolean) => ReactNode;
}
