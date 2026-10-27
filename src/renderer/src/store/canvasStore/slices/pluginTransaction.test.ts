import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { useCanvasStore } from "../../canvasStore";
import { createSvgImport } from "../../../../../../tests/helpers/factories";
import type { BitmapAsset, BitmapImport, CanvasItem } from "../../../../../types";

function fixtureAsset(): BitmapAsset {
  const bytes = readFileSync("tests/fixtures/bitmaps/transparent.png");
  return { id: createHash("sha256").update(bytes).digest("hex"), mimeType: "image/png",
    data: bytes.toString("base64"), widthPx: bytes.readUInt32BE(16), heightPx: bytes.readUInt32BE(20) };
}
beforeEach(() => useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [],
  selectedImportId: null, selectedGroupId: null, selectedPathId: null, allImportsSelected: false,
  pageTemplate: null, activePenId: null, undoStack: [], redoStack: [], clipboardImport: null }));

describe("atomic plugin result commits", () => {
  it("adds a complete multi-pen result with one undo and restores it with one redo", () => {
    const source = createSvgImport({ id: "source" });
    const first = createSvgImport({ id: "white-result" });
    const second = createSvgImport({ id: "red-result" });
    useCanvasStore.setState({ imports: [source], activePenId: "white", layerGroups: [
      { id: "white", name: "White", color: "#ffffff", importIds: [] },
      { id: "red", name: "Red", color: "#ff0000", importIds: [] },
    ] });
    expect(useCanvasStore.getState().commitPluginResult({ items: [first, second],
      penAssignments: { "white-result": "white", "red-result": "red" } })).toBe(true);
    expect(useCanvasStore.getState().imports).toHaveLength(3);
    expect(useCanvasStore.getState().imports[0]).toEqual(source);
    expect(useCanvasStore.getState().layerGroups.map((group) => group.importIds)).toEqual([[first.id], [second.id]]);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports).toEqual([source]);
    expect(useCanvasStore.getState().layerGroups.map((group) => group.importIds)).toEqual([[], []]);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().imports.map((item) => item.id)).toEqual([source.id, first.id, second.id]);
    expect(useCanvasStore.getState().layerGroups.map((group) => group.importIds)).toEqual([[first.id], [second.id]]);
  });

  it("keeps explicit plugin colours free of the active single pen", () => {
    useCanvasStore.setState({ activePenId: "white", layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: [] }] });
    useCanvasStore.getState().commitPluginResult({ items: [createSvgImport({ id: "colour-result" })] });
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual([]);
  });

  it("validates missing pens, duplicate IDs, assets and replacement targets before changing history", () => {
    const source = createSvgImport({ id: "source" });
    const output = createSvgImport({ id: "output" });
    useCanvasStore.setState({ imports: [source] });
    const before = useCanvasStore.getState();
    expect(() => before.commitPluginResult({ items: [output], penAssignments: { output: "missing" } })).toThrow(/pen/i);
    expect(() => before.commitPluginResult({ items: [output, output] })).toThrow(/duplicate/i);
    expect(() => before.commitPluginResult({ items: [source] })).toThrow(/duplicate/i);
    expect(before.commitPluginResult({ items: [output], replaceIds: ["missing"] })).toBe(false);
    const bitmap = { ...source, id: "bitmap", kind: "bitmap", assetId: "missing", opacity: 1 } as BitmapImport;
    expect(() => before.commitPluginResult({ items: [bitmap] })).toThrow(/asset/i);
    expect(useCanvasStore.getState().imports).toBe(before.imports);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
    expect(useCanvasStore.getState().redoStack).toHaveLength(0);
  });

  it("retains bitmap output assets through undo/redo and replaces every sibling atomically", () => {
    const source = createSvgImport({ id: "source" });
    const oldA = createSvgImport({ id: "old-a" });
    const oldB = createSvgImport({ id: "old-b" });
    const asset = fixtureAsset();
    const bitmap: BitmapImport = { id: "bitmap", name: "Processed", kind: "bitmap", assetId: asset.id,
      opacity: 1, visible: true, x: 10, y: 20, scale: 0.1, rotation: 30,
      svgWidth: asset.widthPx, svgHeight: asset.heightPx, viewBoxX: 0, viewBoxY: 0 };
    useCanvasStore.setState({ imports: [source, oldA, oldB], layerGroups: [
      { id: "red", name: "Red", color: "#ff0000", importIds: [oldA.id, oldB.id] },
    ] });
    useCanvasStore.getState().commitPluginResult({ items: [bitmap], assets: { [asset.id]: asset }, replaceIds: [oldA.id, oldB.id] });
    expect(useCanvasStore.getState().imports.map((item) => item.id)).toEqual([source.id, bitmap.id]);
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual([]);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports.map((item) => item.id)).toEqual([source.id, oldA.id, oldB.id]);
    expect(useCanvasStore.getState().assets[asset.id]).toEqual(asset);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().imports.map((item) => item.id)).toEqual([source.id, bitmap.id]);
    expect(useCanvasStore.getState().assets[asset.id]).toEqual(asset);
  });
});
