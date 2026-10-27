import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../canvasStore";
import { selectGcodeOptionsDialogCanvasState } from "../../canvasSelectors";
import { createSvgImport } from "../../../../../../tests/helpers/factories";
import type { BitmapImport } from "../../../../../types";

beforeEach(() => useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [],
  selectedImportId: null, selectedGroupId: null, selectedPathId: null, allImportsSelected: false,
  pageTemplate: null, undoStack: [], redoStack: [] }));

describe("pen assignments", () => {
  it("orders pens lightest first when adding, recolouring and loading", () => {
    const dark = useCanvasStore.getState().addPen("Black", "#000");
    useCanvasStore.getState().addPen("White", "#fff");
    useCanvasStore.getState().addLayerGroup("Gray", "#808080");
    expect(useCanvasStore.getState().layerGroups.map((group) => group.name)).toEqual(["White", "Gray", "Black"]);
    useCanvasStore.getState().updateLayerGroup(dark, { color: "#ffff00" });
    expect(useCanvasStore.getState().layerGroups.map((group) => group.name)).toEqual(["White", "Black", "Gray"]);
    const groups = [...useCanvasStore.getState().layerGroups].reverse();
    useCanvasStore.getState().loadLayout([], groups);
    expect(useCanvasStore.getState().layerGroups.map((group) => group.name)).toEqual(["White", "Black", "Gray"]);
    expect(groups.map((group) => group.name)).toEqual(["Gray", "Black", "White"]);
  });

  it("moves every selected vector to the chosen pen in one undoable action and skips bitmaps", () => {
    const first = createSvgImport({ id: "first" });
    const second = createSvgImport({ id: "second" });
    const bitmap: BitmapImport = { ...first, kind: "bitmap", id: "bitmap", assetId: "image", opacity: 1 };
    useCanvasStore.setState({ imports: [first, second, bitmap], allImportsSelected: true,
      layerGroups: [{ id: "old", name: "Old", color: "#111111", importIds: [first.id] },
        { id: "new", name: "New", color: "#ffffff", importIds: [] }] });
    useCanvasStore.getState().applyPenToSelection("new");
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "new")?.importIds).toEqual(["first", "second"]);
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "old")?.importIds).toEqual([]);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    useCanvasStore.getState().applyPenToSelection("new");
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "old")?.importIds).toEqual(["first"]);
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "new")?.importIds).toEqual([]);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "new")?.importIds).toEqual(["first", "second"]);
  });

  it("counts effective pen colours for the G-code export choices", () => {
    useCanvasStore.setState({ imports: [
      createSvgImport({ id: "one", paths: [{ id: "p1", d: "M0 0L10 10", svgSource: "", visible: true, strokeColor: "red" }] }),
      createSvgImport({ id: "two", paths: [{ id: "p2", d: "M0 0L10 10", svgSource: "", visible: true, strokeColor: "blue" }] }),
    ], allImportsSelected: true });
    expect(selectGcodeOptionsDialogCanvasState(useCanvasStore.getState()).colorGroupCount).toBe(2);
    const penId = useCanvasStore.getState().addPen("One pen", "#00ff00");
    useCanvasStore.getState().applyPenToSelection(penId);
    expect(selectGcodeOptionsDialogCanvasState(useCanvasStore.getState()).colorGroupCount).toBe(1);
  });

  it("supports one selected import and a selected group's members, and ignores an empty selection", () => {
    useCanvasStore.setState({ imports: [createSvgImport({ id: "first" }), createSvgImport({ id: "second" })],
      layerGroups: [{ id: "old", name: "Old", color: "#111111", importIds: ["first"] },
        { id: "new", name: "New", color: "#ffffff", importIds: [] }], selectedImportId: "second" });
    useCanvasStore.getState().applyPenToSelection("new");
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "new")?.importIds).toEqual(["second"]);
    useCanvasStore.setState({ selectedImportId: null, selectedGroupId: "old" });
    useCanvasStore.getState().applyPenToSelection("new");
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === "new")?.importIds).toEqual(["second", "first"]);
    expect(useCanvasStore.getState().selectedGroupId).toBe("new");
    useCanvasStore.setState({ selectedGroupId: null });
    useCanvasStore.getState().applyPenToSelection("old");
    expect(useCanvasStore.getState().undoStack).toHaveLength(2);
  });
});
