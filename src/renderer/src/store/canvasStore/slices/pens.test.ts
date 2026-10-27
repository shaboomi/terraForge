import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../../canvasStore";
import { selectGcodeOptionsDialogCanvasState } from "../../canvasSelectors";
import { createSvgImport } from "../../../../../../tests/helpers/factories";
import type { BitmapImport } from "../../../../../types";

beforeEach(() => useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [],
  selectedImportId: null, selectedGroupId: null, selectedPathId: null, allImportsSelected: false,
  pageTemplate: null, activePenId: null, undoStack: [], redoStack: [] }));

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

describe("active pen for imported artwork", () => {
  const artwork = (id: string) => createSvgImport({ id, paths: [
    { id: `${id}-path`, d: "M0 0L10 10", svgSource: "", visible: true, strokeColor: "#ff0000" },
  ] });

  it("automatically applies a white pen selected before SVG import, with one import undo step", () => {
    const white = useCanvasStore.getState().addPen("White", "#ffffff");
    const before = useCanvasStore.getState().undoStack.length;
    useCanvasStore.getState().addImport(artwork("svg"));
    expect(useCanvasStore.getState().activePenId).toBe(white);
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["svg"]);
    expect(useCanvasStore.getState().toVectorObjects().map((object) => object.sourceColor)).toEqual(["#ffffff"]);
    expect(useCanvasStore.getState().undoStack).toHaveLength(before + 1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports).toEqual([]);
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual([]);
    expect(useCanvasStore.getState().activePenId).toBe(white);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["svg"]);
    expect(useCanvasStore.getState().toVectorObjects()[0].sourceColor).toBe("#ffffff");
  });

  it("uses the active pen for subsequent vectors without recolouring earlier imports or assigning bitmaps", () => {
    const white = useCanvasStore.getState().addPen("White", "#ffffff");
    useCanvasStore.getState().addImport(artwork("first"));
    const blue = useCanvasStore.getState().addPen("Blue", "#0000ff");
    useCanvasStore.getState().addImport(artwork("second"));
    const bitmap: BitmapImport = { ...artwork("reference"), kind: "bitmap", assetId: "image", opacity: 1, svgWidth: 10, svgHeight: 10, viewBoxX: 0, viewBoxY: 0 };
    useCanvasStore.setState({ assets: { image: { id: "image", mimeType: "image/png", data: "cG5n", widthPx: 10, heightPx: 10 } } });
    useCanvasStore.getState().addImport(bitmap);
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === white)?.importIds).toEqual(["first"]);
    expect(useCanvasStore.getState().layerGroups.find((group) => group.id === blue)?.importIds).toEqual(["second"]);
    useCanvasStore.getState().setActivePen(null);
    useCanvasStore.getState().addImport(artwork("original"));
    expect(useCanvasStore.getState().toVectorObjects().map((object) => object.sourceColor)).toEqual(["#ffffff", "#0000ff", "#ff0000"]);
  });

  it("restores original colours for selected vectors without unassigning bitmap references", () => {
    useCanvasStore.setState({ imports: [artwork("svg"), { ...artwork("bitmap"), kind: "bitmap", assetId: "image", opacity: 1 } as BitmapImport],
      allImportsSelected: true, layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: ["svg", "bitmap"] }] });
    useCanvasStore.getState().setActivePen(null);
    useCanvasStore.getState().applyPenToSelection(null);
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["bitmap"]);
    expect(useCanvasStore.getState().toVectorObjects()[0].sourceColor).toBe("#ff0000");
    const undoCount = useCanvasStore.getState().undoStack.length;
    useCanvasStore.getState().applyPenToSelection(null);
    expect(useCanvasStore.getState().undoStack).toHaveLength(undoCount);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["svg", "bitmap"]);
  });

  it("remembers valid choices without undo entries and restores the active pen when removal is undone", () => {
    const white = useCanvasStore.getState().addPen("White", "#fff");
    useCanvasStore.getState().addPen("Black", "#000");
    const before = useCanvasStore.getState().undoStack.length;
    useCanvasStore.getState().setActivePen(white);
    useCanvasStore.getState().setActivePen("missing");
    expect(useCanvasStore.getState().activePenId).toBe(white);
    expect(useCanvasStore.getState().undoStack).toHaveLength(before);
    useCanvasStore.getState().removeLayerGroup(white);
    expect(useCanvasStore.getState().activePenId).toBeNull();
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().activePenId).toBe(white);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().activePenId).toBeNull();
  });

  it("loads only valid saved active pens and clears the choice with the layout", () => {
    const white = useCanvasStore.getState().addPen("White", "#fff");
    const pens = useCanvasStore.getState().layerGroups;
    useCanvasStore.getState().loadLayout([], pens, null, undefined, white);
    expect(useCanvasStore.getState().activePenId).toBe(white);
    useCanvasStore.getState().loadLayout([], pens, null, undefined, "missing");
    expect(useCanvasStore.getState().activePenId).toBeNull();
    useCanvasStore.getState().setActivePen(white);
    useCanvasStore.getState().loadLayout([], pens);
    expect(useCanvasStore.getState().activePenId).toBeNull();
    useCanvasStore.getState().setActivePen(white);
    useCanvasStore.getState().clearImports();
    expect(useCanvasStore.getState().activePenId).toBeNull();
  });

  it("never retains an active reference to a pen undone out of the document", () => {
    const white = useCanvasStore.getState().addPen("White", "#fff");
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().activePenId).toBeNull();
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().activePenId).toBe(white);
  });
});
