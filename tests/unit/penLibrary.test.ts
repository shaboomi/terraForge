import { beforeEach, describe, expect, it } from "vitest";
import { parsePenProfile, readPenLibrary, type PenProfile } from "../../src/types/pens";
import { parseCanvasLayout, serializeCanvasLayout } from "../../src/types/layoutValidation";
import { usePenLibraryStore } from "../../src/renderer/src/store/penLibraryStore";
import { useCanvasStore } from "../../src/renderer/src/store/canvasStore";
import { selectLibraryPen } from "../../src/renderer/src/components/Toolbar/PenLibraryPicker";
import { createSvgImport } from "../helpers/factories";

const pen: PenProfile = { id: "brush-one", name: "Watercolour black", color: "#000000", type: "brush", tipWidthMM: 0.5,
  maxDrawSpeedMMMin: 1200, brush: { minWidthMM: 0.2, maxWidthMM: 3, minZ: 0, maxZ: -2 } };

beforeEach(() => {
  usePenLibraryStore.setState({ pens: [] });
  useCanvasStore.setState({ imports: [], layerGroups: [], activePenId: null, selectedImportId: null,
    selectedGroupId: null, allImportsSelected: false, undoStack: [], redoStack: [] });
});

describe("physical pen validation", () => {
  it("accepts either Z direction and normalises hex colours without retaining external references", () => {
    const result = parsePenProfile({ ...pen, color: "#ABC", brush: { ...pen.brush, maxZ: 2 } });
    expect(result.color).toBe("#aabbcc");
    expect(result.brush?.maxZ).toBe(2);
    expect(result.brush).not.toBe(pen.brush);
  });
  it.each([
    { tipWidthMM: 0 }, { tipWidthMM: NaN }, { maxDrawSpeedMMMin: -1 }, { maxDrawSpeedMMMin: Infinity },
    { type: "unknown" }, { color: "url(file:///secret)" }, { name: " " },
    { brush: { minWidthMM: 2, maxWidthMM: 1, minZ: 0, maxZ: -1 } },
    { brush: { minWidthMM: 1, maxWidthMM: 2, minZ: 0, maxZ: 0 } },
    { brush: { minWidthMM: 1, maxWidthMM: 2, minZ: 0, maxZ: NaN } },
  ])("rejects unusable machine settings %j", (patch) => {
    expect(() => parsePenProfile({ ...pen, ...patch })).toThrow();
  });
  it("drops only invalid or duplicate stored pens", () => {
    expect(readPenLibrary([pen, { ...pen, tipWidthMM: -2 }, pen, { ...pen, id: "second" }]).map((entry) => entry.id)).toEqual(["brush-one", "second"]);
  });
});

describe("reusable pen library", () => {
  it("validates a library selection before creating a layout pen", () => {
    expect(() => selectLibraryPen({ ...pen, tipWidthMM: 0 })).toThrow();
    expect(useCanvasStore.getState().layerGroups).toEqual([]);
  });
  it("persists profiles independently of clearing a layout and updates saved identities", async () => {
    usePenLibraryStore.getState().savePen(pen);
    usePenLibraryStore.getState().savePen({ ...pen, maxDrawSpeedMMMin: 900 });
    expect(usePenLibraryStore.getState().pens).toHaveLength(1);
    expect(usePenLibraryStore.getState().pens[0].maxDrawSpeedMMMin).toBe(900);
    const stored = localStorage.getItem("terraforge-pen-library");
    useCanvasStore.getState().clearImports();
    expect(usePenLibraryStore.getState().pens).toHaveLength(1);
    usePenLibraryStore.setState({ pens: [] });
    localStorage.setItem("terraforge-pen-library", stored!);
    await usePenLibraryStore.persist.rehydrate();
    expect(usePenLibraryStore.getState().pens[0].maxDrawSpeedMMMin).toBe(900);
  });

  it("loads one layout identity, preserves its artwork, and detaches later library edits", () => {
    useCanvasStore.setState({ imports: [createSvgImport({ id: "text" })], selectedImportId: "text" });
    usePenLibraryStore.getState().savePen(pen);
    const id = selectLibraryPen(pen);
    expect(selectLibraryPen(pen)).toBe(id);
    expect(useCanvasStore.getState().layerGroups).toHaveLength(1);
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["text"]);
    usePenLibraryStore.getState().savePen({ ...pen, maxDrawSpeedMMMin: 100 });
    expect(useCanvasStore.getState().layerGroups[0].penProfile?.maxDrawSpeedMMMin).toBe(1200);
    usePenLibraryStore.getState().removePen(pen.id);
    expect(useCanvasStore.getState().layerGroups[0].penProfile).toEqual(pen);
  });

  it("updates specifications with undo and keeps name and colour aligned", () => {
    const id = selectLibraryPen(pen);
    useCanvasStore.getState().updateLayerGroup(id, { penProfile: { ...pen, maxDrawSpeedMMMin: 500 } });
    expect(useCanvasStore.getState().layerGroups[0].penProfile?.maxDrawSpeedMMMin).toBe(500);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().layerGroups[0].penProfile?.maxDrawSpeedMMMin).toBe(1200);
    useCanvasStore.getState().updateLayerGroup(id, { name: "Blue brush", color: "#00f" });
    expect(useCanvasStore.getState().layerGroups[0].penProfile).toMatchObject({ name: "Blue brush", color: "#0000ff" });
  });

  it("roundtrips brush measurements and calibration speed in layouts and rejects corrupt profiles", () => {
    const layout = { tfVersion: 2 as const, savedAt: "2026-10-29T00:00:00.000Z", imports: [],
      layerGroups: [{ id: "layout-pen", name: pen.name, color: pen.color, importIds: [], penProfile: pen }] };
    expect(parseCanvasLayout(serializeCanvasLayout(layout)).layerGroups[0].penProfile).toEqual(pen);
    expect(() => parseCanvasLayout(JSON.stringify({ ...layout, layerGroups: [{ ...layout.layerGroups[0], penProfile: { ...pen, tipWidthMM: -5 } }] }))).toThrow(/Tip width/);
  });
});
