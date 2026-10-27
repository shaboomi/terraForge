import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createSvgImport, createSvgPath } from "../../../../../tests/helpers/factories";
import type { CanvasItem, PluginEntry, PluginManifest, PluginResult, PluginsApi } from "../../../../types";
import { useCanvasStore } from "../../store/canvasStore";
import { useMachineStore } from "../../store/machineStore";
import { usePluginStore } from "./pluginStore";
import { useTaskStore } from "../../store/taskStore";

const manifest: PluginManifest = { id: "test.vector.processor", name: "Vector processor", version: "1.0.0", apiVersion: 1,
  description: "Process a vector with user pens.", category: "bitmap-processor", input: "vector", outputs: ["vector"],
  controls: [{ key: "amount", label: "Amount", type: "number", min: 1, max: 5, default: 1 }] };
const entry: PluginEntry = { filename: "processor.tf-plugin.js", manifest, enabled: true };
const point = (x: number, y: number) => ({ x, y });
const output = (pens = ["white", "red"]): PluginResult => ({ items: [{ kind: "vector", width: 20, height: 10,
  paths: pens.map((penId, index) => ({ points: [point(2, index + 2), point(18, index + 2)], penId })) }] });
let plugins: PluginsApi;
let source: CanvasItem;

beforeEach(() => {
  usePluginStore.getState().cancel(); usePluginStore.getState().discardPreview();
  vi.stubGlobal("crypto", webcrypto);
  source = createSvgImport({ id: "source", name: "Source", svgWidth: 20, svgHeight: 10,
    x: 25, y: 30, scale: 2, scaleX: 3, scaleY: 4, rotation: 37,
    paths: [createSvgPath({ d: "M2 2 L18 2", strokeColor: "#333333" })] });
  useCanvasStore.setState({ imports: [source], assets: {}, layerGroups: [
    { id: "white", name: "White", color: "#ffffff", importIds: [] },
    { id: "red", name: "Red", color: "#ff0000", importIds: [] }], activePenId: "white",
    undoStack: [], redoStack: [], pageTemplate: null, selectedImportId: "source", selectedPathId: null,
    selectedGroupId: null, allImportsSelected: false, toolpathSelected: false, clipboardImport: null });
  useMachineStore.setState({ configs: [], activeConfigId: null, status: null, connected: false });
  useTaskStore.setState({ tasks: {} });
  plugins = { list: vi.fn().mockResolvedValue([entry]), run: vi.fn().mockResolvedValue(output()),
    cancel: vi.fn().mockResolvedValue(undefined), openFolder: vi.fn(), installExample: vi.fn(), setEnabled: vi.fn() };
  window.terraForge.plugins = plugins;
  usePluginStore.setState({ entries: [entry], activeFilename: entry.filename, parameters: { [manifest.id]: { amount: 1 } },
    loading: false, saving: [], collapsed: false, editingImportId: null, preview: null, running: null, runError: null });
});
afterEach(() => { usePluginStore.getState().cancel(); usePluginStore.getState().discardPreview(); vi.unstubAllGlobals(); });

