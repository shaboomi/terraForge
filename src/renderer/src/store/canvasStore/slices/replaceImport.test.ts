import { beforeEach, describe, expect, it } from "vitest";
import type { SvgImport } from "../../../../../types";
import { DEFAULT_HATCH_ANGLE_DEG, DEFAULT_HATCH_SPACING_MM } from "../../../../../types";
import { useCanvasStore } from "../../canvasStore";

function artwork(id: string, pathId = "old-path"): SvgImport {
  return {
    id, name: id,
    paths: [{ id: pathId, d: "M0 0 L10 10", svgSource: "", visible: true }],
    x: 12, y: 23, scale: 2, scaleX: 3, scaleY: 4, rotation: 45, visible: true,
    svgWidth: 10, svgHeight: 10, viewBoxX: 0, viewBoxY: 0,
  };
}

beforeEach(() => useCanvasStore.setState(useCanvasStore.getInitialState(), true));

describe("replaceImport", () => {
  it("normalizes replacement content while retaining target ID, order and selection", () => {
    const first = artwork("first"), target = artwork("target");
    useCanvasStore.setState({ imports: [first, target], selectedImportId: "target", selectedPathId: "old-path" });
    const replacement = { ...artwork("ignored-new-id", "new-path"), name: "Updated", svgWidth: 40 };

    expect(useCanvasStore.getState().replaceImport("target", replacement)).toBe(true);

    const state = useCanvasStore.getState();
    expect(state.imports.map((item) => item.id)).toEqual(["first", "target"]);
    expect(state.imports[0]).toEqual(first);
    expect(state.imports[1]).toMatchObject({ ...replacement, id: "target", hatchEnabled: false, hatchSpacingMM: DEFAULT_HATCH_SPACING_MM, hatchAngleDeg: DEFAULT_HATCH_ANGLE_DEG });
    expect(state.imports[1].paths[0]).toMatchObject({ id: "new-path", sourceOutlineVisible: true, strokeEnabled: true });
    expect(state.selectedImportId).toBe("target");
    expect(state.selectedPathId).toBeNull();
    expect(state.undoStack).toHaveLength(1);
    expect(replacement.id).toBe("ignored-new-id");
  });

  it("keeps another import's selected path unchanged", () => {
    useCanvasStore.setState({ imports: [artwork("target"), artwork("selected", "selected-path")], selectedImportId: "selected", selectedPathId: "selected-path" });
    expect(useCanvasStore.getState().replaceImport("target", artwork("new", "new-path"))).toBe(true);
    expect(useCanvasStore.getState().selectedImportId).toBe("selected");
    expect(useCanvasStore.getState().selectedPathId).toBe("selected-path");
  });

  it("returns false without mutating content, selection or either history stack for a missing target", () => {
    useCanvasStore.setState({ imports: [artwork("existing")], selectedImportId: "existing", selectedPathId: "old-path", undoStack: [[artwork("past")]], redoStack: [[artwork("future")]] });
    const before = useCanvasStore.getState();
    expect(useCanvasStore.getState().replaceImport("missing", artwork("new"))).toBe(false);
    expect(useCanvasStore.getState()).toBe(before);
  });

  it("undoes and redoes generated artwork and provenance in one step with stable group membership", () => {
    const original = artwork("target");
    const groups = [{ id: "group", name: "Group", color: "#112233", importIds: ["target", "other"] }];
    useCanvasStore.setState({ imports: [original, artwork("other")], layerGroups: groups, redoStack: [[artwork("stale-redo")]] });
    const replacement = { ...artwork("ignored", "generated-path"), svgWidth: 50, pluginSource: { pluginId: "example.grid", pluginVersion: "1.0.0", parameters: { spacing: 8 } } };

    expect(useCanvasStore.getState().replaceImport("target", replacement)).toBe(true);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    expect(useCanvasStore.getState().redoStack).toHaveLength(0);
    expect(useCanvasStore.getState().layerGroups).toEqual(groups);
    const updated = structuredClone(useCanvasStore.getState().imports);

    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports[0]).toEqual(original);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
    expect(useCanvasStore.getState().redoStack).toHaveLength(1);
    expect(useCanvasStore.getState().layerGroups).toEqual(groups);

    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().imports).toEqual(updated);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    expect(useCanvasStore.getState().redoStack).toHaveLength(0);
    expect(useCanvasStore.getState().layerGroups).toEqual(groups);
  });

  it("does not create an undo step if replacement normalization fails", () => {
    useCanvasStore.setState({ imports: [artwork("target")] });
    const before = useCanvasStore.getState();
    expect(() => useCanvasStore.getState().replaceImport("target", { ...artwork("bad"), paths: undefined } as unknown as SvgImport)).toThrow();
    expect(useCanvasStore.getState()).toBe(before);
  });
});
