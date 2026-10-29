import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { PluginEntry, PluginManifest, PluginResult } from "../../../../types";
import { parseCanvasLayout, serializeCanvasLayout } from "../../../../types/layoutValidation";
import { validatePluginManifest, validatePluginRunRequest } from "../../../../types/pluginValidation";
import { useCanvasStore } from "../../store/canvasStore";
import { useMachineStore } from "../../store/machineStore";
import { usePluginStore } from "./pluginStore";
import { pluginEditor } from "./pluginEditing";
import { PluginArtworkAction } from "./PluginArtworkAction";
import { PluginPanel } from "./PluginPanel";

const manifest: PluginManifest = { id: "test.rescan", name: "Rescan Test", version: "1.0.0", apiVersion: 1,
  description: "Test", category: "generator", input: "none", outputs: ["vector"] };
const entry: PluginEntry = { filename: "rescan.tf-plugin.js", manifest, enabled: true, sourceFingerprint: "a".repeat(64) };
const result: PluginResult = { width: 20, height: 10, paths: [{ points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }] };
const rescan = vi.fn();
const run = vi.fn();
const cancel = vi.fn();

beforeEach(() => {
  usePluginStore.getState().closePanel();
  rescan.mockReset().mockResolvedValue([entry]); run.mockReset().mockResolvedValue(result); cancel.mockReset().mockResolvedValue(undefined);
  window.terraForge.plugins = { list: vi.fn().mockResolvedValue([entry]), rescan, run, cancel,
    openFolder: vi.fn(), installExample: vi.fn(), setEnabled: vi.fn() };
  useMachineStore.setState({ configs: [], activeConfigId: null });
  useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [], activePenId: null, undoStack: [], redoStack: [], pageTemplate: null,
    selectedImportId: null, selectedGroupId: null, selectedPathId: null, allImportsSelected: false });
  usePluginStore.setState({ entries: [entry], activeFilename: entry.filename, parameters: { [manifest.id]: {} },
    detailBudgets: {}, loading: false, saving: [], editingImportId: null, running: null, preview: null, error: null });
});

it("pins a renderer request and portable saved provenance to the executable fingerprint", async () => {
  await usePluginStore.getState().run();
  expect(run.mock.calls[0][0].sourceFingerprint).toBe(entry.sourceFingerprint);
  expect(validatePluginRunRequest(run.mock.calls[0][0]).sourceFingerprint).toBe(entry.sourceFingerprint);
  const artwork = useCanvasStore.getState().imports[0];
  expect(artwork.pluginSource?.sourceFingerprint).toBe(entry.sourceFingerprint);
  const saved = serializeCanvasLayout({ tfVersion: 2, savedAt: new Date().toISOString(), imports: [artwork], assets: {}, layerGroups: [], pageTemplate: null });
  expect(parseCanvasLayout(saved).imports[0].pluginSource?.sourceFingerprint).toBe(entry.sourceFingerprint);
  const malformed = JSON.parse(saved); malformed.imports[0].pluginSource.sourceFingerprint = "invalid";
  expect(() => parseCanvasLayout(JSON.stringify(malformed))).toThrow(/fingerprint/);
});

it("discloses same-version source changes and requires an explicit update without changing saved geometry", async () => {
  await usePluginStore.getState().run();
  const artwork = useCanvasStore.getState().imports[0];
  const imports = useCanvasStore.getState().imports;
  const changed = { ...entry, sourceFingerprint: "b".repeat(64) };
  rescan.mockResolvedValue([changed]);
  await usePluginStore.getState().rescan();
  expect(useCanvasStore.getState().imports).toBe(imports);
  expect(run).toHaveBeenCalledOnce();
  expect(pluginEditor(artwork, [changed]).notice).toMatch(/different plugin code/);
  const view = render(<PluginArtworkAction artwork={artwork} />);
  expect(screen.getByText(/different plugin code/)).toBeVisible();
  view.unmount();
  usePluginStore.getState().editImport(artwork.id);
  expect(run).toHaveBeenCalledOnce();
  await usePluginStore.getState().run();
  expect(useCanvasStore.getState().imports[0].id).toBe(artwork.id);
  expect(useCanvasStore.getState().imports[0].pluginSource?.sourceFingerprint).toBe(changed.sourceFingerprint);
  useCanvasStore.getState().undo();
  expect(useCanvasStore.getState().imports[0].pluginSource?.sourceFingerprint).toBe(entry.sourceFingerprint);
});

