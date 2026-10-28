import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { Blob as NodeBlob } from "node:buffer";
import { readFileSync } from "node:fs";
import { useCanvasStore } from "../../store/canvasStore";
import { createMachineConfig, createSvgImport, createSvgPath } from "../../../../../tests/helpers/factories";
import type { BitmapImport, PluginManifest, PluginResult } from "../../../../types";
import { buildPluginInput, preparePluginArtwork, selectedPluginSource, sourceRevision } from "./pluginProcessing";

const manifest: PluginManifest = { id: "test.processor", name: "Processor", version: "1.0.0", apiVersion: 1,
  description: "A processor", category: "bitmap-processor", input: "bitmap", outputs: ["vector", "bitmap"] };
const page = { widthMM: 220, heightMM: 200 };
const bitmap: BitmapImport = { id: "source", name: "Source", kind: "bitmap", assetId: "asset", opacity: 0.5,
  x: 17, y: -30, scale: 0.2, scaleX: 0.3, scaleY: 0.6, rotation: 37,
  visible: true, svgWidth: 100, svgHeight: 80, viewBoxX: 0, viewBoxY: 0 };

beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [], selectedImportId: null,
    selectedGroupId: null, selectedPathId: null, allImportsSelected: false, pageTemplate: null,
    activePenId: null, undoStack: [], redoStack: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("selected plugin snapshots", () => {
  it("requires exactly one compatible item and resolves saved processor sources", () => {
    useCanvasStore.setState({ imports: [bitmap], selectedImportId: bitmap.id });
    expect(selectedPluginSource(manifest, useCanvasStore.getState())).toEqual(bitmap);
    for (const patch of [{ allImportsSelected: true }, { selectedGroupId: "group" }, { selectedPathId: "path" }]) {
      expect(() => selectedPluginSource(manifest, { ...useCanvasStore.getState(), ...patch })).toThrow(/Select one bitmap/);
    }
    expect(() => selectedPluginSource({ ...manifest, input: "vector" }, useCanvasStore.getState())).toThrow(/Select one vector/);
    const result = createSvgImport({ id: "result", pluginSource: { pluginId: manifest.id,
      pluginVersion: manifest.version, parameters: {}, sourceId: bitmap.id } });
    useCanvasStore.setState({ imports: [bitmap, result], selectedImportId: result.id });
    expect(selectedPluginSource(manifest, useCanvasStore.getState(), result.id)).toEqual(bitmap);
    useCanvasStore.setState({ imports: [result] });
    expect(() => selectedPluginSource(manifest, useCanvasStore.getState(), result.id)).toThrow(/source artwork is missing/);
    expect(selectedPluginSource({ ...manifest, input: "none" }, useCanvasStore.getState())).toBeUndefined();
  });

  it("normalizes vector viewBox offsets, flattens curves, and uses effective pens without applying placement twice", async () => {
    const source = createSvgImport({ id: "vector", svgWidth: 20, svgHeight: 10, viewBoxX: 40, viewBoxY: 50,
      x: 10, y: -20, scale: 0.4, scaleX: 0.5, scaleY: 0.6, rotation: 50,
      paths: [createSvgPath({ d: "M40 50 Q50 60 60 50", strokeColor: "#ff0000" }),
        createSvgPath({ d: "M40 55 L60 55", visible: false })] });
    useCanvasStore.setState({ imports: [source], layerGroups: [{ id: "white", name: "White", color: "#ffffff", importIds: [source.id] }] });
    const input = await buildPluginInput({ ...manifest, input: "vector" }, useCanvasStore.getState(), page, source);
    expect(input.kind).toBe("vector");
    if (input.kind !== "vector") return;
    expect(input.paths).toHaveLength(1);
    expect(input.paths[0].points.length).toBeGreaterThan(2);
    expect(input.paths[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(input.paths[0].points.at(-1)).toEqual({ x: 20, y: 0 });
    expect(input.paths[0]).toMatchObject({ color: "#ffffff", penId: "white" });
    expect(input.placement).toMatchObject({ x: 10, y: -20, scaleX: 0.5, scaleY: 0.6, rotation: 50 });
    input.paths[0].points[0].x = 19;
    expect(source.paths[0].d).toBe("M40 50 Q50 60 60 50");
  });

  it("exposes full-size RGBA with defined transparent RGB and releases decode resources", async () => {
    const close = vi.fn();
    const pixels = new Uint8ClampedArray([255, 22, 3, 0, 4, 5, 6, 127]);
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 2, height: 1, close }));
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(),
      getImageData: () => ({ data: pixels }) } as unknown as CanvasRenderingContext2D);
    const source = { ...bitmap, svgWidth: 2, svgHeight: 1 };
    useCanvasStore.setState({ imports: [source], assets: { asset: { id: "asset", mimeType: "image/png", data: "AA==", widthPx: 2, heightPx: 1 } } });
    const input = await buildPluginInput(manifest, useCanvasStore.getState(), page, source);
    if (input.kind !== "bitmap") throw new Error("Expected bitmap input");
    expect(Array.from(input.data)).toEqual([0, 0, 0, 0, 4, 5, 6, 127]);
    expect(input.width).toBe(2);
    expect(input.height).toBe(1);
    expect(close).toHaveBeenCalledOnce();
    const controller = new AbortController(); controller.abort();
    await expect(buildPluginInput(manifest, useCanvasStore.getState(), page, source, controller.signal)).rejects.toThrow(/cancelled/);
  });

  it("changes the persisted revision when source geometry or placement changes", async () => {
    expect(await sourceRevision(bitmap)).toBe(await sourceRevision({ ...bitmap }));
    expect(await sourceRevision(bitmap)).not.toBe(await sourceRevision({ ...bitmap, rotation: bitmap.rotation + 1 }));
  });
});

