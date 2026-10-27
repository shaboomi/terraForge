import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { BitmapImport } from "../../../../../types";
import { PropertiesPanel } from "../../../components/PropertiesPanel";
import { useCanvasStore } from "../../../store/canvasStore";
import { useMachineStore } from "../../../store/machineStore";
import { usePluginStore } from "../../plugins/pluginStore";

const bitmap: BitmapImport = { id: "bitmap", kind: "bitmap", name: "reference", assetId: "image", opacity: 1, x: 10, y: 15, scale: 0.2, rotation: 0, visible: true, svgWidth: 200, svgHeight: 100, viewBoxX: 0, viewBoxY: 0 };
beforeEach(() => {
  useCanvasStore.setState({ imports: [bitmap], assets: { image: { id: "image", mimeType: "image/png", data: "cG5n", widthPx: 200, heightPx: 100 } }, layerGroups: [], selectedImportId: bitmap.id, selectedGroupId: null, selectedPathId: null, allImportsSelected: false, pageTemplate: null, gcodeToolpath: null, undoStack: [], redoStack: [] });
  useMachineStore.setState({ configs: [], activeConfigId: null, status: null, connected: false });
  usePluginStore.setState({ activeFilename: null, editingImportId: null, collapsed: false, running: null });
});
function inputFor(label: string) { return screen.getByText(label).parentElement!.querySelector("input")!; }

describe("bitmap Properties", () => {
  it("shows the image badge, original pixels and shared controls without vector-only controls", () => {
    render(<PropertiesPanel />);
    expect(screen.getByText("Bitmap")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Bitmap properties" })).toHaveTextContent("200 × 100 pixels");
    for (const label of ["X (mm)", "Y (mm)", "W (mm)", "H (mm)", "Rotation (°)"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByLabelText("Opacity (%)")).toHaveValue("100");
    expect(screen.queryByLabelText("Stroke width")).not.toBeInTheDocument();
    expect(screen.queryByText("Stroke outlines")).not.toBeInTheDocument();
    expect(screen.queryByText("Hatch fill")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Expand paths" })).not.toBeInTheDocument();
  });
  it("updates opacity and frame transforms while retaining the image asset", () => {
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByLabelText("Opacity (%)"), { target: { value: "45" } });
    fireEvent.change(inputFor("X (mm)"), { target: { value: "24" } });
    fireEvent.change(inputFor("Rotation (°)"), { target: { value: "33" } });
    fireEvent.change(inputFor("W (mm)"), { target: { value: "80" } });
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ kind: "bitmap", assetId: "image", opacity: 0.45, x: 24, rotation: 33, scale: 0.4 });
    expect(useCanvasStore.getState().assets.image.data).toBe("cG5n");
  });
  it("undoes bitmap opacity and numeric sizing edits without copying or losing its asset", () => {
    render(<PropertiesPanel />);
    fireEvent.change(screen.getByLabelText("Opacity (%)"), { target: { value: "45" } });
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ opacity: 1, assetId: "image" });
    act(() => useCanvasStore.getState().selectImport(bitmap.id));
    fireEvent.change(inputFor("W (mm)"), { target: { value: "80" } });
    expect(useCanvasStore.getState().imports[0].scale).toBe(0.4);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().imports[0].scale).toBe(0.2);
    expect(useCanvasStore.getState().assets.image.data).toBe("cG5n");
  });
  it("resets image size using the 96 DPI image convention instead of SVG units", () => {
    render(<PropertiesPanel />);
    fireEvent.click(screen.getByTitle("Reset image size to 96 DPI"));
    expect(useCanvasStore.getState().imports[0].scale).toBeCloseTo(25.4 / 96);
    expect(useCanvasStore.getState().imports[0].svgWidth).toBe(200);
    expect(screen.queryByTitle("Reset scale + ratio lock to 1:1 (1 SVG unit = 1 mm)")).not.toBeInTheDocument();
  });
  it("supports rename and visibility without vector paths", () => {
    render(<PropertiesPanel />);
    fireEvent.doubleClick(screen.getByText("reference"));
    const rename = screen.getByDisplayValue("reference");
    fireEvent.change(rename, { target: { value: "Portrait" } });
    fireEvent.keyDown(rename, { key: "Enter" });
    expect(useCanvasStore.getState().imports[0].name).toBe("Portrait");
    fireEvent.click(screen.getByTitle("Toggle visibility"));
    expect(useCanvasStore.getState().imports[0].visible).toBe(false);
    expect("paths" in useCanvasStore.getState().imports[0]).toBe(false);
  });
});
