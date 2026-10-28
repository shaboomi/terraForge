import { describe, expect, it, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import type { BitmapAsset, BitmapImport, CanvasLayout } from "../../src/types";
import { isBitmapImport } from "../../src/types";
import { assertBitmapAssetBudget, BITMAP_LIMITS, validateBitmapAsset } from "../../src/types/bitmapValidation";
import { parseCanvasLayout, serializeCanvasLayout } from "../../src/types/layoutValidation";
import { useCanvasStore } from "../../src/renderer/src/store/canvasStore";
import { createSvgImport } from "../helpers/factories";

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, crc]);
}
function asset(fill = 0): BitmapAsset {
  const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc(18, fill); raw[0] = 0; raw[9] = 0;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  return { id: createHash("sha256").update(png).digest("hex"), mimeType: "image/png", data: png.toString("base64"), widthPx: 2, heightPx: 2 };
}
function bitmap(image: BitmapAsset, id = "bitmap"): BitmapImport {
  return { kind: "bitmap", id, name: "Picture", assetId: image.id, opacity: 1, x: 12, y: 24, scale: 0.25, scaleX: 0.3, scaleY: 0.5, rotation: 37, visible: true, svgWidth: image.widthPx, svgHeight: image.heightPx, viewBoxX: 0, viewBoxY: 0 };
}
function layout(imports: CanvasLayout["imports"], assets: CanvasLayout["assets"] = {}): CanvasLayout {
  return { tfVersion: 2, savedAt: "2026-10-27T00:00:00.000Z", imports, assets, layerGroups: [], pageTemplate: null };
}

beforeEach(() => useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [], pageTemplate: null, clipboardImport: null, undoStack: [], redoStack: [], selectedImportId: null, selectedPathId: null, selectedGroupId: null, allImportsSelected: false }));

