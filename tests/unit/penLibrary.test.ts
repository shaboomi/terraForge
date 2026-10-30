import { beforeEach, describe, expect, it } from "vitest";
import { parsePenProfile, readPenLibrary, type PenProfile } from "../../src/types/pens";
import { usePenLibraryStore } from "../../src/renderer/src/store/penLibraryStore";
import { useCanvasStore } from "../../src/renderer/src/store/canvasStore";
import { applyLibraryPen } from "../../src/renderer/src/components/MachineConfigDialog/components/PenLibrarySettings";
import { layerFiles } from "../../src/renderer/src/features/machine/utils/splitGcodeFiles";
import { createSvgImport, createSvgPath, createMachineConfig } from "../helpers/factories";
import { brushZ, penFeedrate, validatePlotPen } from "../../src/workers/generation/penProfile";
import { remapLayerMetadata } from "../../src/workers/generation/collect";

const pen: PenProfile = { id: "brush-one", name: "Watercolour black", color: "#000000", type: "brush", tipWidthMM: 1.6,
  maxDrawSpeedMMMin: 1200, brush: { minWidthMM: 0.2, maxWidthMM: 3, minZ: 0, maxZ: -2 } };

beforeEach(() => {
  usePenLibraryStore.setState({ pens: [] });
  useCanvasStore.setState({ imports: [], layerGroups: [], selectedImportId: null,
    selectedGroupId: null, allImportsSelected: false, undoStack: [], redoStack: [] });
});

describe("physical pen library", () => {
  it("normalises colours and detaches measurements", () => {
    const result = parsePenProfile({ ...pen, color: "#ABC" });
    expect(result.color).toBe("#aabbcc");
    expect(result.brush).not.toBe(pen.brush);
  });
  it.each([{ tipWidthMM: 0 }, { tipWidthMM: NaN }, { maxDrawSpeedMMMin: -1 }, { maxDrawSpeedMMMin: Infinity },
    { type: "unknown" }, { color: "url(file:///secret)" }, { name: " " },
    { brush: { minWidthMM: 2, maxWidthMM: 1, minZ: 0, maxZ: -1 } },
    { brush: { minWidthMM: 1, maxWidthMM: 2, minZ: 0, maxZ: 0 } }])("rejects invalid profile %j", patch => {
    expect(() => parsePenProfile({ ...pen, ...patch })).toThrow();
  });
  it("discards only corrupt and duplicate persisted entries", () => {
    expect(readPenLibrary([pen, { ...pen, tipWidthMM: -1 }, pen, { ...pen, id: "second" }])).toHaveLength(2);
  });
  it("persists independently of a cleared layout", async () => {
    usePenLibraryStore.getState().savePen(pen);
    usePenLibraryStore.getState().savePen({ ...pen, maxDrawSpeedMMMin: 900 });
    const stored = localStorage.getItem("terraforge-pen-library");
    useCanvasStore.getState().clearImports();
    expect(usePenLibraryStore.getState().pens).toHaveLength(1);
    usePenLibraryStore.setState({ pens: [] });
    localStorage.setItem("terraforge-pen-library", stored!);
    await usePenLibraryStore.persist.rehydrate();
    expect(usePenLibraryStore.getState().pens[0].maxDrawSpeedMMMin).toBe(900);
  });
  it("assigns and reuses an existing group without changing unrelated artwork", () => {
    useCanvasStore.setState({ imports: [createSvgImport({ id: "one" }), createSvgImport({ id: "two" })], selectedImportId: "one" });
    const id = applyLibraryPen(pen);
    expect(applyLibraryPen(pen)).toBe(id);
    expect(useCanvasStore.getState().layerGroups).toHaveLength(1);
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["one"]);
    expect(useCanvasStore.getState().toVectorObjectsForGroup(id).every(object => object.penProfile?.id === pen.id)).toBe(true);
    expect(useCanvasStore.getState().toVectorObjectsUngrouped().every(object => !object.penProfile)).toBe(true);
    usePenLibraryStore.getState().savePen({ ...pen, maxDrawSpeedMMMin: 100 });
    expect(useCanvasStore.getState().layerGroups[0].penProfile?.maxDrawSpeedMMMin).toBe(1200);
  });
  it("requires a selection and validates before changing the canvas", () => {
    expect(() => applyLibraryPen(pen)).toThrow(/Select artwork/);
    expect(() => applyLibraryPen({ ...pen, tipWidthMM: 0 })).toThrow();
    expect(useCanvasStore.getState().layerGroups).toEqual([]);
  });
  it("roundtrips assignments in upstream layouts, including bitmap renderer settings", () => {
    const item = createSvgImport({ id: "one", kind: "bitmap", bitmapRendererPath: "M0 0 L5 5" });
    const groups = [{ id: "group", name: pen.name, color: pen.color, importIds: [item.id], penProfile: pen }];
    const layout = JSON.parse(JSON.stringify({ tfVersion: 1, imports: [item], layerGroups: groups }));
    useCanvasStore.getState().loadLayout(layout.imports, layout.layerGroups);
    expect(useCanvasStore.getState().toVectorObjects()[0].penProfile).toEqual(pen);
    expect(useCanvasStore.getState().imports[0].bitmapRendererPath).toBe(item.bitmapRendererPath);
    expect(() => useCanvasStore.getState().loadLayout([item], [{ ...groups[0], penProfile: { ...pen, tipWidthMM: -5 } }])).toThrow();
    expect(useCanvasStore.getState().layerGroups[0].penProfile).toEqual(pen);
  });
  it("preserves specifications in whole-job, per-group and per-layer output", () => {
    const item = createSvgImport({ id: "one", paths: [createSvgPath({ layer: "ink" })] });
    useCanvasStore.setState({ imports: [item], selectedImportId: item.id });
    const id = applyLibraryPen(pen);
    const state = useCanvasStore.getState();
    expect(state.toVectorObjects()[0].penProfile).toEqual(pen);
    expect(state.toVectorObjectsForGroup(id)[0].penProfile).toEqual(pen);
    expect(layerFiles(state.imports, false, state.layerGroups)[0].objects[0].penProfile).toEqual(pen);
  });
  it("retains different profiles on coincident reordered paths", () => {
    const first = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    const second = first.map(point => ({ ...point }));
    const result = remapLayerMetadata([{ points: first, penProfile: pen },
      { points: second, penProfile: { ...pen, id: "other", maxDrawSpeedMMMin: 300 } }], [second, first]);
    expect(result.map(path => path.penProfile?.id)).toEqual(["other", pen.id]);
  });
});

describe("calibrated pen motion", () => {
  it("caps drawing feed and interpolates or clamps brush contact heights", () => {
    expect(penFeedrate(3000, pen)).toBe(1200);
    expect(penFeedrate(600, pen)).toBe(600);
    expect(brushZ(pen)).toBeCloseTo(-1);
    expect(brushZ({ ...pen, tipWidthMM: 10 })).toBe(-2);
    expect(brushZ({ ...pen, type: "fineliner" })).toBeUndefined();
  });
  it("rejects incompatible lifts and accepts a checked absolute stepper lift", () => {
    expect(() => validatePlotPen(pen, createMachineConfig())).toThrow(/stepper/);
    expect(() => validatePlotPen(pen, createMachineConfig({ penType: "stepper", penUpCommand: "G91 G0 Z5" }))).toThrow(/absolute/);
    expect(() => validatePlotPen(pen, createMachineConfig({ penType: "stepper", penUpCommand: "G0 Z5" }))).not.toThrow();
  });
});
