import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { BitmapImport, PluginEntry, PluginManifest } from "../../../../types";
import { useCanvasStore } from "../../store/canvasStore";
import { PluginArtworkAction } from "./PluginArtworkAction";
import { PluginPanel } from "./PluginPanel";
import { usePluginStore } from "./pluginStore";

const manifest: PluginManifest = { id: "test.tones", name: "Tones", version: "1.0.0", apiVersion: 1,
  description: "Process a bitmap.", category: "bitmap-processor", input: "bitmap", outputs: ["bitmap"] };
const entry: PluginEntry = { filename: "tones.tf-plugin.js", manifest, enabled: true };
const source: BitmapImport = { id: "source", kind: "bitmap", name: "Image", assetId: "pixels", opacity: 1,
  svgWidth: 20, svgHeight: 10, viewBoxX: 0, viewBoxY: 0, x: 10, y: 12, scale: 1, rotation: 30, visible: true };
const result: BitmapImport = { ...source, id: "result", name: "Filtered image", pluginSource: {
  pluginId: manifest.id, pluginVersion: manifest.version, parameters: {}, sourceId: source.id,
  outputGroupId: "result-group", outputGroupName: "Tones result", outputIndex: 0 } };
const actions = {
  previewRun: usePluginStore.getState().previewRun,
  applyPreview: usePluginStore.getState().applyPreview,
  discardPreview: usePluginStore.getState().discardPreview,
};

beforeEach(() => {
  usePluginStore.getState().closePanel();
  useCanvasStore.setState({ imports: [source], assets: {}, layerGroups: [], activePenId: null,
    selectedImportId: source.id, selectedGroupId: null, selectedPathId: null, allImportsSelected: false,
    undoStack: [], redoStack: [], pageTemplate: null });
  usePluginStore.setState({ ...actions, entries: [entry], activeFilename: entry.filename, editingImportId: null,
    collapsed: false, parameters: { [manifest.id]: {} }, running: null, preview: null, runError: null });
});

afterEach(() => {
  cleanup();
  usePluginStore.setState(actions);
  usePluginStore.getState().closePanel();
});

describe("processing Properties controls", () => {
  it("explains the required selection and prevents preview without a compatible source", () => {
    useCanvasStore.setState({ selectedImportId: null });
    render(<PluginPanel />);
    expect(screen.getByText("Select one bitmap to use this plugin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Apply artwork" })).not.toBeInTheDocument();
  });

  it("keeps preview and apply separate and offers cancellation without adding artwork", () => {
    const previewRun = vi.fn().mockResolvedValue(undefined);
    const applyPreview = vi.fn();
    const discardPreview = vi.fn();
    usePluginStore.setState({ previewRun, applyPreview, discardPreview, preview: {
      items: [result], assets: {}, penAssignments: {}, groupId: "result-group", groupName: "Tones result" } });
    render(<PluginPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Preview", exact: true }));
    expect(previewRun).toHaveBeenCalledOnce();
    expect(applyPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Preview · 1 item");
    fireEvent.click(screen.getByRole("button", { name: "Apply artwork" }));
    expect(applyPreview).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Cancel preview" }));
    expect(discardPreview).toHaveBeenCalledOnce();
    expect(useCanvasStore.getState().imports).toEqual([source]);
  });

  it("reopens settings for generated bitmap results and identifies the whole result group", () => {
    useCanvasStore.setState({ imports: [source, result, { ...result, id: "second", pluginSource: { ...result.pluginSource!, outputIndex: 1 } }] });
    render(<PluginArtworkAction artwork={result} />);
    expect(screen.getByText("Tones result · 2 items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit with Tones" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit with Tones" }));
    expect(usePluginStore.getState().editingImportId).toBe(result.id);
    expect(usePluginStore.getState().parameters[manifest.id]).toEqual({});
  });

  it("explains a missing processor source while leaving the saved bitmap usable", () => {
    useCanvasStore.setState({ imports: [result] });
    render(<PluginArtworkAction artwork={result} />);
    expect(screen.getByRole("button", { name: "Edit plugin settings" })).toBeDisabled();
    expect(screen.getByText(/source artwork is missing/)).toBeInTheDocument();
    expect(useCanvasStore.getState().imports).toEqual([result]);
  });
});