describe("bitmap assets and versioned layouts", () => {
  it("validates PNG structure, dimensions and checksums and keeps assets immutable", () => {
    const image = asset();
    expect(validateBitmapAsset(image)).toEqual(image);
    expect(Object.isFrozen(validateBitmapAsset(image))).toBe(true);
    expect(() => validateBitmapAsset({ ...image, widthPx: 3 })).toThrow(/dimensions/);
    expect(() => validateBitmapAsset({ ...image, mimeType: "image/jpeg" })).toThrow(/PNG/);
    expect(() => validateBitmapAsset({ ...image, data: image.data.slice(0, -8) })).toThrow();
    const broken = Buffer.from(image.data, "base64"); broken[40] ^= 1;
    expect(() => validateBitmapAsset({ ...image, data: broken.toString("base64") })).toThrow(/checksum/);
    expect(() => validateBitmapAsset({ ...image, data: "data:image/png;base64," + image.data })).toThrow(/base64/);
    expect(() => validateBitmapAsset({ ...image, widthPx: BITMAP_LIMITS.dimensionPx + 1 })).toThrow(/limit/);
  });

  it("bounds aggregate decoded pixels and encoded asset sizes", () => {
    const image = asset();
    expect(() => assertBitmapAssetBudget({ a: { ...image, widthPx: 8192, heightPx: 4096 }, b: image })).toThrow(/32 megapixel/);
    const large = { ...image, data: "A".repeat(4 * 1024 * 1024) };
    expect(() => assertBitmapAssetBudget(Object.fromEntries(Array.from({ length: 23 }, (_, index) => [String(index), large])))).toThrow(/64 MiB/);
  });

  it("roundtrips a mixed portable layout and omits unused history assets", () => {
    const first = asset(), unused = asset(255);
    const vector = createSvgImport({ id: "vector", x: 10, y: 20, scaleX: 2, scaleY: 3, rotation: 75, viewBoxX: -4, viewBoxY: 8 });
    const value = layout([bitmap(first), vector], { [first.id]: first, [unused.id]: unused });
    value.layerGroups = [{ id: "g", name: "Artwork", color: "#123456", importIds: ["bitmap", "vector"] }];
    value.pageTemplate = { sizeId: "a4", landscape: true, marginMM: 12 };
    const restored = parseCanvasLayout(serializeCanvasLayout(value));
    expect(restored.tfVersion).toBe(2);
    expect(restored.imports[0]).toEqual(value.imports[0]);
    expect(restored.imports[1]).toMatchObject(vector);
    expect(Object.keys(restored.assets!)).toEqual([first.id]);
    expect(restored.layerGroups).toEqual(value.layerGroups);
    expect(restored.pageTemplate).toEqual(value.pageTemplate);
  });

  it("roundtrips processor provenance on raster/vector siblings independently of source or installed plugins", () => {
    const image = asset();
    const provenance = { pluginId: "test.processor", pluginVersion: "1.0.0", parameters: { threshold: 127 }, apiVersion: 1 as const, seed: 42, sourceId: "missing-source", sourceRevision: "revision-hash", outputGroupId: "result-group", outputGroupName: "Processed artwork", outputWidth: 120.5, outputHeight: 60 };
    const first = { ...bitmap(image), pluginSource: { ...provenance, outputIndex: 0, outputKey: "0:bitmap:" } };
    const second = createSvgImport({ id: "vector-result", pluginSource: { ...provenance, outputIndex: 1, outputKey: "1:vector:blue-pen" } });
    const restored = parseCanvasLayout(serializeCanvasLayout(layout([first, second], { [image.id]: image })));
    expect(restored.imports.map((item) => item.pluginSource)).toEqual([first.pluginSource, second.pluginSource]);
    expect(restored.layerGroups).toEqual([]);
    expect(restored.imports[0]).toMatchObject(first);
  });

  it("retains legacy generator provenance and rejects unbounded new provenance fields", () => {
    const pluginSource = { pluginId: "test.generator", pluginVersion: "1.0.0", parameters: { width: 25 } };
    const item = createSvgImport({ pluginSource });
    expect(parseCanvasLayout(serializeCanvasLayout(layout([item]))).imports[0].pluginSource).toEqual(pluginSource);
    for (const patch of [{ seed: -1 }, { seed: 1.5 }, { seed: 0x100000000 }, { apiVersion: 2 }, { outputIndex: 16 }, { outputIndex: 0.5 }, { outputKey: "x".repeat(513) }, { outputKey: 1 }, { sourceRevision: "x".repeat(257) }, { outputGroupName: "x".repeat(121) }, { sourceId: "constructor" }, { execute: "code" }, { outputWidth: 0 }, { outputHeight: -1 }, { outputWidth: 1e6 + 1 }, { outputHeight: "10" }, { outputWidth: null }]) {
      expect(() => parseCanvasLayout(JSON.stringify(layout([{ ...item, pluginSource: { ...pluginSource, ...patch } }])))).toThrow();
    }
  });

  it("migrates v1 zero-size vectors and prunes legacy dangling memberships without moving artwork", () => {
    const original = createSvgImport({ id: "line", svgWidth: 0, svgHeight: 20, x: -7, y: 42, scale: 2, scaleX: -3, scaleY: 4, rotation: 91, viewBoxX: -5, viewBoxY: 7 });
    original.paths[0].sourceColor = "url(#gradient)";
    const parsed = parseCanvasLayout(JSON.stringify({ tfVersion: 1, imports: [original], layerGroups: [{ id: "g", name: "Legacy", color: "#111", importIds: ["deleted", "line"] }] }));
    expect(parsed.tfVersion).toBe(2);
    expect(parsed.imports[0]).toMatchObject(original);
    expect(parsed.layerGroups![0].importIds).toEqual(["line"]);
    expect(parsed.assets).toEqual({});
  });

  it("rejects unsupported versions, bad geometry, dangling references and unsafe payloads before mutation", () => {
    const image = asset(), item = bitmap(image), vector = createSvgImport({ id: "vector" });
    const good = layout([item, vector], { [image.id]: image });
    const cases = [
      { ...good, tfVersion: 3 },
      { ...good, assets: {} },
      { ...good, imports: [{ ...item, opacity: 2 }] },
      { ...good, imports: [{ ...item, svgWidth: 20 }] },
      { ...good, imports: [vector, vector] },
      { ...good, imports: [{ ...vector, paths: [{ ...vector.paths[0], d: "M0 0 LInfinity 3" }] }] },
      { ...good, imports: [{ ...vector, paths: [{ ...vector.paths[0], d: "M0 0 L1" }] }] },
      { ...good, imports: [{ ...vector, x: "bad" }] },
      { ...good, layerGroups: [{ id: "g", name: "Bad", color: "red", importIds: ["missing"] }] },
      { ...good, imports: [{ ...vector, paths: [{ ...vector.paths[0], sourceColor: "url(https://example.com)" }] }] },
    ];
    useCanvasStore.getState().addImport(vector);
    const before = useCanvasStore.getState();
    for (const value of cases) expect(() => parseCanvasLayout(JSON.stringify(value))).toThrow();
    expect(useCanvasStore.getState()).toBe(before);
    expect(() => parseCanvasLayout('{"tfVersion":2,"imports":[],"assets":{"__proto__":{}}}')).toThrow(/reserved/);
  });
});

