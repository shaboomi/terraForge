import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { convertRendererPlugin } from "../../scripts/convert-renderer-plugin.mjs";
import { convertedGeneratorRuntime } from "../../scripts/lib/renderer-generator-runtime.mjs";
import { parsePluginSource, validatePluginParameters, validatePluginResult } from "../../src/types/pluginValidation";

const temporary: string[] = [];
const runCli = (args: string[]) => promisify(execFile)(process.execPath, [resolve("scripts/convert-renderer-plugin.mjs"), ...args], { cwd: process.cwd() });
const baseManifest = { id: "example.lines", label: "Lines", apiVersion: 1, entry: "index.js", source: "none", defaults: {}, fields: [] };
async function folder(manifest: object = baseManifest, source = 'module.exports.render=()=>"M0 0L10 10";') {
  const root = await mkdtemp(join(tmpdir(), "terraforge-conversion-")); temporary.push(root);
  await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
  await writeFile(join(root, "index.js"), source);
  return root;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const context = () => ({ signal: new AbortController().signal, seed: 12, limits: { paths: 10000, points: 100000 }, progress: () => {} });
const input = { kind: "none" as const, page: { widthMM: 100, heightMM: 80 }, palette: [] };
function execute(source: string) {
  // Execute only test-owned fixtures, after metadata-only conversion completed.
  return new Function(source.replace(/^export default async function run/m, "return async function run"))();
}
function output(value: unknown, limits?: { paths: number; points: number }) {
  return convertedGeneratorRuntime(new Map([["index.js", (module: { exports: unknown }) => { module.exports = { render: () => value }; }]]), "index.js", input, {}, { ...context(), ...(limits ? { limits } : {}) });
}

describe("bounded offline upstream renderer conversion", () => {
  it("converts and executes the actual upstream spirograph helper bundle, retaining layers/colours/licence", async () => {
    const conversion = await convertRendererPlugin(resolve("tests/fixtures/renderer-spirograph"));
    const manifest = parsePluginSource(conversion.source);
    expect(manifest).toMatchObject({ id: "converted.example.spirograph", input: "none", category: "generator", version: "1.0.0" });
    expect(conversion.source).toContain("Copyright (c) 2026 Mark Benson");
    expect(conversion.warnings.join()).toMatch(/deadline/);
    const parameters = validatePluginParameters(manifest, { twoPens: true });
    const raw = await execute(conversion.source)(input, parameters, context());
    const result = validatePluginResult(raw, { runId: "converted", pluginId: manifest.id, parameters, input }, manifest);
    expect(result).toMatchObject({ items: [
      { name: "Outer sweep", width: 100, height: 80, paths: [{ color: "#1b6ac9" }] },
      { name: "Return sweep", width: 100, height: 80, paths: [{ color: "#c9451b" }] },
    ] });
    expect(JSON.stringify(result)).not.toContain("penId");
    const second = await execute(conversion.source)(input, parameters, context());
    expect(second).toEqual(raw);
  });

  it("reads metadata/source without executing top-level code and keeps helper edits in generated source", async () => {
    const root = await folder(baseManifest, 'throw new Error("not during conversion"); module.exports.render=()=>"M0 0L1 1";');
    await mkdir(join(root, "lib")); await writeFile(join(root, "lib", "helper.js"), "exports.value=1;");
    const first = await convertRendererPlugin(root);
    await writeFile(join(root, "lib", "helper.js"), "exports.value=2;");
    const second = await convertRendererPlugin(root);
    expect(second.source).not.toEqual(first.source);
    await expect(execute(first.source)(input, {}, context())).rejects.toThrow("not during conversion");
  });

  it("creates a reviewable new file through the CLI and refuses overwrites or output inside its source", async () => {
    const root = await folder(), destination = await folder();
    const target = join(destination, "converted.tf-plugin.js");
    expect((await runCli([root, target])).stdout).toContain("Created");
    const saved = await readFile(target, "utf8");
    expect(parsePluginSource(saved).id).toBe("converted.example.lines");
    await expect(runCli([root, target])).rejects.toThrow(/EEXIST/);
    expect(await readFile(target, "utf8")).toBe(saved);
    await expect(runCli([root, join(root, "converted.tf-plugin.js")])).rejects.toThrow(/outside the source/);
    await expect(runCli([root, join(destination, "wrong.js")])).rejects.toThrow(/usage/);
  });

  it("supports relative helper/index/JSON modules and circular CommonJS references", async () => {
    const root = await folder(baseManifest, 'const a=require("./lib");module.exports.render=()=>a.path;');
    await mkdir(join(root, "lib"));
    await writeFile(join(root, "lib", "index.js"), 'exports.path=require("../data").path;require("../index");');
    await writeFile(join(root, "data.json"), JSON.stringify({ path: "m1 2 3 4 h2 v3 z" }));
    const { source } = await convertRendererPlugin(root);
    expect(await execute(source)(input, {}, context())).toMatchObject({ items: [{ paths: [{ closed: true,
      points: [{ x: 1, y: 2 }, { x: 4, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 9 }] }] }] });
  });

  it("preserves CommonJS top-level this and retries failed module factories", async () => {
    const root = await folder(baseManifest, 'this.render=()=>{try{require("./helper")}catch{}return require("./helper").path};');
    await writeFile(join(root, "helper.js"), 'if(!require("./attempt").next())throw new Error("first attempt");exports.path="M0 0L1 1";');
    await writeFile(join(root, "attempt.js"), 'let n=0;exports.next=()=>n++;');
    const run = execute((await convertRendererPlugin(root)).source);
    expect(await run(input, {}, context())).toMatchObject({ items: [{ paths: [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }] }] });
  });

  it("refuses metadata that expands beyond the native header limit and strict-mode syntax", async () => {
    const defaults: Record<string, string> = {};
    const fields = Array.from({ length: 16 }, (_, index) => {
      defaults[`option${index}`] = "v0";
      return { type: "select", key: `option${index}`, label: "Option", options: Array.from({ length: 64 }, (_, value) => ({ label: "X", value: `v${value}` })) };
    });
    const metadata = { ...baseManifest, defaults, fields };
    expect(Buffer.byteLength(JSON.stringify(metadata))).toBeLessThan(64 * 1024);
    await expect(convertRendererPlugin(await folder(metadata))).rejects.toThrow(/metadata.*64 KiB/);
    await expect(convertRendererPlugin(await folder(baseManifest, 'with ({}) {}'))).rejects.toThrow(/strict/i);
  });

  it.each(["required", "optional", undefined])("rejects source:%s instead of guessing a bitmap/tone/scale contract", async source => {
    const root = await folder({ ...baseManifest, source });
    await expect(convertRendererPlugin(root)).rejects.toThrow(/source:none/);
  });

  it.each(["../escape.js", "C:/escape.js", "/escape.js", "lib\\escape.js", "./index.js"])('rejects unsafe or noncanonical entry "%s"', async entry => {
    await expect(convertRendererPlugin(await folder({ ...baseManifest, entry }))).rejects.toThrow(/relative/);
  });

  it.each(["fs", "../../escape", "./missing", "./helper?query"])('rejects unavailable require "%s" within the sandbox', async specifier => {
    const root = await folder(baseManifest, `module.exports.render=()=>require(${JSON.stringify(specifier)});`);
    const { source } = await convertRendererPlugin(root);
    await expect(execute(source)(input, {}, context())).rejects.toThrow(/relative|folder|bundled/);
  });

  it("rejects directory junctions and source file links before reading external content", async () => {
    const root = await folder(), outside = await folder();
    await symlink(outside, join(root, "linked"), "junction");
    await expect(convertRendererPlugin(root)).rejects.toThrow(/links|junctions/);
  });

  it("bounds file counts, source bytes and directory depth", async () => {
    const root = await folder();
    for (let i = 0; i < 63; i++) await writeFile(join(root, `helper${i}.js`), "");
    await expect(convertRendererPlugin(root)).rejects.toThrow(/64 files/);
    const large = await folder(); await writeFile(join(large, "large.js"), " ".repeat(2 * 1024 * 1024));
    await expect(convertRendererPlugin(large)).rejects.toThrow(/2 MiB/);
    const deep = await folder(); await mkdir(join(deep, "a/b/c/d/e/f/g"), { recursive: true });
    await expect(convertRendererPlugin(deep)).rejects.toThrow(/six directory/);
  });

  it("rejects unsupported UI, unsafe defaults and incompatible API instead of dropping fields", async () => {
    for (const manifest of [{ ...baseManifest, apiVersion: 2 }, { ...baseManifest, defaults: { hidden: 1 } },
      { ...baseManifest, defaults: { n: 1 }, fields: [{ key: "n", label: "N", type: "number", min: 0, max: 2, step: 1, presets: [{ label: "+", delta: 1 }] }] }]) {
      await expect(convertRendererPlugin(await folder(manifest))).rejects.toThrow(/supported|undeclared/);
    }
  });

  it.each(["M0 0C1 1 2 2 3 3", "M0 0Q1 1 2 2", "M0 0A1 1 0 0 1 2 2", "M0 0LNaN 2", "M0 0L1", "L1 1", "M1 1", "M0,0,,L1,1", "M0 0L101 0"])("refuses unsupported/malformed path %s", async d => {
    await expect(output(d)).rejects.toThrow(/Converted renderer/);
  });

  it("rejects dots, unknown layer fields, invalid colours and oversized output explicitly", async () => {
    await expect(output([{ dots: [{ d: "M0 0L1 1Z", x: 0, y: 0 }] }])).rejects.toThrow(/dots/);
    await expect(output([{ d: "M0 0L1 1", color: "red" }])).rejects.toThrow(/six-digit/);
    await expect(output("M0 0L1 1L2 2", { paths: 10, points: 2 })).rejects.toThrow(/point budget/);
    await expect(output("M0 0L1 1 M2 2L3 3", { paths: 1, points: 10 })).rejects.toThrow(/path budget/);
  });

  it("preserves layer labels, exact colours, warnings and private per-run module state", async () => {
    expect(await output({ layers: [{ d: "M0 0L1 1", label: "Ink", color: "#abcdef" }], warnings: ["Complete"] })).toMatchObject({ items: [{ name: "Ink", paths: [{ color: "#abcdef" }] }], warnings: ["Complete"] });
    const root = await folder(baseManifest, 'let n=0;module.exports.render=()=>`M0 0L${++n} 1`;');
    const run = execute((await convertRendererPlugin(root)).source);
    expect(await run(input, {}, context())).toEqual(await run(input, {}, context()));
    const controller = new AbortController(); controller.abort();
    await expect(run(input, {}, { ...context(), signal: controller.signal })).rejects.toThrow(/cancelled/);
    expect(await readFile(join(root, "index.js"), "utf8")).toContain("let n=0");
  });
});
