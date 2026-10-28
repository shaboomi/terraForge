import { describe, expect, it } from "vitest";
import type { PluginManifest, PluginRunRequest } from "../../src/types";
import { PLUGIN_LIMITS, pluginResultItems, validatePluginManifest, validatePluginResult, validatePluginRunRequest } from "../../src/types/pluginValidation";

const pen = { id: "pen-blue", name: "Blue", color: "#123abc" };
const paths = [{ points: [{ x: 0, y: 0 }, { x: 2, y: 1 }], penId: pen.id }];
const manifest: PluginManifest = { id: "test.processor", name: "Processor", version: "1.0.0", apiVersion: 1, description: "Test processing", category: "bitmap-processor", input: "bitmap", outputs: ["vector", "bitmap"] };
const bitmap = () => ({ kind: "bitmap" as const, sourceId: "source", width: 2, height: 1, placement: { x: 50, y: -20, scale: 0.5, scaleX: 0.3, scaleY: 0.8, rotation: 37 }, widthPx: 2, heightPx: 1, data: new Uint8Array([255, 0, 0, 0, 1, 2, 3, 255]), page: { widthMM: 210, heightMM: 297 }, palette: [{ ...pen }] });
const request = (): PluginRunRequest => ({ runId: "run-123", pluginId: manifest.id, parameters: {}, input: bitmap(), seed: 123 });
const vector = () => ({ kind: "vector" as const, width: 2, height: 1, paths });
const raster = () => ({ kind: "bitmap" as const, width: 2, height: 1, widthPx: 1, heightPx: 1, data: new Uint8Array([0, 0, 0, 255]) });

