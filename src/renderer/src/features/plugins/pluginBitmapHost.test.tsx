import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { fireEvent, render, screen } from "@testing-library/react";
import type { BitmapImport, PluginEntry, PluginManifest } from "../../../../types";
import { DEFAULT_BITMAP_PREPARATION } from "../../../../types/pluginBitmapPreparation";
import { parseCanvasLayout, serializeCanvasLayout } from "../../../../types/layoutValidation";
import { validatePluginManifest, validatePluginRunRequest } from "../../../../types/pluginValidation";
import { useCanvasStore } from "../../store/canvasStore";
import { useMachineStore } from "../../store/machineStore";
import { buildPluginInput, clearPluginBitmapCaches } from "./pluginProcessing";
import { usePluginStore } from "./pluginStore";
import { PluginPanel } from "./PluginPanel";

const manifest: PluginManifest = { id: "test.preparation", name: "Prepared", version: "1.0.0", apiVersion: 1,
  description: "Prepared tones", category: "bitmap-processor", input: "bitmap", outputs: ["vector"], bitmapPreparation: true };
const entry: PluginEntry = { filename: "prepared.tf-plugin.js", manifest, enabled: true, sourceFingerprint: "a".repeat(64) };
const source: BitmapImport = { id: "source", name: "Image", kind: "bitmap", assetId: "pixels", svgWidth: 2, svgHeight: 1,
  viewBoxX: 0, viewBoxY: 0, x: 10, y: 13, scale: 1, scaleX: 3, scaleY: 5, rotation: 31, opacity: 1, visible: true };
const pixels = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
const decode = vi.fn();
const run = vi.fn();
const page = { widthMM: 220, heightMM: 200 };

