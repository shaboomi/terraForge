import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "fs/promises";
import { tmpdir } from "os";
import { basename, dirname, join, resolve } from "path";
import { PluginRegistry } from "../../../src/main/plugins/registry";
import { EXAMPLE_PLUGIN_FILENAME, EXAMPLE_PLUGIN_SOURCE } from "../../../src/main/plugins/sample";
import { PLUGIN_LIMITS } from "../../../src/types/pluginValidation";

function source(id = "test.generator", body = "throw new Error('Never evaluate during discovery');"): string {
  return `/* terraforge-plugin\n${JSON.stringify({ id, name: "Test tool", version: "1.0.0", apiVersion: 1, description: "Test generator", category: "generator", input: "none", outputs: ["vector"] })}\n*/\n${body}\n`;
}

describe("plugin registry", () => {
  let folder: string;
  beforeEach(async () => { folder = await mkdtemp(join(tmpdir(), "terraforge-plugins-")); });
  afterEach(async () => {
    if (dirname(resolve(folder)) !== resolve(tmpdir()) || !basename(folder).startsWith("terraforge-plugins-")) throw new Error("Unexpected cleanup path");
    await rm(folder, { recursive: true, force: true });
  });

  it("creates an empty plugin folder without installing or evaluating code", async () => {
    const nested = join(folder, "plugins");
    const registry = new PluginRegistry(nested);
    expect(() => registry.list()).toThrow(/not ready/);
    await registry.initialise();
    expect(registry.list()).toEqual([]);
    await expect(registry.getExecutable("missing.plugin")).rejects.toThrow(/missing/);
  });

  it("discovers metadata deterministically without evaluating top-level JavaScript", async () => {
    await writeFile(join(folder, "z.tf-plugin.js"), source("test.z"));
    await writeFile(join(folder, "a.tf-plugin.js"), source("test.a"));
    await writeFile(join(folder, "ignore.js"), "throw new Error('wrong suffix');");
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    expect(registry.list().map((entry) => entry.filename)).toEqual(["a.tf-plugin.js", "z.tf-plugin.js"]);
    expect(registry.list().every((entry) => entry.enabled && !entry.error)).toBe(true);
    expect((await registry.getExecutable("test.a")).source).toContain("Never evaluate");
    const changed = registry.list();
    changed[0].manifest!.name = "Changed outside registry";
    expect(registry.list()[0].manifest!.name).toBe("Test tool");
  });

  it("isolates malformed, incompatible and oversized files from valid entries", async () => {
    await writeFile(join(folder, "good.tf-plugin.js"), source());
    await writeFile(join(folder, "bad.tf-plugin.js"), "// no header");
    await writeFile(join(folder, "future.tf-plugin.js"), source("future.plugin").replace('"apiVersion":1', '"apiVersion":2'));
    await writeFile(join(folder, "huge.tf-plugin.js"), "x".repeat(PLUGIN_LIMITS.sourceBytes + 1));
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    expect(registry.list().filter((entry) => entry.error)).toHaveLength(3);
    expect(registry.list().find((entry) => entry.filename === "good.tf-plugin.js")?.enabled).toBe(true);
  });

  it("flags every duplicate rather than allowing one file to shadow another", async () => {
    await writeFile(join(folder, "one.tf-plugin.js"), source());
    await writeFile(join(folder, "two.tf-plugin.js"), source());
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    expect(registry.list().every((entry) => !entry.enabled && entry.error?.includes("Duplicate"))).toBe(true);
    await expect(registry.getExecutable("test.generator")).rejects.toThrow(/duplicated/);
    await expect(registry.setEnabled("test.generator", true)).rejects.toThrow(/valid plugin/);
  });

  it("persists disabled IDs separately and rejects execution until re-enabled", async () => {
    const filename = join(folder, "tool.tf-plugin.js");
    const original = source();
    await writeFile(filename, original);
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    await registry.setEnabled("test.generator", false);
    await expect(registry.getExecutable("test.generator")).rejects.toThrow(/disabled/);
    expect(await readFile(filename, "utf8")).toBe(original);
    const restarted = new PluginRegistry(folder);
    await restarted.initialise();
    expect(restarted.list()[0].enabled).toBe(false);
    await restarted.setEnabled("test.generator", true);
    expect((await restarted.getExecutable("test.generator")).manifest.id).toBe("test.generator");
    expect(JSON.parse(await readFile(join(folder, ".plugin-state.json"), "utf8"))).toEqual({ version: 1, disabled: [] });
  });

  it("serialises concurrent preference writes without losing either change", async () => {
    await writeFile(join(folder, "a.tf-plugin.js"), source("test.a"));
    await writeFile(join(folder, "b.tf-plugin.js"), source("test.b"));
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    await Promise.all([registry.setEnabled("test.a", false), registry.setEnabled("test.b", false)]);
    const restarted = new PluginRegistry(folder);
    await restarted.initialise();
    expect(restarted.list().every((entry) => !entry.enabled)).toBe(true);
  });

  it("pins source until restart and discovers external additions only on a new scan", async () => {
    await writeFile(join(folder, "tool.tf-plugin.js"), source());
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    await writeFile(join(folder, "tool.tf-plugin.js"), source() + "// edited\n");
    await expect(registry.getExecutable("test.generator")).rejects.toThrow(/changed since startup/);
    await writeFile(join(folder, "new.tf-plugin.js"), source("test.new"));
    expect(registry.list()).toHaveLength(1);
    const restarted = new PluginRegistry(folder);
    await restarted.initialise();
    expect(restarted.list()).toHaveLength(2);
    expect((await restarted.getExecutable("test.generator")).source).toContain("// edited");
  });

  it("installs the example explicitly, refreshes the list and never overwrites it", async () => {
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    expect(registry.list()).toEqual([]);
    await registry.installExample();
    expect(registry.list()[0].manifest?.id).toBe("terraforge.example-grid");
    expect(await readFile(join(folder, EXAMPLE_PLUGIN_FILENAME), "utf8")).toBe(EXAMPLE_PLUGIN_SOURCE);
    const customised = EXAMPLE_PLUGIN_SOURCE + "// user's changes\n";
    await writeFile(join(folder, EXAMPLE_PLUGIN_FILENAME), customised);
    await registry.installExample();
    expect(await readFile(join(folder, EXAMPLE_PLUGIN_FILENAME), "utf8")).toBe(customised);
  });

  it("rejects directory entries and directory links without following their contents", async () => {
    const outside = join(folder, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "hidden.tf-plugin.js"), source("outside.plugin"));
    await symlink(outside, join(folder, "link.tf-plugin.js"), "junction");
    await mkdir(join(folder, "directory.tf-plugin.js"));
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    expect(registry.list()).toHaveLength(2);
    expect(registry.list().every((entry) => !entry.enabled && entry.error?.includes("regular file"))).toBe(true);
  });

  it("fails closed for malformed settings so disabled preferences are not silently lost", async () => {
    await writeFile(join(folder, "tool.tf-plugin.js"), source());
    await writeFile(join(folder, ".plugin-state.json"), "{invalid json");
    const registry = new PluginRegistry(folder);
    await expect(registry.initialise()).rejects.toThrow(/settings.*invalid JSON/);
    expect(() => registry.list()).toThrow(/not ready/);
  });

  it("rejects invalid UTF-8 instead of silently changing executable bytes", async () => {
    await writeFile(join(folder, "invalid.tf-plugin.js"), Buffer.from([0xc3, 0x28]));
    const registry = new PluginRegistry(folder);
    await registry.initialise();
    expect(registry.list()[0].enabled).toBe(false);
    expect(registry.list()[0].error).toBeTruthy();
  });
});