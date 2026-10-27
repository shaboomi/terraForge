import { beforeEach, describe, expect, it } from "vitest";
import type { CanvasLayout } from "../../src/types";
import { parseCanvasLayout, serializeCanvasLayout } from "../../src/types/layoutValidation";
import { useCanvasStore } from "../../src/renderer/src/store/canvasStore";

const layout: CanvasLayout = {
  tfVersion: 2,
  savedAt: "2026-10-28T00:00:00.000Z",
  imports: [],
  layerGroups: [],
  pageTemplate: { sizeId: "a4", landscape: true, marginMM: 20 },
};

beforeEach(() => useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [], pageTemplate: null, undoStack: [], redoStack: [] }));

describe("saved page colours", () => {
  it("roundtrips a custom opaque paper colour", () => {
    const colored = { ...layout, pageTemplate: { ...layout.pageTemplate!, color: "#abc123" } };
    expect(parseCanvasLayout(serializeCanvasLayout(colored)).pageTemplate).toEqual(colored.pageTemplate);
  });

  it("keeps older layouts without a page colour compatible", () => {
    expect(parseCanvasLayout(JSON.stringify(layout)).pageTemplate).toEqual(layout.pageTemplate);
    expect(parseCanvasLayout(JSON.stringify({ ...layout, tfVersion: 1 })).pageTemplate).toEqual(layout.pageTemplate);
  });

  it.each(["red", "#abc", "#ff000080", "url(#paper)", "", 3, null])("rejects invalid or non-opaque page colour %s", (color) => {
    expect(() => parseCanvasLayout(JSON.stringify({ ...layout, pageTemplate: { ...layout.pageTemplate!, color } }))).toThrow(/Page colour/);
  });

  it("undoes and redoes a paper colour change without changing page dimensions", () => {
    const original = { ...layout.pageTemplate!, color: "#ffffff" };
    useCanvasStore.getState().setPageTemplate(original);
    useCanvasStore.getState().setPageTemplate({ ...original, color: "#123456" });
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().pageTemplate).toEqual(original);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().pageTemplate).toEqual({ ...original, color: "#123456" });
  });
});
