import { describe, expect, it } from "vitest";
import type { PluginManifest } from "../../src/types";
import { parsePluginSource, PLUGIN_LIMITS, validatePluginManifest, validatePluginParameters, validatePluginResult, validatePluginRunRequest } from "../../src/types/pluginValidation";
import { EXAMPLE_PLUGIN_SOURCE } from "../../src/main/plugins/sample";

function manifest(): PluginManifest {
  return { id: "test.generator", name: "Test", version: "1.0.0", apiVersion: 1, description: "A generator", category: "generator", input: "none", outputs: ["vector"], controls: [
    { key: "amount", label: "Amount", type: "number", default: 5, min: 1, max: 10, step: 1 },
    { key: "on", label: "Enabled", type: "boolean", default: true },
    { key: "style", label: "Style", type: "select", default: "a", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] },
    { key: "text", label: "Text", type: "text", default: "Hello", multiline: true },
    { key: "ink", label: "Ink", type: "colour", default: "#aabbcc" },
  ] };
}

function result(): unknown {
  return { width: 10, height: 20, paths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 20 }], closed: false, color: "#123abc" }] };
}

describe("plugin validation", () => {
  it("parses the exact inert header, including Windows line endings and a UTF-8 BOM", () => {
    expect(parsePluginSource(EXAMPLE_PLUGIN_SOURCE).id).toBe("terraforge.example-grid");
    expect(parsePluginSource("\uFEFF" + EXAMPLE_PLUGIN_SOURCE.replace(/\n/g, "\r\n")).input).toBe("none");
    expect(() => parsePluginSource("console.log('no');\n" + EXAMPLE_PLUGIN_SOURCE)).toThrow(/must start/);
    expect(() => parsePluginSource("/* terraforge-plugin\n{broken}\n*/\n")).toThrow(/invalid JSON/);
  });

  it("bounds file and metadata bytes before accepting a header", () => {
    expect(() => parsePluginSource("x".repeat(PLUGIN_LIMITS.sourceBytes + 1))).toThrow(/1 MiB/);
    const oversized = `/* terraforge-plugin\n${" ".repeat(PLUGIN_LIMITS.metadataBytes + 1)}\n*/\n`;
    expect(() => parsePluginSource(oversized)).toThrow(/64 KiB/);
    expect(() => parsePluginSource("é".repeat(PLUGIN_LIMITS.sourceBytes))).toThrow(/1 MiB/);
  });

  it("accepts processor declarations while rejecting incomplete selected input snapshots", () => {
    expect(validatePluginManifest({ ...manifest(), category: "bitmap-processor", input: "bitmap" }).input).toBe("bitmap");
    expect(validatePluginManifest({ ...manifest(), category: "font-tool", input: "vector" }).category).toBe("font-tool");
    const request = { runId: "run-1", pluginId: "test.generator", input: { kind: "bitmap", page: { widthMM: 100, heightMM: 100 } }, parameters: {} };
    expect(() => validatePluginRunRequest(request)).toThrow(/Source width/);
  });

  it.each([
    { apiVersion: 2 }, { id: "../escape" }, { id: "constructor" }, { category: "machine" }, { version: "latest" }, { outputs: ["gcode"] }, { name: " " }, { executeOnStartup: true },
  ])("rejects unsupported or unsafe metadata %j", (patch) => {
    expect(() => validatePluginManifest({ ...manifest(), ...patch })).toThrow();
  });

  it("rejects duplicate controls, invalid bounds and invalid select defaults", () => {
    const base = manifest();
    expect(() => validatePluginManifest({ ...base, controls: [base.controls![0], base.controls![0]] })).toThrow(/unique/);
    expect(() => validatePluginManifest({ ...base, controls: [{ ...base.controls![0], min: 8, max: 3 }] })).toThrow(/bounds/);
    expect(() => validatePluginManifest({ ...base, controls: [{ key: "choice", label: "Choice", type: "select", default: "x", options: [{ label: "A", value: "a" }] }] })).toThrow(/default/);
    expect(() => validatePluginManifest({ ...base, controls: [{ key: "constructor", label: "Bad", type: "text", default: "" }] })).toThrow(/safe identifier/);
  });

  it("applies validated defaults and checks every supplied parameter", () => {
    const base = validatePluginManifest(manifest());
    expect(validatePluginParameters(base, { amount: 8, style: "b" })).toEqual({ amount: 8, on: true, style: "b", text: "Hello", ink: "#aabbcc" });
    for (const bad of [{ amount: NaN }, { amount: Infinity }, { amount: 12 }, { amount: "5" }, { on: "yes" }, { style: "unknown" }, { ink: "url(https://example.com)" }, { unrecognised: 1 }, { text: "x".repeat(4097) }]) {
      expect(() => validatePluginParameters(base, bad)).toThrow();
    }
    expect(() => validatePluginParameters(base, JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow(/reserved/);
  });

  it("validates the invocation shape, identifiers, page size and primitive parameter values", () => {
    const request = { runId: "run:123", pluginId: "test.generator", input: { kind: "none", page: { widthMM: 100, heightMM: 80 } }, parameters: { amount: 2 } };
    expect(validatePluginRunRequest(request)).toEqual(request);
    expect(() => validatePluginRunRequest({ ...request, runId: "../bad" })).toThrow(/run ID/);
    expect(() => validatePluginRunRequest({ ...request, input: { kind: "none", page: { widthMM: -1, heightMM: 80 } } })).toThrow(/Page width/);
    expect(() => validatePluginRunRequest({ ...request, parameters: { fn: () => 1 } })).toThrow(/must be/);
    expect(() => validatePluginRunRequest({ ...request, filePath: "secret" })).toThrow(/unsupported/);
  });

  it("copies structured geometry while preserving the full declared frame", () => {
    const value = { width: 100, height: 100, paths: [{ points: [{ x: 20, y: 30 }, { x: 25, y: 35 }], color: "#ffffff", closed: true }], warnings: ["Example warning"] };
    const validated = validatePluginResult(value);
    expect(validated).toEqual(value);
    expect(validated).not.toBe(value);
    expect(validated.paths[0].points).not.toBe(value.paths[0].points);
    expect(validated.width).toBe(100);
  });

  it("rejects executable markup, invalid geometry and out-of-frame output", () => {
    for (const value of [null, [], { width: NaN, height: 20, paths: [] }, { width: 0, height: 20, paths: [] }, { width: 10, height: 20, paths: [] }, { width: 10, height: 20, paths: [{ d: '<script>alert(1)</script>' }] }, { width: 10, height: 20, paths: [{ points: [{ x: 0, y: 0 }, { x: Infinity, y: 1 }] }] }, { width: 10, height: 20, paths: [{ points: [{ x: 0, y: 0 }, { x: 11, y: 1 }] }] }, { width: 10, height: 20, paths: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'url(file:///secret)' }] }]) {
      expect(() => validatePluginResult(value)).toThrow();
    }
    expect(validatePluginResult(result()).paths).toHaveLength(1);
  });

  it("bounds aggregate geometry and diagnostic messages", () => {
    const points = Array.from({ length: PLUGIN_LIMITS.points + 1 }, () => ({ x: 0, y: 0 }));
    expect(() => validatePluginResult({ width: 1, height: 1, paths: [{ points }] })).toThrow(/points/);
    const path = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] };
    expect(() => validatePluginResult({ width: 1, height: 1, paths: Array(PLUGIN_LIMITS.paths + 1).fill(path) })).toThrow(/paths/);
    expect(() => validatePluginResult({ width: 1, height: 1, paths: [path], warnings: ["x".repeat(513)] })).toThrow(/Warning/);
  });
});
