import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { PluginEntry, PluginManifest, PluginResult, PluginsApi } from "../../../../types";
import { PropertiesPanel } from "../../components/PropertiesPanel";
import { useCanvasStore } from "../../store/canvasStore";
import { useMachineStore } from "../../store/machineStore";
import { useTaskStore } from "../../store/taskStore";
import { defaultParameters, importPluginResult } from "./pluginHelpers";
import { usePluginStore } from "./pluginStore";
import { PluginPanel } from "./PluginPanel";
import { PluginsMenu } from "./PluginsMenu";
import { PluginControlField } from "./PluginControlField";

const manifest: PluginManifest = { id: "test.rectangle", name: "Rectangle Generator", version: "1.0.0", apiVersion: 1, description: "Draw a rectangle.", category: "generator", input: "none", outputs: ["vector"], controls: [{ key: "width", label: "Width (mm)", type: "number", default: 20, min: 1, max: 100 }] };
const entry: PluginEntry = { filename: "rectangle.tfplugin.json", manifest, enabled: true };
const result: PluginResult = { width: 20, height: 10, paths: [{ points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }], closed: true, color: "#123456" }] };
let plugins: PluginsApi;
function deferred() { let resolve!: (value: PluginResult) => void; let reject!: (error: Error) => void; const promise = new Promise<PluginResult>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

beforeEach(() => {
  plugins = { list: vi.fn().mockResolvedValue([entry]), openFolder: vi.fn().mockResolvedValue(undefined), installExample: vi.fn().mockResolvedValue(undefined), setEnabled: vi.fn().mockResolvedValue(undefined), run: vi.fn().mockResolvedValue(result), cancel: vi.fn().mockResolvedValue(undefined) };
  window.terraForge.plugins = plugins;
  useCanvasStore.setState({ imports: [], layerGroups: [], undoStack: [], redoStack: [], pageTemplate: null, selectedImportId: null, gcodeToolpath: null });
  useMachineStore.setState({ configs: [], activeConfigId: null, status: null, connected: false });
  useTaskStore.setState({ tasks: {} });
  usePluginStore.setState({ entries: [entry], activeFilename: entry.filename, parameters: { [manifest.id]: defaultParameters(manifest) }, loading: false, saving: [], collapsed: false, editingImportId: null, error: null, runError: null, running: null });
});

describe("plugin interface", () => {
  it("shows usable generator controls under Properties on an empty canvas", () => {
    render(<PropertiesPanel />);
    expect(screen.getByRole("region", { name: "Plugin: Rectangle Generator" })).toBeInTheDocument();
    expect(screen.getByLabelText("Width (mm)")).toHaveValue(20);
    expect(screen.getByRole("button", { name: "Add artwork" })).toBeEnabled();
    expect(screen.getByText(/No objects/)).toBeInTheDocument();
  });
  it("opens the saved artwork's plugin settings from its Properties action", () => {
    const generated = importPluginResult(result, manifest, { width: 42 }, { widthMM: 220, heightMM: 200 });
    useCanvasStore.getState().loadLayout([JSON.parse(JSON.stringify(generated))]);
    useCanvasStore.getState().selectImport(generated.id);
    usePluginStore.getState().closePanel();
    render(<PropertiesPanel />);
    expect(screen.queryByRole("region", { name: "Plugin: Rectangle Generator" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit with Rectangle Generator" }));
    const panel = screen.getByRole("region", { name: "Plugin: Rectangle Generator" });
    expect(within(panel).getByLabelText("Width (mm)")).toHaveValue(42);
    expect(within(panel).getByRole("button", { name: "Update artwork" })).toBeEnabled();
    expect(usePluginStore.getState().editingImportId).toBe(generated.id);
    expect(plugins.run).not.toHaveBeenCalled();
  });
  it.each([
    ["missing", /plugin is not installed/],
    ["disabled", /Enable this plugin/],
    ["version", /requires plugin version 1\.0\.0/],
    ["settings", /saved settings are incompatible/],
  ] as const)("explains why saved artwork's plugin settings are unavailable: %s", (condition, reason) => {
    const generated = importPluginResult(result, manifest, { width: condition === "settings" ? 150 : 20 }, { widthMM: 220, heightMM: 200 });
    useCanvasStore.getState().loadLayout([generated]);
    useCanvasStore.getState().selectImport(generated.id);
    usePluginStore.getState().closePanel();
    if (condition === "missing") usePluginStore.setState({ entries: [] });
    if (condition === "disabled") usePluginStore.setState({ entries: [{ ...entry, enabled: false }] });
    if (condition === "version") usePluginStore.setState({ entries: [{ ...entry, manifest: { ...manifest, version: "2.0.0" } }] });
    render(<PropertiesPanel />);
    expect(screen.getByRole("button", { name: "Edit plugin settings" })).toBeDisabled();
    expect(screen.getByText(reason)).toBeInTheDocument();
    expect(useCanvasStore.getState().imports).toHaveLength(1);
    expect(plugins.run).not.toHaveBeenCalled();
  });
  it("minimises and expands the panel without losing its settings", () => {
    render(<PluginPanel />);
    fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByLabelText("Width (mm)")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close plugin panel" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByLabelText("Width (mm)")).toHaveValue(35);
    expect(plugins.run).not.toHaveBeenCalled();
    expect(plugins.cancel).not.toHaveBeenCalled();
  });
  it("closes a finished plugin panel while keeping its artwork, settings and enabled state", async () => {
    usePluginStore.getState().setParameter(manifest.id, "width", 35);
    await usePluginStore.getState().run();
    const imports = useCanvasStore.getState().imports;
    const history = useCanvasStore.getState().undoStack;
    render(<PluginPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Close plugin panel" }));
    expect(screen.queryByRole("region", { name: "Plugin: Rectangle Generator" })).not.toBeInTheDocument();
    expect(usePluginStore.getState().activeFilename).toBeNull();
    expect(useCanvasStore.getState().imports).toBe(imports);
    expect(useCanvasStore.getState().undoStack).toBe(history);
    expect(usePluginStore.getState().entries[0].enabled).toBe(true);
    expect(usePluginStore.getState().parameters[manifest.id].width).toBe(35);
    expect(plugins.setEnabled).not.toHaveBeenCalled();
    expect(plugins.cancel).not.toHaveBeenCalled();
    act(() => usePluginStore.getState().select(entry));
    expect(screen.getByLabelText("Width (mm)")).toHaveValue(35);
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
  });
  it("expands a minimised plugin when it is selected again", () => {
    render(<PluginPanel />);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(screen.queryByRole("button", { name: "Add artwork" })).not.toBeInTheDocument();
    act(() => usePluginStore.getState().select(entry));
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add artwork" })).toBeEnabled();
  });
  it("can close a minimised running plugin and discard its late result", async () => {
    const job = deferred(); vi.mocked(plugins.run).mockReturnValue(job.promise);
    const running = usePluginStore.getState().run();
    const runId = usePluginStore.getState().running!.runId;
    render(<PluginPanel />);
    fireEvent.click(screen.getByRole("button", { expanded: true }));
    expect(usePluginStore.getState().running?.runId).toBe(runId);
    expect(plugins.cancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close plugin panel" }));
    expect(plugins.cancel).toHaveBeenCalledWith(runId);
    expect(usePluginStore.getState().activeFilename).toBeNull();
    expect(usePluginStore.getState().running).toBeNull();
    await act(async () => { job.resolve(result); await running; });
    expect(useCanvasStore.getState().imports).toHaveLength(0);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Plugin: Rectangle Generator" })).not.toBeInTheDocument();
  });
  it("lists categories, disabled entries, and invalid files without running any code", async () => {
    const disabled = { ...entry, filename: "disabled.json", enabled: false, manifest: { ...manifest, id: "disabled", name: "Disabled Generator" } };
    vi.mocked(plugins.list).mockResolvedValue([entry, disabled, { filename: "broken.json", enabled: false, error: "Invalid manifest" }]);
    render(<PluginsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    expect(await screen.findByRole("button", { name: "Disabled Generator" })).toBeDisabled();
    expect(screen.getByRole("region", { name: "Bitmap Processors" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Font Tools" })).toBeInTheDocument();
    expect(screen.getByText("Invalid manifest")).toHaveAttribute("role", "alert");
    expect(plugins.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close Plugins" }));
    expect(screen.queryByRole("dialog", { name: "Plugins" })).not.toBeInTheDocument();
  });
  it("updates enable checkboxes immediately and rolls back failed persistence", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(plugins.setEnabled).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render(<PluginsMenu />);
    fireEvent.click(screen.getByRole("button", { name: "Plugins" }));
    const checkbox = await screen.findByRole("checkbox", { name: "Enable Rectangle Generator" });
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    await act(async () => { reject(new Error("Cannot save plugin settings")); });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Cannot save plugin settings");
  });
  it("keeps an in-flight toggle when a stale registry response arrives", async () => {
    let finish!: () => void;
    vi.mocked(plugins.setEnabled).mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    const toggling = usePluginStore.getState().setEnabled(entry, false);
    expect(usePluginStore.getState().entries[0].enabled).toBe(false);
    await usePluginStore.getState().refresh();
    expect(usePluginStore.getState().entries[0].enabled).toBe(false);
    finish(); await toggling;
    expect(usePluginStore.getState().entries[0].enabled).toBe(false);
  });
  it("explains the required bitmap selection before a processor can preview", () => {
    usePluginStore.setState({ entries: [{ ...entry, manifest: { ...manifest, input: "bitmap", category: "bitmap-processor" } }] });
    render(<PluginPanel />);
    expect(screen.getByText(/Select one bitmap to use this plugin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
  });
  it("validates parameter values and resets defaults", async () => {
    render(<PluginPanel />);
    fireEvent.change(screen.getByLabelText("Width (mm)"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Add artwork" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("between 1 and 100");
    expect(plugins.run).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByLabelText("Width (mm)")).toHaveValue(20);
  });
  it("renders all declarative control kinds and emits typed values", () => {
    const onChange = vi.fn();
    const { rerender } = render(<PluginControlField control={{ key: "value", label: "Enabled", type: "boolean", default: false }} value={false} disabled={false} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Enabled")); expect(onChange).toHaveBeenLastCalledWith(true);
    rerender(<PluginControlField control={{ key: "value", label: "Density", type: "slider", default: 3, min: 1, max: 10 }} value={3} disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Density"), { target: { value: "4" } }); expect(onChange).toHaveBeenLastCalledWith(4);
    rerender(<PluginControlField control={{ key: "value", label: "Style", type: "select", default: "a", options: [{ label: "A", value: "a" }, { label: "B", value: "b" }] }} value="a" disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Style"), { target: { value: "b" } }); expect(onChange).toHaveBeenLastCalledWith("b");
    rerender(<PluginControlField control={{ key: "value", label: "Text", type: "text", default: "", multiline: true }} value="" disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Text"), { target: { value: "hello" } }); expect(onChange).toHaveBeenLastCalledWith("hello");
    rerender(<PluginControlField control={{ key: "value", label: "Colour", type: "colour", default: "#000000" }} value="#000000" disabled={false} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Colour"), { target: { value: "#abcdef" } }); expect(onChange).toHaveBeenLastCalledWith("#abcdef");
  });
});

describe("plugin execution transactions", () => {
  it("adds safe ordinary vector artwork with provenance in one undo operation", async () => {
    usePluginStore.getState().setParameter(manifest.id, "width", 30);
    await usePluginStore.getState().run();
    expect(plugins.run).toHaveBeenCalledWith(expect.objectContaining({ pluginId: manifest.id, parameters: { width: 30 }, input: { kind: "none", page: { widthMM: 220, heightMM: 200 } } }));
    const canvas = useCanvasStore.getState();
    expect(canvas.imports).toHaveLength(1); expect(canvas.undoStack).toHaveLength(1);
    expect(canvas.imports[0]).toMatchObject({ scale: 1, name: manifest.name, svgWidth: 20, pluginSource: { pluginId: manifest.id, pluginVersion: "1.0.0", parameters: { width: 30 } } });
    expect(canvas.imports[0].paths[0].svgSource).toBe('<path d="M0 0 L20 0 L20 10 Z" fill="none" stroke="#123456" />');
    canvas.undo(); expect(useCanvasStore.getState().imports).toHaveLength(0);
    useCanvasStore.getState().redo(); expect(useCanvasStore.getState().imports).toHaveLength(1);
  });
  it("restores saved generator parameters when reopening its artwork", () => {
    const generated = importPluginResult(result, manifest, { width: 42 }, { widthMM: 220, heightMM: 200 });
    // Layout deserialisation must retain enough provenance to edit without rerunning.
    const saved = JSON.parse(JSON.stringify(generated));
    useCanvasStore.getState().loadLayout([saved]);
    useCanvasStore.setState({ undoStack: [] });
    usePluginStore.setState({ collapsed: true });
    usePluginStore.getState().editImport(generated.id);
    render(<PluginPanel />);
    expect(screen.getByLabelText("Width (mm)")).toHaveValue(42);
    expect(screen.getByRole("button", { name: "Update artwork" })).toBeEnabled();
    expect(screen.getByRole("button", { expanded: true })).toBeInTheDocument();
    expect(usePluginStore.getState().editingImportId).toBe(generated.id);
    expect(plugins.run).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
  });
  it("updates one generated import while preserving its identity and placement in one undo step", async () => {
    const generated = {
      ...importPluginResult(result, manifest, { width: 20 }, { widthMM: 220, heightMM: 200 }),
      name: "Placed grid", x: 17, y: 21, scale: 0.8, scaleX: 0.7, scaleY: 0.6, rotation: 32,
      visible: false, strokeEnabled: false, strokeWidthMM: 1.8, hatchEnabled: true, hatchSpacingMM: 3, hatchAngleDeg: 40,
    };
    useCanvasStore.getState().loadLayout([generated]);
    const original = JSON.parse(JSON.stringify(useCanvasStore.getState().imports[0]));
    useCanvasStore.setState({ undoStack: [], redoStack: [] });
    usePluginStore.getState().editImport(generated.id);
    usePluginStore.getState().setParameter(manifest.id, "width", 30);
    vi.mocked(plugins.run).mockResolvedValue({ ...result, width: 30, height: 12 });
    await usePluginStore.getState().run();
    const state = useCanvasStore.getState();
    expect(state.imports).toHaveLength(1);
    expect(state.imports[0]).toMatchObject({
      id: generated.id, name: "Placed grid", x: 17, y: 21, scale: 0.8,
      scaleX: 0.7, scaleY: 0.6, rotation: 32, svgWidth: 30, svgHeight: 12,
      visible: false, strokeEnabled: false, strokeWidthMM: 1.8, hatchEnabled: true, hatchSpacingMM: 3, hatchAngleDeg: 40,
      pluginSource: { pluginId: manifest.id, pluginVersion: manifest.version, parameters: { width: 30 } },
    });
    expect(state.undoStack).toHaveLength(1);
    state.undo();
    expect(useCanvasStore.getState().imports).toEqual([original]);
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().imports).toHaveLength(1);
    expect(useCanvasStore.getState().imports[0].svgWidth).toBe(30);
  });
  it("returns to creating new artwork when a plugin is selected from the menu", () => {
    const generated = importPluginResult(result, manifest, { width: 20 }, { widthMM: 220, heightMM: 200 });
    useCanvasStore.getState().loadLayout([generated]);
    usePluginStore.getState().editImport(generated.id);
    usePluginStore.getState().select(entry);
    render(<PluginPanel />);
    expect(usePluginStore.getState().editingImportId).toBeNull();
    expect(screen.getByRole("button", { name: "Add artwork" })).toBeEnabled();
    expect(useCanvasStore.getState().imports).toHaveLength(1);
  });
  it.each(["missing target", "removed plugin", "disabled plugin", "different plugin version"])("does not modify artwork or history with %s", async (condition) => {
    const generated = importPluginResult(result, manifest, { width: 20 }, { widthMM: 220, heightMM: 200 });
    useCanvasStore.getState().loadLayout([generated]);
    useCanvasStore.setState({ undoStack: [], redoStack: [] });
    usePluginStore.getState().editImport(generated.id);
    if (condition === "missing target") useCanvasStore.setState({ imports: [] });
    if (condition === "removed plugin") usePluginStore.setState({ entries: [] });
    if (condition === "disabled plugin") usePluginStore.setState({ entries: [{ ...entry, enabled: false }] });
    if (condition === "different plugin version") usePluginStore.setState({ entries: [{ ...entry, manifest: { ...manifest, version: "2.0.0" } }] });
    const imports = useCanvasStore.getState().imports;
    await usePluginStore.getState().run();
    expect(useCanvasStore.getState().imports).toBe(imports);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
  });
  it("cancels immediately and discards a late successful result", async () => {
    const job = deferred(); vi.mocked(plugins.run).mockReturnValue(job.promise);
    const running = usePluginStore.getState().run();
    const runId = usePluginStore.getState().running!.runId;
    render(<PluginPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel plugin" }));
    expect(plugins.cancel).toHaveBeenCalledWith(runId);
    await act(async () => { job.resolve(result); await running; });
    expect(useCanvasStore.getState().imports).toHaveLength(0);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
  });
  it("does not let a closed run's cancellation affect a reopened plugin run", async () => {
    const oldJob = deferred();
    const newJob = deferred();
    let rejectCancel!: (error: Error) => void;
    vi.mocked(plugins.run).mockReturnValueOnce(oldJob.promise).mockReturnValueOnce(newJob.promise);
    vi.mocked(plugins.cancel).mockReturnValue(new Promise<void>((_, reject) => { rejectCancel = reject; }));
    const oldRun = usePluginStore.getState().run();
    const oldRunId = usePluginStore.getState().running!.runId;
    render(<PluginPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Close plugin panel" }));
    let newRun!: Promise<void>;
    act(() => {
      usePluginStore.getState().select(entry);
      newRun = usePluginStore.getState().run();
    });
    const newRunId = usePluginStore.getState().running!.runId;
    expect(newRunId).not.toBe(oldRunId);
    act(() => useTaskStore.getState().cancelTask(oldRunId));
    expect(usePluginStore.getState().running?.runId).toBe(newRunId);
    expect(plugins.cancel).toHaveBeenCalledTimes(1);
    await act(async () => {
      rejectCancel(new Error("Previous cancellation failed"));
      await Promise.resolve();
    });
    expect(usePluginStore.getState().runError).toBeNull();
    await act(async () => { oldJob.resolve(result); await oldRun; });
    expect(usePluginStore.getState().running?.runId).toBe(newRunId);
    expect(useCanvasStore.getState().imports).toHaveLength(0);
    await act(async () => { newJob.resolve(result); await newRun; });
    expect(useCanvasStore.getState().imports).toHaveLength(1);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
  });
  it("routes existing task cancellation to the plugin host", async () => {
    const job = deferred(); vi.mocked(plugins.run).mockReturnValue(job.promise);
    const running = usePluginStore.getState().run();
    const runId = usePluginStore.getState().running!.runId;
    useTaskStore.getState().cancelTask(runId);
    expect(plugins.cancel).toHaveBeenCalledWith(runId);
    job.resolve(result); await running;
    expect(useCanvasStore.getState().imports).toHaveLength(0);
  });
  it("rejects results after document changes even if those changes are undone", async () => {
    const job = deferred(); vi.mocked(plugins.run).mockReturnValue(job.promise);
    const running = usePluginStore.getState().run();
    useCanvasStore.getState().setPageTemplate({ sizeId: "a5", landscape: false, marginMM: 10 });
    useCanvasStore.getState().setPageTemplate(null);
    job.resolve(result); await running;
    expect(useCanvasStore.getState().imports).toHaveLength(0);
    expect(usePluginStore.getState().runError).toMatch(/document or page changed/);
  });
  it("shows the plugin error without Electron's remote-call wrapper", async () => {
    vi.mocked(plugins.run).mockRejectedValue(new Error("Error invoking remote method 'plugins:run': Error: Reduce the grid spacing."));
    render(<PluginPanel />);
    await act(async () => { await usePluginStore.getState().run(); });
    expect(screen.getByRole("alert")).toHaveTextContent("Reduce the grid spacing.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("plugins:run");
    expect(usePluginStore.getState().runError).toBe("Reduce the grid spacing.");
    expect(Object.values(useTaskStore.getState().tasks)[0].error).toBe("Reduce the grid spacing.");
  });
  it("leaves the document unchanged when execution fails", async () => {
    vi.mocked(plugins.run).mockRejectedValue(new Error("Plugin timed out"));
    await usePluginStore.getState().run();
    expect(usePluginStore.getState().runError).toBe("Plugin timed out");
    expect(useCanvasStore.getState().imports).toHaveLength(0);
    expect(useCanvasStore.getState().undoStack).toHaveLength(0);
    expect(Object.values(useTaskStore.getState().tasks)[0]).toMatchObject({ type: "plugin-run", status: "error" });
  });
  it("rejects oversized and invalid-coordinate outputs without cropping or scaling", () => {
    expect(() => importPluginResult({ ...result, width: 250 }, manifest, {}, { widthMM: 100, heightMM: 100 })).toThrow(/larger than the page/);
    expect(() => importPluginResult({ ...result, paths: [{ points: [{ x: 0, y: 0 }, { x: Infinity, y: 2 }] }] }, manifest, {}, { widthMM: 100, heightMM: 100 })).toThrow(/outside its artwork/);
  });
});