describe("processing preview transactions", () => {
  it("keeps preview outside history/plotting and applies all pen partitions once", async () => {
    const original = structuredClone(source);
    const vectorsBefore = useCanvasStore.getState().toVectorObjects();
    await usePluginStore.getState().previewRun();
    expect(usePluginStore.getState().preview?.items).toHaveLength(2);
    expect(useCanvasStore.getState().imports).toEqual([original]);
    expect(useCanvasStore.getState().toVectorObjects()).toEqual(vectorsBefore);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
    usePluginStore.getState().applyPreview();
    expect(useCanvasStore.getState().imports).toHaveLength(3);
    expect(useCanvasStore.getState().imports[0]).toEqual(original);
    expect(useCanvasStore.getState().layerGroups.map(pen => pen.importIds.length)).toEqual([1, 1]);
    expect(useCanvasStore.getState().activePenId).toBe("white");
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    usePluginStore.getState().applyPreview();
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    useCanvasStore.getState().undo(); expect(useCanvasStore.getState().imports).toEqual([original]);
    useCanvasStore.getState().redo(); expect(useCanvasStore.getState().imports).toHaveLength(3);
  });

  it("updates the complete saved output group and preserves surviving pen identity", async () => {
    await usePluginStore.getState().previewRun(); usePluginStore.getState().applyPreview();
    const redId = useCanvasStore.getState().layerGroups.find(pen => pen.id === "red")!.importIds[0];
    useCanvasStore.getState().editImport(redId, { x: 77, rotation: 19 });
    usePluginStore.getState().editImport(redId);
    vi.mocked(plugins.run).mockResolvedValue(output(["red"]));
    await usePluginStore.getState().previewRun();
    usePluginStore.getState().applyPreview();
    expect(useCanvasStore.getState().imports).toHaveLength(2);
    expect(useCanvasStore.getState().imports[1]).toMatchObject({ id: redId, x: 77, rotation: 19 });
    expect(useCanvasStore.getState().layerGroups.find(pen => pen.id === "white")!.importIds).toEqual([]);
    expect(useCanvasStore.getState().layerGroups.find(pen => pen.id === "red")!.importIds).toEqual([redId]);
    useCanvasStore.getState().undo(); expect(useCanvasStore.getState().imports).toHaveLength(3);
  });

  it.each(["source", "selection", "pen", "page", "parameters"])("invalidates a prepared preview after %s changes", async (change) => {
    await usePluginStore.getState().previewRun();
    if (change === "source") useCanvasStore.getState().editImport("source", { x: 50 });
    if (change === "selection") useCanvasStore.getState().selectImport(null);
    if (change === "pen") useCanvasStore.getState().updateLayerGroup("red", { color: "#dd0000" });
    if (change === "page") useCanvasStore.getState().setPageTemplate({ sizeId: "a4", landscape: false, marginMM: 5 });
    if (change === "parameters") usePluginStore.getState().setParameter(manifest.id, "amount", 2);
    expect(usePluginStore.getState().preview).toBeNull();
    const before = useCanvasStore.getState().imports;
    usePluginStore.getState().applyPreview(); expect(useCanvasStore.getState().imports).toBe(before);
  });

  it("cancels a pending processor on source edits and ignores its late successful reply", async () => {
    let resolve!: (value: PluginResult) => void;
    vi.mocked(plugins.run).mockReturnValue(new Promise(yes => { resolve = yes; }));
    const run = usePluginStore.getState().previewRun();
    await vi.waitFor(() => expect(plugins.run).toHaveBeenCalled());
    useCanvasStore.getState().editImport("source", { x: 60 });
    expect(plugins.cancel).toHaveBeenCalled();
    resolve(output()); await run;
    expect(usePluginStore.getState().preview).toBeNull();
    expect(useCanvasStore.getState().imports).toHaveLength(1);
  });

  it("detaches a pasted result so editing it cannot replace the original group's siblings", async () => {
    await usePluginStore.getState().previewRun(); usePluginStore.getState().applyPreview();
    const original = useCanvasStore.getState().imports.slice(1);
    useCanvasStore.getState().copyImport(original[0].id); useCanvasStore.getState().pasteImport();
    const copied = useCanvasStore.getState().imports.at(-1)!;
    expect(copied.pluginSource?.outputGroupId).not.toBe(original[0].pluginSource?.outputGroupId);
    usePluginStore.getState().editImport(copied.id);
    await usePluginStore.getState().previewRun(); usePluginStore.getState().applyPreview();
    for (const item of original) expect(useCanvasStore.getState().imports.find(current => current.id === item.id)).toEqual(item);
    expect(useCanvasStore.getState().imports).toHaveLength(5);
  });

  it("preserves the input even when loaded provenance falsely makes it an output-group sibling", async () => {
    await usePluginStore.getState().previewRun(); usePluginStore.getState().applyPreview();
    const target = useCanvasStore.getState().imports[1];
    useCanvasStore.getState().editImport("source", { pluginSource: { ...target.pluginSource!, outputIndex: 9, outputKey: "forged" } });
    const original = structuredClone(useCanvasStore.getState().imports[0]);
    usePluginStore.getState().editImport(target.id);
    await usePluginStore.getState().previewRun();
    expect(usePluginStore.getState().preview?.replaceIds).not.toContain("source");
    usePluginStore.getState().applyPreview();
    expect(useCanvasStore.getState().imports.find(item => item.id === "source")).toEqual(original);
    expect(useCanvasStore.getState().imports).toHaveLength(3);
  });

  it("preserves generator scaling when a preview-created result changes its declared dimensions", async () => {
    const generator = { ...manifest, input: "none" as const, category: "generator" as const };
    usePluginStore.setState({ entries: [{ ...entry, manifest: generator }] });
    vi.mocked(plugins.run).mockResolvedValue({ width: 20, height: 10, paths: [{ points: [point(0, 0), point(20, 10)] }] });
    await usePluginStore.getState().previewRun(); usePluginStore.getState().applyPreview();
    const generated = useCanvasStore.getState().imports.at(-1)!;
    useCanvasStore.getState().editImport(generated.id, { scale: 2, scaleX: 3, scaleY: 4, x: 18, rotation: 15 });
    usePluginStore.getState().editImport(generated.id);
    vi.mocked(plugins.run).mockResolvedValue({ width: 40, height: 15, paths: [{ points: [point(0, 0), point(40, 15)] }] });
    await usePluginStore.getState().run();
    expect(useCanvasStore.getState().imports.find(item => item.id === generated.id)).toMatchObject({ svgWidth: 40, svgHeight: 15,
      scale: 2, scaleX: 3, scaleY: 4, x: 18, rotation: 15 });
  });
});