describe("plugin processing validation", () => {
  it("extends API 1 declarations additively and rejects ambiguous output declarations", () => {
    expect(validatePluginManifest(manifest).outputs).toEqual(["vector", "bitmap"]);
    expect(validatePluginManifest({ ...manifest, outputs: ["bitmap"] }).outputs).toEqual(["bitmap"]);
    for (const outputs of [[], ["vector", "vector"], ["bitmap", "vector", "bitmap"], ["machine"]]) {
      expect(() => validatePluginManifest({ ...manifest, outputs })).toThrow(/Outputs/);
    }
  });

  it("copies full source pixels, palette and non-uniform placement into detached snapshots", () => {
    const supplied = request();
    const copy = validatePluginRunRequest(supplied);
    expect(copy).toEqual(supplied);
    expect(copy.input).not.toBe(supplied.input);
    if (copy.input.kind !== "bitmap" || supplied.input.kind !== "bitmap") throw new Error("Expected bitmap");
    expect(copy.input.data).not.toBe(supplied.input.data);
    supplied.input.data.fill(10);
    supplied.input.palette![0].color = "#ffffff";
    expect(copy.input.data[3]).toBe(0);
    expect(copy.input.palette![0].color).toBe("#123abc");
    expect(copy.input.placement).toEqual({ x: 50, y: -20, scale: 0.5, scaleX: 0.3, scaleY: 0.8, rotation: 37 });
  });

  it("accepts source-local vector frames larger than generator millimetre frames", () => {
    const supplied = request();
    supplied.input = { ...bitmap(), kind: "vector", width: 20000, height: 10000, paths };
    delete (supplied.input as unknown as Record<string, unknown>).widthPx;
    delete (supplied.input as unknown as Record<string, unknown>).heightPx;
    delete (supplied.input as unknown as Record<string, unknown>).data;
    const validated = validatePluginRunRequest(supplied);
    expect(validated.input.kind).toBe("vector");
    expect(validatePluginResult({ width: 20000, height: 10000, paths }, validated)).toEqual({ width: 20000, height: 10000, paths });
  });

  it.each([
    { widthPx: 0 }, { widthPx: 1.5 }, { heightPx: 8193 }, { data: new Uint8Array(7) },
    { data: new Uint16Array(4) }, { data: new Uint8Array(10).subarray(1, 9) },
    { data: new Uint8Array(new SharedArrayBuffer(8)) }, { width: 1 }, { placement: { x: 0, y: 0, scale: 0, rotation: 0 } },
  ])("rejects malformed, shared or oversized source snapshots %j", (patch) => {
    expect(() => validatePluginRunRequest({ ...request(), input: { ...bitmap(), ...patch } })).toThrow();
  });

  it("bounds dimensions and pixel count before copying any pixel data", () => {
    expect(() => validatePluginRunRequest({ ...request(), input: { ...bitmap(), width: 8192, height: 8192, widthPx: 8192, heightPx: 8192, data: new Uint8Array(0) } })).toThrow(/pixel budget/);
  });

  it("copies clamped RGBA output into portable ordinary bytes and preserves alpha", () => {
    const supplied = new Uint8ClampedArray([100, 90, 80, 0]);
    const result = validatePluginResult({ items: [{ ...raster(), data: supplied }] }, request(), manifest);
    const output = pluginResultItems(result)[0];
    if (output.kind !== "bitmap") throw new Error("Expected bitmap");
    expect(output.data).toBeInstanceOf(Uint8Array);
    expect(output.data).not.toBe(supplied);
    expect([...output.data]).toEqual([100, 90, 80, 0]);
  });

  it("retains legacy single-vector result shape and normalises mixed output items", () => {
    const legacy = { width: 2, height: 1, paths };
    expect(validatePluginResult(legacy, request(), manifest)).toEqual(legacy);
    expect(pluginResultItems(legacy)).toEqual([vector()]);
    const multi = { items: [{ ...vector(), name: "Paths" }, { ...raster(), name: "Pixels" }], warnings: ["Test warning"] };
    expect(validatePluginResult(multi, request(), manifest)).toEqual(multi);
  });

  it("rejects outputs whose full frame changes, even if their paths fit", () => {
    expect(() => validatePluginResult({ items: [{ ...vector(), width: 3 }] }, request(), manifest)).toThrow(/complete source frame/);
    expect(() => validatePluginResult({ width: 3, height: 1, paths }, request(), manifest)).toThrow(/complete source frame/);
  });

  it("checks declared output kinds and supplied pen identities on every output", () => {
    expect(() => validatePluginResult({ items: [vector(), raster()] }, request(), { ...manifest, outputs: ["vector"] })).toThrow(/undeclared bitmap/);
    expect(() => validatePluginResult({ items: [vector()] }, { ...request(), input: { ...bitmap(), palette: [] } }, manifest)).toThrow(/outside the supplied palette/);
    expect(() => validatePluginRunRequest({ ...request(), input: { ...bitmap(), palette: [pen, pen] } })).toThrow(/unique/);
    expect(() => validatePluginRunRequest({ ...request(), input: { ...bitmap(), palette: [{ ...pen, color: "red" }] } })).toThrow(/six-digit/);
  });

  it("bounds aggregate output items, paths, points and pixels", () => {
    expect(() => validatePluginResult({ items: Array(PLUGIN_LIMITS.outputItems + 1).fill(vector()) }, request())).toThrow(/items/);
    const manyPaths = { ...vector(), paths: Array(6000).fill({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }) };
    expect(() => validatePluginResult({ items: [manyPaths, manyPaths] }, request())).toThrow(/paths/);
    const manyPoints = { ...vector(), paths: [{ points: Array(60000).fill({ x: 0, y: 0 }) }] };
    expect(() => validatePluginResult({ items: [manyPoints, manyPoints] }, request())).toThrow(/points/);
    const large = { ...raster(), widthPx: 4096, heightPx: 4096, data: new Uint8Array(4096 * 4096 * 4) };
    expect(() => validatePluginResult({ items: [large, raster()] }, request())).toThrow(/pixel budget/);
  });

  it("bounds deterministic seeds and copies them without silently changing them", () => {
    for (const seed of [-1, 1.5, Infinity, 0x100000000]) expect(() => validatePluginRunRequest({ ...request(), seed })).toThrow(/Seed/);
    expect(validatePluginRunRequest({ ...request(), seed: 0 }).seed).toBe(0);
    expect(validatePluginRunRequest({ ...request(), seed: 0xffffffff }).seed).toBe(0xffffffff);
  });
});
