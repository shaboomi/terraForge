import { describe, expect, it } from "vitest";
import type { PluginEntry, PluginManifest } from "../../../../types";
import { pluginMenuCategories, pluginsInCategory } from "./pluginMenuGroups";

const manifest: PluginManifest = {
  id: "test.plugin", name: "Test plugin", version: "1.0.0", apiVersion: 1,
  description: "A plugin.", category: "bitmap-processor", input: "bitmap", outputs: ["bitmap"],
};

describe("plugin menu groups", () => {
  it.each([
    ["bitmap", ["bitmap"], ["bitmap-filters"]],
    ["bitmap", ["vector"], ["bitmap-to-vector"]],
    ["bitmap", ["bitmap", "vector"], ["bitmap-filters", "bitmap-to-vector"]],
    ["none", ["vector"], ["generators"]],
    ["none", ["bitmap"], ["generators"]],
    ["vector", ["vector"], ["generators"]],
    ["vector", ["bitmap"], ["generators"]],
  ] as const)("groups %s input and %j output by capabilities", (input, outputs, categories) => {
    expect(pluginMenuCategories({ ...manifest, input, outputs: [...outputs] })).toEqual(categories);
  });

  it.each(["none", "bitmap", "vector"] as const)("gives explicit font categorisation precedence for %s input", (input) => {
    expect(pluginMenuCategories({ ...manifest, category: "font-tool", input, outputs: ["bitmap", "vector"] })).toEqual(["font-tools"]);
  });

  it("uses capabilities even when an older plugin declares the generator category", () => {
    expect(pluginMenuCategories({ ...manifest, category: "generator", input: "bitmap", outputs: ["vector"] })).toEqual(["bitmap-to-vector"]);
  });

  it("keeps disabled installed plugins discoverable and omits unavailable manifests", () => {
    const installed: PluginEntry = { filename: "filter.js", enabled: true, manifest };
    const disabled: PluginEntry = { filename: "disabled.js", enabled: false, manifest: { ...manifest, id: "test.disabled" } };
    const broken: PluginEntry = { filename: "broken.js", enabled: false, manifest, error: "Invalid plugin" };
    const unknown: PluginEntry = { filename: "unknown.js", enabled: false, error: "Invalid metadata" };
    expect(pluginsInCategory([installed, disabled, broken, unknown], "bitmap-filters")).toEqual([installed, disabled]);
    expect(pluginsInCategory([installed, disabled], "font-tools")).toEqual([]);
  });
});