it("accepts older layouts without a fingerprint and explains that their code cannot be verified", async () => {
  await usePluginStore.getState().run();
  const artwork = structuredClone(useCanvasStore.getState().imports[0]);
  delete artwork.pluginSource!.sourceFingerprint;
  const editor = pluginEditor(artwork, [entry]);
  expect(editor.error).toBeUndefined(); expect(editor.notice).toMatch(/no saved code fingerprint/);
});

it("rescanning clears a ready preview without committing artwork", async () => {
  await usePluginStore.getState().previewRun();
  expect(usePluginStore.getState().preview).not.toBeNull();
  await usePluginStore.getState().rescan();
  expect(usePluginStore.getState().preview).toBeNull();
  usePluginStore.getState().applyPreview();
  expect(useCanvasStore.getState().imports).toHaveLength(0);
  expect(useCanvasStore.getState().undoStack).toHaveLength(0);
});

it("rescanning cancels active work and ignores late replies even when source is unchanged", async () => {
  let finish!: (value: PluginResult) => void;
  run.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const running = usePluginStore.getState().run();
  const id = usePluginStore.getState().running!.runId;
  await usePluginStore.getState().rescan();
  expect(cancel).toHaveBeenCalledWith(id);
  finish(result); await running;
  expect(useCanvasStore.getState().imports).toHaveLength(0);
  expect(usePluginStore.getState().running).toBeNull();
});

it("does not accept an earlier list response over a newer rescan", async () => {
  let finish!: (value: PluginEntry[]) => void;
  window.terraForge.plugins.list = vi.fn().mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const refreshing = usePluginStore.getState().refresh();
  // An independent list caller may finish while the explicit scan is in progress.
  usePluginStore.setState({ loading: false });
  rescan.mockResolvedValue([]);
  await usePluginStore.getState().rescan();
  finish([entry]); await refreshing;
  expect(usePluginStore.getState().entries).toEqual([]);
});

it("refuses malformed fingerprint input and leaves older requests compatible", () => {
  const request = { runId: "test", pluginId: manifest.id, parameters: {}, input: { kind: "none", page: { widthMM: 20, heightMM: 10 } } };
  expect(validatePluginRunRequest(request)).toEqual(request);
  expect(() => validatePluginRunRequest({ ...request, sourceFingerprint: "arbitrary" })).toThrow(/fingerprint/);
});

it("enforces declared Preview before Apply for converted generators, including the direct run action", async () => {
  const converted = { ...entry, manifest: { ...manifest, previewRequired: true as const } };
  expect(validatePluginManifest(converted.manifest).previewRequired).toBe(true);
  expect(() => validatePluginManifest({ ...manifest, previewRequired: false })).toThrow(/Preview/);
  usePluginStore.setState({ entries: [converted], collapsed: false });
  await usePluginStore.getState().run();
  expect(useCanvasStore.getState().imports).toHaveLength(0);
  expect(useCanvasStore.getState().undoStack).toHaveLength(0);
  expect(usePluginStore.getState().preview).not.toBeNull();
  const view = render(<PluginPanel />);
  expect(screen.queryByRole("button", { name: "Add artwork" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Apply artwork" })).toBeEnabled();
  view.unmount();
  usePluginStore.getState().applyPreview();
  expect(useCanvasStore.getState().imports).toHaveLength(1);
  expect(useCanvasStore.getState().undoStack).toHaveLength(1);
});
