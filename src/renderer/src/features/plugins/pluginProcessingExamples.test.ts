import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginInput, PluginParameters, PluginResult, PluginRunRequest } from "../../../../types";
import { parsePluginSource, pluginResultItems, validatePluginResult, validatePluginRunRequest } from "../../../../types/pluginValidation";

function example(filename: string) {
  const source = readFileSync(resolve(process.cwd(), "docs", "examples", filename), "utf8");
  const manifest = parsePluginSource(source);
  // These are repository-owned examples, executed here to verify their actual output contract.
  const run = new Function(source.replace("export default function run", "return function run"))() as
    (input: PluginInput, parameters: PluginParameters, context: PluginContext) => PluginResult;
  return { manifest, run };
}

function context(): PluginContext {
  return { runId: "example-test", signal: new AbortController().signal, progress: vi.fn(), seed: 1 };
}

function bitmapInput(data: number[], widthPx = 2): PluginInput {
  return { kind: "bitmap", sourceId: "source", page: { widthMM: 220, heightMM: 200 },
    width: widthPx, height: 1, widthPx, heightPx: 1, data: new Uint8Array(data),
    placement: { x: 10, y: 20, scale: 0.5, scaleX: 0.8, scaleY: 1.2, rotation: 30 } };
}

describe("distributed processor examples", () => {
  it("returns bounded greyscale/invert bitmap pixels with alpha and the complete source frame", () => {
    const { manifest, run } = example("bitmap-tones.tf-plugin.js");
    const input = bitmapInput([255, 0, 0, 255, 80, 90, 100, 0]);
    const request = validatePluginRunRequest({ runId: "example-test", pluginId: manifest.id, input, parameters: { mode: "greyscale" } });
    const grey = validatePluginResult(run(request.input, request.parameters, context()), request, manifest);
    const item = pluginResultItems(grey)[0];
    expect(item).toMatchObject({ kind: "bitmap", width: 2, height: 1, widthPx: 2, heightPx: 1 });
    if (item.kind !== "bitmap") throw new Error("Expected raster example output");
    expect(Array.from(item.data)).toEqual([54, 54, 54, 255, 0, 0, 0, 0]);
    const inverted = pluginResultItems(run(input, { mode: "invert" }, context()))[0];
    if (inverted.kind !== "bitmap") throw new Error("Expected raster example output");
    expect(Array.from(inverted.data)).toEqual([0, 255, 255, 255, 0, 0, 0, 0]);
    expect(Array.from(input.kind === "bitmap" ? input.data : [])).toEqual([255, 0, 0, 255, 80, 90, 100, 0]);
  });

  it("assigns separate colour runs to real configured pen IDs", () => {
    const { manifest, run } = example("bitmap-scanlines.tf-plugin.js");
    const input = bitmapInput([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255], 4);
    input.palette = [{ id: "red", name: "Red pen", color: "#ff0000" }, { id: "blue", name: "Blue pen", color: "#0000ff" }];
    const request: PluginRunRequest = { runId: "example-test", pluginId: manifest.id, input,
      parameters: { threshold: 180, spacing: 1, usePens: true } };
    const result = pluginResultItems(validatePluginResult(run(input, request.parameters, context()), request, manifest))[0];
    expect(result.kind).toBe("vector");
    if (result.kind !== "vector") throw new Error("Expected vector example output");
    expect(result.paths.map((path) => path.penId)).toEqual(["red", "blue"]);
    expect(result.paths.map((path) => path.points)).toEqual([
      [{ x: 0, y: 0.5 }, { x: 2, y: 0.5 }], [{ x: 2, y: 0.5 }, { x: 4, y: 0.5 }],
    ]);
    expect(result).toMatchObject({ width: 4, height: 1 });
  });

  it("keeps transparent margins empty and reports an empty threshold result", () => {
    const { run } = example("bitmap-scanlines.tf-plugin.js");
    const input = bitmapInput([0, 0, 0, 0, 255, 255, 255, 255]);
    expect(() => run(input, { threshold: 180, spacing: 1, usePens: true }, context())).toThrow(/No dark pixels/);
  });

  it("processes vectors without controls while retaining frame and pen assignments", () => {
    const { manifest, run } = example("reverse-vectors.tf-plugin.js");
    expect(manifest.controls).toBeUndefined();
    const input: PluginInput = { kind: "vector", sourceId: "source", page: { widthMM: 220, heightMM: 200 },
      width: 100, height: 60, placement: { x: 0, y: 0, scale: 1, rotation: 0 },
      palette: [{ id: "black", name: "Black", color: "#000000" }],
      paths: [{ points: [{ x: 20, y: 10 }, { x: 80, y: 50 }], penId: "black" }] };
    const request = { runId: "example-test", pluginId: manifest.id, input, parameters: {} };
    const result = pluginResultItems(validatePluginResult(run(input, {}, context()), request, manifest))[0];
    if (result.kind !== "vector") throw new Error("Expected vector example output");
    expect(result).toMatchObject({ width: 100, height: 60 });
    expect(result.paths[0]).toEqual({ points: [{ x: 80, y: 50 }, { x: 20, y: 10 }], penId: "black" });
    expect(input.paths[0].points[0]).toEqual({ x: 20, y: 10 });
  });
});
