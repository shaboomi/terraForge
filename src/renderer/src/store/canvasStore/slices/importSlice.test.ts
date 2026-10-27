import { describe, it, expect, vi, beforeEach } from "vitest";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
import { createImportSlice } from "./importSlice";
import { createUndoRedoSlice } from "./undoRedoSlice";
import { canvasSnapshot } from "../services/history";
import type { SvgImport } from "../../../../../types";
import {
  DEFAULT_HATCH_ANGLE_DEG,
  DEFAULT_HATCH_SPACING_MM,
} from "../../../../../types";

type ImportState = ReturnType<ReturnType<typeof createImportSlice>> & {
  selectedImportId: string | null;
  selectedPathId: string | null;
  allImportsSelected: boolean;
  selectedGroupId: string | null;
  pageTemplate: { sizeId: string; landscape: boolean; marginMM: number } | null;
  layerGroups: Array<{
    id: string;
    name: string;
    color: string;
    importIds: string[];
  }>;
};

let pushUndo: ReturnType<typeof vi.fn>;

function makeStore() {
  pushUndo = vi.fn();
  return create<ImportState>()(
    immer((set, get) => ({
      selectedImportId: null,
      selectedPathId: null,
      allImportsSelected: false,
      selectedGroupId: null,
      pageTemplate: null,
      layerGroups: [],
      ...createImportSlice(pushUndo)(set as any, get as any),
    })),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("importSlice", () => {
  it("addImport applies default hatch settings and pushes undo", () => {
    const store = makeStore();

    store.getState().addImport({
      id: "imp1",
      name: "shape",
      paths: [{ id: "p1", d: "M0 0", svgSource: "", visible: true }],
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      visible: true,
      svgWidth: 10,
      svgHeight: 10,
      viewBoxX: 0,
      viewBoxY: 0,
    } as any);

    const imp = store.getState().imports[0];
    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(imp.hatchEnabled).toBe(false);
    expect(imp.hatchSpacingMM).toBe(DEFAULT_HATCH_SPACING_MM);
    expect(imp.hatchAngleDeg).toBe(DEFAULT_HATCH_ANGLE_DEG);
  });

  it("removeImport updates selection state and all-selected fallback", () => {
    const store = makeStore();
    store.setState({
      imports: [
        {
          id: "a",
          name: "a",
          paths: [],
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          visible: true,
          svgWidth: 1,
          svgHeight: 1,
          viewBoxX: 0,
          viewBoxY: 0,
        },
        {
          id: "b",
          name: "b",
          paths: [],
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          visible: true,
          svgWidth: 1,
          svgHeight: 1,
          viewBoxX: 0,
          viewBoxY: 0,
        },
      ] as any,
      allImportsSelected: true,
    });

    store.getState().removeImport("b");

    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().imports).toHaveLength(1);
    expect(store.getState().allImportsSelected).toBe(false);
    expect(store.getState().selectedImportId).toBe("a");
  });

  it("loadLayout replaces imports and clears selection/group state", () => {
    const store = makeStore();
    store.setState({
      selectedImportId: "old",
      selectedPathId: "path",
      allImportsSelected: true,
      selectedGroupId: "group",
      layerGroups: [
        { id: "oldg", name: "old", color: "#111", importIds: ["old"] },
      ],
      pageTemplate: { sizeId: "a4", landscape: true, marginMM: 20 },
    });

    store.getState().loadLayout(
      [
        {
          id: "new",
          name: "new",
          paths: [],
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          visible: true,
          svgWidth: 1,
          svgHeight: 1,
          viewBoxX: 0,
          viewBoxY: 0,
        },
      ] as any,
      [{ id: "g1", name: "group", color: "#222", importIds: ["new"] }],
      { sizeId: "letter", landscape: false, marginMM: 10 },
    );

    expect(pushUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().imports[0].id).toBe("new");
    expect(store.getState().selectedImportId).toBeNull();
    expect(store.getState().selectedPathId).toBeNull();
    expect(store.getState().allImportsSelected).toBe(false);
    expect(store.getState().selectedGroupId).toBeNull();
    expect(store.getState().layerGroups[0].id).toBe("g1");
    expect(store.getState().pageTemplate?.sizeId).toBe("letter");
  });

  it("updatePath and updateImportLayer are no-ops for missing targets", () => {
    const store = makeStore();
    store.setState({
      imports: [
        {
          id: "imp1",
          name: "shape",
          paths: [{ id: "p1", d: "M0 0", svgSource: "", visible: true }],
          layers: [{ id: "l1", name: "layer", visible: true }],
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          visible: true,
          svgWidth: 1,
          svgHeight: 1,
          viewBoxX: 0,
          viewBoxY: 0,
        },
      ] as any,
    });

    store.getState().updatePath("missing", "p1", { visible: false });
    store.getState().updateImportLayer("imp1", "missing", false);

    expect(store.getState().imports[0].paths[0].visible).toBe(true);
    expect(store.getState().imports[0].layers?.[0].visible).toBe(true);
  });

  it("normalizes legacy no-stroke paths to inherit import generated-stroke toggle", () => {
    const store = makeStore();

    store.getState().addImport({
      id: "imp1",
      name: "shape",
      paths: [
        {
          id: "p1",
          d: "M0 0",
          svgSource: "",
          visible: true,
          outlineVisible: false,
          sourceOutlineVisible: false,
          generatedStrokeEnabled: false,
        },
      ],
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      visible: true,
      svgWidth: 10,
      svgHeight: 10,
      viewBoxX: 0,
      viewBoxY: 0,
      generatedStrokeForNoStroke: true,
    } as any);

    const imp = store.getState().imports[0];
    expect(imp.generatedStrokeForNoStroke).toBe(true);
    expect(imp.paths[0].generatedStrokeEnabled).toBeUndefined();
  });
});

function importFixture(id: string, pathId = "old-path"): SvgImport {
  return {
    id, name: id,
    paths: [{ id: pathId, d: "M0 0 L10 10", svgSource: "", visible: true }],
    x: 12, y: 23, scale: 2, rotation: 45, visible: true,
    svgWidth: 10, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
  };
}

function makeHistoryStore() {
  type HistoryState = ImportState & ReturnType<typeof createUndoRedoSlice>;
  return create<HistoryState>()(
    immer((set, get) => {
      const recordUndo = () => {
        const snapshot = canvasSnapshot(get() as any);
        set((state) => {
          state.undoStack.push(snapshot);
          state.redoStack = [];
        });
      };
      return {
        selectedImportId: null, selectedPathId: null, allImportsSelected: false,
        selectedGroupId: null, pageTemplate: null, layerGroups: [],
        ...createUndoRedoSlice(set as any, get as any),
        ...createImportSlice(recordUndo)(set as any, get as any),
      };
    }),
  );
}

describe("replaceImport", () => {
  it("replaces normalized content in place, keeping its ID and clearing stale selected paths", () => {
    const store = makeStore();
    const other = importFixture("other");
    store.setState({ imports: [other, importFixture("existing")], selectedImportId: "existing", selectedPathId: "old-path" });
    const replacement = { ...importFixture("ignore-this-new-id", "new-path"), name: "Updated", svgWidth: 40, pluginSource: { pluginId: "example.grid", pluginVersion: "1.0.0", parameters: { spacing: 5 } } };

    expect(store.getState().replaceImport("existing", replacement)).toBe(true);

    expect(pushUndo).toHaveBeenCalledOnce();
    expect(store.getState().imports.map((item) => item.id)).toEqual(["other", "existing"]);
    expect(store.getState().imports[0]).toEqual(other);
    expect(store.getState().imports[1]).toMatchObject({ ...replacement, id: "existing", hatchEnabled: false, hatchSpacingMM: DEFAULT_HATCH_SPACING_MM, hatchAngleDeg: DEFAULT_HATCH_ANGLE_DEG });
    expect(store.getState().imports[1].paths[0]).toMatchObject({ id: "new-path", sourceOutlineVisible: true, strokeEnabled: true });
    expect(store.getState().selectedImportId).toBe("existing");
    expect(store.getState().selectedPathId).toBeNull();
    expect(replacement.id).toBe("ignore-this-new-id");
  });

  it("does not clear another import's selected path", () => {
    const store = makeStore();
    store.setState({ imports: [importFixture("target"), importFixture("selected", "selected-path")], selectedImportId: "selected", selectedPathId: "selected-path" });
    expect(store.getState().replaceImport("target", importFixture("new", "new-path"))).toBe(true);
    expect(store.getState().selectedImportId).toBe("selected");
    expect(store.getState().selectedPathId).toBe("selected-path");
  });

  it("returns false without a state edit or undo step when the target is missing", () => {
    const store = makeStore();
    store.setState({ imports: [importFixture("existing")], selectedImportId: "existing", selectedPathId: "old-path" });
    const before = store.getState();
    expect(store.getState().replaceImport("missing", importFixture("replacement"))).toBe(false);
    expect(store.getState()).toBe(before);
    expect(pushUndo).not.toHaveBeenCalled();
  });

  it("undoes and redoes replacement as one step while group membership remains stable", () => {
    const store = makeHistoryStore();
    const original = importFixture("existing");
    const groups = [{ id: "group", name: "Group", color: "#112233", importIds: ["existing", "other"] }];
    store.setState({ imports: [original, importFixture("other")], layerGroups: groups, redoStack: [{ imports: [importFixture("stale-redo")], layerGroups: [], pageTemplate: null }] });
    const replacement = { ...importFixture("ignored", "new-path"), svgWidth: 50, pluginSource: { pluginId: "example.grid", pluginVersion: "1.0.0", parameters: { spacing: 8 } } };

    expect(store.getState().replaceImport("existing", replacement)).toBe(true);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().redoStack).toHaveLength(0);
    expect(store.getState().layerGroups).toEqual(groups);
    const updated = structuredClone(store.getState().imports);

    store.getState().undo();
    expect(store.getState().imports[0]).toEqual(original);
    expect(store.getState().layerGroups).toEqual(groups);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().redoStack).toHaveLength(1);

    store.getState().redo();
    expect(store.getState().imports).toEqual(updated);
    expect(store.getState().layerGroups).toEqual(groups);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().redoStack).toHaveLength(0);
  });

  it("preserves existing undo and redo state when a replacement target disappeared", () => {
    const store = makeHistoryStore();
    store.setState({ imports: [importFixture("other")], undoStack: [{ imports: [importFixture("past")], layerGroups: [], pageTemplate: null }], redoStack: [{ imports: [importFixture("future")], layerGroups: [], pageTemplate: null }] });
    const before = store.getState();
    expect(store.getState().replaceImport("deleted", importFixture("new"))).toBe(false);
    expect(store.getState()).toBe(before);
  });
});