describe("source-aligned plugin results", () => {
  const result: PluginResult = { width: 100, height: 80, paths: [{ points: [{ x: 20, y: 30 }, { x: 40, y: 50 }], color: "#ff0000" }] };
  it.each(["bottom-left", "bottom-right", "top-left", "top-right", "center"] as const)("preserves empty margins and exact vector placement for %s", async (origin) => {
    const prepared = await preparePluginArtwork(result, manifest, { threshold: 10 }, page,
      createMachineConfig({ origin }), bitmap, 7);
    const vector = prepared.items[0];
    expect(vector).toMatchObject({ x: bitmap.x, y: bitmap.y, scale: bitmap.scale, scaleX: bitmap.scaleX,
      scaleY: bitmap.scaleY, rotation: bitmap.rotation, svgWidth: 100, svgHeight: 80, viewBoxX: 0, viewBoxY: 0 });
    expect(vector.pluginSource).toMatchObject({ sourceId: bitmap.id, seed: 7, parameters: { threshold: 10 },
      outputGroupId: prepared.groupId, outputIndex: 0 });
    expect(vector.kind).toBe("vector");
    if (vector.kind !== "bitmap") expect(vector.paths[0].d).toBe("M20 30 L40 50");
    expect(prepared.assets).toEqual({});
  });

  it("partitions explicitly assigned pens while keeping unassigned source colours", async () => {
    const prepared = await preparePluginArtwork({ items: [{ kind: "vector", width: 100, height: 80,
      paths: [{ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], penId: "white" },
        { points: [{ x: 10, y: 10 }, { x: 15, y: 15 }], penId: "red" },
        { points: [{ x: 20, y: 20 }, { x: 25, y: 25 }], color: "#00ff00" }] }] },
    manifest, {}, page, undefined, bitmap, 1, { palette: [
      { id: "white", name: "White", color: "#ffffff" }, { id: "red", name: "Red", color: "#ff0000" },
    ] });
    expect(prepared.items).toHaveLength(3);
    expect(prepared.penAssignments).toEqual({ [prepared.items[0].id]: "white", [prepared.items[1].id]: "red" });
    expect(prepared.items.map((item) => item.kind !== "bitmap" && item.paths[0].strokeColor)).toEqual(["#ffffff", "#ff0000", "#00ff00"]);
    expect(prepared.items.map((item) => item.pluginSource?.outputIndex)).toEqual([0, 1, 2]);
    expect(prepared.items.map((item) => item.pluginSource?.outputKey)).toEqual(["0:vector:white", "0:vector:red", "0:vector:"]);
    expect(new Set(prepared.items.map((item) => item.pluginSource?.outputGroupId)).size).toBe(1);
    const remainingPen = await preparePluginArtwork({ items: [{ kind: "vector", width: 100, height: 80,
      paths: [{ points: [{ x: 10, y: 10 }, { x: 15, y: 15 }], penId: "red" }] }] },
    manifest, {}, page, undefined, bitmap, 1, { palette: [{ id: "red", name: "Red", color: "#ff0000" }] });
    expect(remainingPen.items[0].pluginSource?.outputIndex).toBe(0);
    expect(remainingPen.items[0].pluginSource?.outputKey).toBe(prepared.items[1].pluginSource?.outputKey);
    await expect(preparePluginArtwork({ width: 100, height: 80, paths: [{ points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], penId: "missing" }] },
      manifest, {}, page, undefined, bitmap)).rejects.toThrow(/pen/i);
  });

  it("maps resampled bitmap pixels onto the same rotated, nonuniform physical source frame", async () => {
    const png = readFileSync("tests/fixtures/bitmaps/transparent.png");
    const widthPx = png.readUInt32BE(16), heightPx = png.readUInt32BE(20);
    vi.stubGlobal("Blob", NodeBlob);
    vi.stubGlobal("ImageData", class { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} });
    const putImageData = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ putImageData } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new NodeBlob([png], { type: "image/png" }) as unknown as Blob));
    const prepared = await preparePluginArtwork({ items: [{ kind: "bitmap", width: 100, height: 80,
      widthPx, heightPx, data: new Uint8Array(widthPx * heightPx * 4) }] }, manifest, {}, page,
    createMachineConfig({ origin: "center" }), bitmap);
    const item = prepared.items[0];
    expect(item.kind).toBe("bitmap");
    expect(item.x).toBe(bitmap.x); expect(item.y).toBe(bitmap.y); expect(item.rotation).toBe(bitmap.rotation);
    expect(item.svgWidth * (item.scaleX ?? item.scale)).toBeCloseTo(100 * bitmap.scaleX!);
    expect(item.svgHeight * (item.scaleY ?? item.scale)).toBeCloseTo(80 * bitmap.scaleY!);
    expect(item.viewBoxX).toBe(0); expect(item.viewBoxY).toBe(0);
    expect(Object.values(prepared.assets)[0]).toMatchObject({ widthPx, heightPx, data: png.toString("base64") });
    expect(putImageData).toHaveBeenCalledOnce();
    const generated = await preparePluginArtwork({ items: [{ kind: "bitmap", width: 40, height: 25,
      widthPx, heightPx, data: new Uint8Array(widthPx * heightPx * 4) }] },
    { ...manifest, input: "none", category: "generator" }, {}, page);
    expect(generated.items[0].pluginSource).toMatchObject({ outputWidth: 40, outputHeight: 25 });
    expect(generated.items[0].pluginSource?.sourceId).toBeUndefined();
    expect(generated.items[0].svgWidth * (generated.items[0].scaleX ?? generated.items[0].scale)).toBeCloseTo(40);
    expect(generated.items[0].svgHeight * (generated.items[0].scaleY ?? generated.items[0].scale)).toBeCloseTo(25);
  });

  it("rejects a changed source frame or an undeclared output kind before any commit", async () => {
    await expect(preparePluginArtwork({ ...result, width: 99 }, manifest, {}, page, undefined, bitmap)).rejects.toThrow(/complete source frame/);
    await expect(preparePluginArtwork(result, { ...manifest, outputs: ["bitmap"] }, {}, page, undefined, bitmap)).rejects.toThrow(/undeclared/);
  });
});