beforeEach(() => {
  usePluginStore.getState().closePanel(); clearPluginBitmapCaches();
  vi.stubGlobal("crypto", webcrypto);
  decode.mockReset().mockImplementation(async () => ({ width: 2, height: 1, close: vi.fn() }));
  vi.stubGlobal("createImageBitmap", decode);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: vi.fn(), getImageData: () => ({ data: pixels }) } as unknown as CanvasRenderingContext2D);
  run.mockReset().mockResolvedValue({ width: 2, height: 1, paths: [{ points: [{ x: 0, y: 0 }, { x: 2, y: 1 }] }] });
  window.terraForge.plugins = { list: vi.fn(), rescan: vi.fn().mockResolvedValue([entry]), run, cancel: vi.fn().mockResolvedValue(undefined),
    openFolder: vi.fn(), installExample: vi.fn(), setEnabled: vi.fn() };
  useMachineStore.setState({ configs: [], activeConfigId: null });
  useCanvasStore.setState({ imports: [source], assets: { pixels: { id: "pixels", mimeType: "image/png", data: "AA==", widthPx: 2, heightPx: 1 } },
    layerGroups: [], activePenId: null, selectedImportId: source.id, selectedPathId: null, selectedGroupId: null, allImportsSelected: false,
    pageTemplate: null, undoStack: [], redoStack: [] });
  usePluginStore.setState({ entries: [entry], activeFilename: entry.filename, editingImportId: null, parameters: { [manifest.id]: {} },
    bitmapPreparation: {}, detailBudgets: {}, loading: false, saving: [], running: null, preview: null, runError: null, collapsed: false });
});
afterEach(() => { usePluginStore.getState().closePanel(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("validates explicit bitmap-only capability and preserves unchanged legacy inputs", async () => {
  expect(validatePluginManifest(manifest).bitmapPreparation).toBe(true);
  for (const patch of [{ bitmapPreparation: false }, { bitmapPreparation: "true" }, { input: "none" }]) expect(() => validatePluginManifest({ ...manifest, ...patch })).toThrow(/opt-in/);
  const legacy = { ...manifest }; delete legacy.bitmapPreparation;
  const input = await buildPluginInput(legacy, useCanvasStore.getState(), page, source);
  expect(input.kind).toBe("bitmap");
  if (input.kind !== "bitmap") return;
  expect(input.prepared).toBeUndefined(); expect(Array.from(input.data)).toEqual(Array.from(pixels));
});

it("caches decoded images by encoded content/dimensions, returns private arrays and invalidates changed bytes with a reused ID", async () => {
  const first = await buildPluginInput(manifest, useCanvasStore.getState(), page, source);
  if (first.kind !== "bitmap") throw new Error("Expected pixels");
  expect(first.prepared?.tones).toEqual(new Uint8Array([0, 255]));
  first.data.fill(123); first.prepared!.tones.fill(123);
  const second = await buildPluginInput(manifest, useCanvasStore.getState(), page, source);
  expect(decode).toHaveBeenCalledOnce();
  if (second.kind !== "bitmap") throw new Error("Expected pixels");
  expect(second.data).toEqual(new Uint8Array(pixels)); expect(second.prepared?.tones).toEqual(new Uint8Array([0, 255]));
  useCanvasStore.setState({ assets: { pixels: { ...useCanvasStore.getState().assets.pixels, data: "AQ==" } } });
  await buildPluginInput(manifest, useCanvasStore.getState(), page, source);
  expect(decode).toHaveBeenCalledTimes(2);
  await usePluginStore.getState().rescan();
  await buildPluginInput(manifest, useCanvasStore.getState(), page, source);
  expect(decode).toHaveBeenCalledTimes(3);
});

it("previews separately, saves preparation and seed with full-frame alignment, restores editing settings and updates atomically", async () => {
  const settings = { ...DEFAULT_BITMAP_PREPARATION, contrast: 1.2, separation: "cmyk" as const, palette: [] };
  usePluginStore.getState().setBitmapPreparation(manifest.id, settings);
  await usePluginStore.getState().previewRun();
  expect(usePluginStore.getState().runError).toBeNull();
  const request = validatePluginRunRequest(run.mock.calls[0][0]);
  expect(request.input.kind === "bitmap" && request.input.prepared?.channels).toHaveLength(4);
  expect(useCanvasStore.getState().imports).toEqual([source]); expect(useCanvasStore.getState().undoStack).toHaveLength(0);
  usePluginStore.getState().applyPreview();
  const result = useCanvasStore.getState().imports[1];
  expect(result).toMatchObject({ x: 10, y: 13, scaleX: 3, scaleY: 5, rotation: 31, svgWidth: 2, svgHeight: 1,
    pluginSource: { bitmapPreparation: settings, seed: 1, sourceId: source.id, sourceFingerprint: entry.sourceFingerprint } });
  // The source's fake encoded fixture is not a real PNG; verify portable provenance on the vector alone.
  const saved = serializeCanvasLayout({ tfVersion: 2, savedAt: new Date().toISOString(), imports: [result], assets: {}, layerGroups: [], pageTemplate: null });
  expect(parseCanvasLayout(saved).imports[0].pluginSource?.bitmapPreparation).toEqual(settings);
  usePluginStore.getState().setBitmapPreparation(manifest.id, { ...settings, contrast: 0.5 });
  usePluginStore.getState().editImport(result.id);
  expect(usePluginStore.getState().bitmapPreparation[manifest.id]).toEqual(settings);
  await usePluginStore.getState().previewRun(); usePluginStore.getState().applyPreview();
  expect(useCanvasStore.getState().imports[1].id).toBe(result.id);
  expect(useCanvasStore.getState().imports).toHaveLength(2);
  useCanvasStore.getState().undo(); expect(useCanvasStore.getState().imports[1]).toEqual(result);
});

it("changing preparation invalidates ready previews and pending work without applying stale results", async () => {
  await usePluginStore.getState().previewRun();
  expect(usePluginStore.getState().preview).not.toBeNull();
  usePluginStore.getState().setBitmapPreparation(manifest.id, { ...DEFAULT_BITMAP_PREPARATION, palette: [], gamma: 1.2 });
  expect(usePluginStore.getState().preview).toBeNull();
  usePluginStore.getState().applyPreview(); expect(useCanvasStore.getState().imports).toHaveLength(1);
  let finish!: (value: unknown) => void;
  run.mockReturnValue(new Promise(resolve => { finish = resolve; }));
  const running = usePluginStore.getState().previewRun();
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
  usePluginStore.getState().setBitmapPreparation(manifest.id, { ...DEFAULT_BITMAP_PREPARATION, palette: [], gamma: 2 });
  finish({ width: 2, height: 1, paths: [{ points: [{ x: 0, y: 0 }, { x: 2, y: 1 }] }] }); await running;
  expect(usePluginStore.getState().preview).toBeNull(); expect(useCanvasStore.getState().undoStack).toHaveLength(0);
});

it("offers host presets only to capable plugins and rejects invalid palette settings before execution", async () => {
  const view = render(<PluginPanel />);
  fireEvent.click(screen.getByRole("button", { name: "More contrast" }));
  expect(screen.getByLabelText("Preparation Contrast")).toHaveValue(1.25);
  fireEvent.change(screen.getByLabelText("Preparation colour separation"), { target: { value: "palette" } });
  fireEvent.change(screen.getByLabelText("Preparation palette colours"), { target: { value: "invalid" } });
  fireEvent.click(screen.getByRole("button", { name: "Preview", exact: true }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/palette/); expect(run).not.toHaveBeenCalled();
  view.unmount();
  usePluginStore.setState({ entries: [{ ...entry, manifest: { ...manifest, bitmapPreparation: undefined } }] });
  const legacyView = render(<PluginPanel />); expect(screen.queryByText("Shared bitmap preparation")).not.toBeInTheDocument();
  legacyView.unmount();
});