describe("bitmap document history and clipboard", () => {
  it("keeps bitmap bytes outside snapshots and shares them across copy/paste", () => {
    const image = asset();
    useCanvasStore.getState().addImport(bitmap(image), image);
    useCanvasStore.getState().copyImport("bitmap");
    useCanvasStore.getState().pasteImport();
    const state = useCanvasStore.getState();
    expect(state.imports).toHaveLength(2);
    expect(state.imports[1].id).not.toBe("bitmap");
    expect(isBitmapImport(state.imports[1]) && state.imports[1].assetId).toBe(image.id);
    expect(Object.keys(state.assets)).toEqual([image.id]);
    expect(JSON.stringify(state.undoStack)).not.toContain(image.data);
    expect(state.assets[image.id]).toBe(state.assets[image.id]);
  });

  it("supports transforms/opacity, groups, delete and undo/redo while never plotting pixels", () => {
    const image = asset();
    useCanvasStore.getState().addImport(bitmap(image), image);
    useCanvasStore.getState().addLayerGroup("References", "#123456");
    const groupId = useCanvasStore.getState().layerGroups[0].id;
    useCanvasStore.getState().assignImportToGroup("bitmap", groupId);
    useCanvasStore.getState().editImport("bitmap", { opacity: 0.4, rotation: 70, x: 100 });
    expect(useCanvasStore.getState().toVectorObjects()).toEqual([]);
    expect(useCanvasStore.getState().toVectorObjectsForGroup(groupId)).toEqual([]);
    useCanvasStore.getState().removeImport("bitmap");
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual([]);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ opacity: 0.4, rotation: 70, x: 100 });
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual(["bitmap"]);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ opacity: 1, rotation: 37, x: 12 });
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ opacity: 0.4, rotation: 70 });
    expect(useCanvasStore.getState().assets[image.id]).toBeDefined();
  });

  it("preserves assets across replacing a document, undo and clipboard use", () => {
    const first = asset(), second = asset(255);
    useCanvasStore.getState().addImport(bitmap(first, "first"), first);
    useCanvasStore.getState().copyImport("first");
    useCanvasStore.getState().loadLayout([bitmap(second, "second")], [], null, { [second.id]: second });
    expect(Object.keys(useCanvasStore.getState().assets)).toHaveLength(2);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports[0].id).toBe("first");
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().imports[0].id).toBe("second");
    useCanvasStore.getState().pasteImport();
    expect(useCanvasStore.getState().imports).toHaveLength(2);
    expect(useCanvasStore.getState().assets[first.id]).toBeDefined();
  });

  it("preflights missing, conflicting or over-budget assets before edits or history changes", () => {
    const image = asset();
    const before = useCanvasStore.getState();
    expect(() => useCanvasStore.getState().addImport(bitmap(image))).toThrow(/missing/);
    expect(useCanvasStore.getState()).toBe(before);
    useCanvasStore.getState().addImport(bitmap(image), image);
    const existing = useCanvasStore.getState();
    expect(() => useCanvasStore.getState().loadLayout([bitmap(image)], [], null, { [image.id]: { ...image, data: asset(255).data } })).toThrow(/Conflicting/);
    expect(useCanvasStore.getState()).toBe(existing);
    const budgetId = "1".repeat(64);
    useCanvasStore.setState({ assets: { ...existing.assets, [budgetId]: { ...image, id: budgetId, widthPx: 8192, heightPx: 4096 } }, clipboardImport: { ...bitmap(image, "large"), assetId: budgetId, svgWidth: 8192, svgHeight: 4096 } });
    const capped = useCanvasStore.getState();
    expect(() => useCanvasStore.getState().addImport(bitmap(asset(255), "another"), asset(255))).toThrow(/32 megapixel/);
    expect(useCanvasStore.getState()).toBe(capped);
  });

  it("prunes bytes once the final current/history/clipboard reference is discarded", () => {
    const image = asset();
    useCanvasStore.getState().addImport(bitmap(image), image);
    useCanvasStore.getState().removeImport("bitmap");
    for (let index = 0; index < 51; index++) useCanvasStore.getState().addLayerGroup(`Empty ${index}`, "#123456");
    expect(useCanvasStore.getState().assets).toEqual({});
  });

  it("ignores vector-specific path and hatch actions on bitmap items", () => {
    const image = asset();
    useCanvasStore.getState().addImport(bitmap(image), image);
    useCanvasStore.getState().applyHatch("bitmap", 2, 45, true);
    useCanvasStore.getState().updatePath("bitmap", "anything", { visible: false });
    useCanvasStore.getState().removePath("bitmap", "anything");
    expect(useCanvasStore.getState().imports[0]).toEqual(bitmap(image));
  });
});
describe("gesture redo asset retention", () => {
  it("keeps redo and its bitmap on a click, then releases them after an actual drag", () => {
    const image = asset();
    useCanvasStore.getState().addImport(createSvgImport({ id: "vector", x: 10 }));
    useCanvasStore.getState().addImport(bitmap(image), image);
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports.map((item) => item.id)).toEqual(["vector"]);
    expect(useCanvasStore.getState().redoStack).toHaveLength(1);
    expect(useCanvasStore.getState().assets[image.id]).toBeDefined();

    useCanvasStore.getState().snapshotForGesture();
    useCanvasStore.getState().commitGesture();
    expect(useCanvasStore.getState().redoStack).toHaveLength(1);
    expect(useCanvasStore.getState().assets[image.id]).toBeDefined();

    useCanvasStore.getState().snapshotForGesture();
    useCanvasStore.getState().updateImport("vector", { x: 25 });
    useCanvasStore.getState().commitGesture();
    expect(useCanvasStore.getState().redoStack).toHaveLength(0);
    expect(useCanvasStore.getState().assets[image.id]).toBeUndefined();
    useCanvasStore.getState().undo();
    expect(useCanvasStore.getState().imports[0].x).toBe(10);
  });
});
