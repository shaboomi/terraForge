import { suggestedPluginPen } from "./pluginPens";
import { create } from "zustand";
import { pluginEditor, resolvePluginTarget } from "./pluginEditing";
import { v4 as uuid } from "uuid";
import { isVectorImport, type CanvasItem, type PluginEntry, type PluginInput, type PluginParameters, type PluginRunRequest, type PluginDetailBudget, type SvgImport } from "../../../../types";
import { validatePluginResult } from "../../../../types/pluginValidation";
import { normalizeSvgColor } from "../imports/services/svgImportHelpers";
import { buildPluginInput, preparePluginArtwork, selectedPluginSource } from "./pluginProcessing";
import { useCanvasStore } from "../../store/canvasStore";
import { useMachineStore } from "../../store/machineStore";
import { useTaskStore } from "../../store/taskStore";
import {
  defaultParameters,
  generatorPage,
  importPluginResult,
  parameterError,
} from "./pluginHelpers";

interface PluginState {
  entries: PluginEntry[];
  activeFilename: string | null;
  collapsed: boolean;
  editingImportId: string | null;
  editImport: (importId: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  closePanel: () => void;
  parameters: Record<string, PluginParameters>;
  detailBudgets: Record<string, PluginDetailBudget>;
  setDetailBudget: (pluginId: string, value: PluginDetailBudget) => void;
  loading: boolean;
  saving: string[];
  error: string | null;
  runError: string | null;
  running: { runId: string; pluginId: string } | null;
  preview: (Awaited<ReturnType<typeof preparePluginArtwork>> & { replaceIds?: string[] }) | null;
  previewRun: () => Promise<void>;
  applyPreview: () => void;
  discardPreview: () => void;
  refresh: () => Promise<void>;
  select: (entry: PluginEntry) => void;
  setParameter: (pluginId: string, key: string, value: string | number | boolean) => void;
  resetParameters: (pluginId: string) => void;
  setEnabled: (entry: PluginEntry, enabled: boolean) => Promise<void>;
  installExample: () => Promise<void>;
  openFolder: () => Promise<void>;
  run: () => Promise<void>;
  cancel: () => void;
}

// The guard also keeps older development/test preload mocks compatible.
function api() {
  return window.terraForge?.plugins;
}
function message(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/^Error:\s*/, "")
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/, "")
    .replace(/^(?:Error:\s*)+/, "")
    .slice(0, 2000);
}

let panelGeneration = 0;
let pendingAbort: AbortController | undefined;
let releasePreview: (() => void) | undefined;
let applyPrepared: (() => void) | undefined;

function clearPreview() {
  releasePreview?.();
  releasePreview = undefined;
  applyPrepared = undefined;
  usePluginStore.setState({ preview: null });
}

export const usePluginStore = create<PluginState>((set, get) => ({
  entries: [],
  activeFilename: null,
  collapsed: false,
  editingImportId: null,
  parameters: {},
  detailBudgets: {},
  setDetailBudget: (pluginId, value) => {
    if (value !== "standard" && value !== "extended") return;
    get().cancel(); clearPreview(); panelGeneration++;
    set(state => ({ detailBudgets: { ...state.detailBudgets, [pluginId]: value }, runError: null }));
  },
  loading: false,
  saving: [],
  error: null,
  runError: null,
  running: null,
  preview: null,
  previewRun: () => runActivePlugin(true),
  applyPreview: () => {
    const apply = applyPrepared;
    if (!get().preview || !apply) return;
    try { apply(); } catch (error) { clearPreview(); set({ runError: message(error) }); }
  },
  discardPreview: () => { clearPreview(); set({ runError: null }); },

  refresh: async () => {
    if (!api()) return;
    set({ loading: true, error: null });
    try {
      const entries = await api().list();
      set((state) => ({
        entries: entries.map((entry) => state.saving.includes(entry.manifest?.id ?? "") ? { ...entry, enabled: state.entries.find((current) => current.filename === entry.filename)?.enabled ?? entry.enabled } : entry),
        parameters: Object.fromEntries(entries.flatMap((entry) =>
          entry.manifest
            ? [[entry.manifest.id, state.parameters[entry.manifest.id] ?? defaultParameters(entry.manifest)]]
            : [],
        )),
      }));
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ loading: false });
    }
  },

  select: (entry) => {
    if (entry.manifest && entry.enabled && !entry.error) {
      get().cancel();
      clearPreview();
      panelGeneration++;
      set({ activeFilename: entry.filename, editingImportId: null, collapsed: false, runError: null });
    }
  },

  editImport: (importId) => {
    const artwork = useCanvasStore.getState().imports.find((item) => item.id === importId);
    const editor = pluginEditor(artwork, get().entries, useCanvasStore.getState().imports);
    if (!editor.entry || !editor.parameters) {
      set({ runError: editor.error ?? "This artwork's plugin is unavailable." });
      return;
    }
    get().cancel();
    clearPreview();
    panelGeneration++;
    const manifest = editor.entry.manifest;
    set((state) => ({
      activeFilename: editor.entry.filename,
      editingImportId: importId,
      collapsed: false,
      runError: null,
      parameters: { ...state.parameters, [manifest.id]: editor.parameters },
      detailBudgets: { ...state.detailBudgets, [manifest.id]: artwork?.pluginSource?.detailBudget ?? "standard" },
    }));
  },
  setCollapsed: (collapsed) => set({ collapsed }),
  closePanel: () => {
    get().cancel();
    clearPreview();
    panelGeneration++;
    set({ activeFilename: null, editingImportId: null, collapsed: false, runError: null });
  },

  setParameter: (pluginId, key, value) => {
    get().cancel();
    clearPreview();
    panelGeneration++;
    set((state) => ({
    parameters: {
      ...state.parameters,
      [pluginId]: { ...state.parameters[pluginId], [key]: value },
    },
    runError: null,
    }));
  },

  resetParameters: (pluginId) => {
    const manifest = get().entries.find((entry) => entry.manifest?.id === pluginId)?.manifest;
    if (manifest) {
      get().cancel();
      clearPreview();
      panelGeneration++;
      set((state) => ({
        parameters: { ...state.parameters, [pluginId]: defaultParameters(manifest) },
        detailBudgets: { ...state.detailBudgets, [pluginId]: "standard" },
        runError: null,
      }));
    }
  },

  setEnabled: async (entry, enabled) => {
    if (!entry.manifest || !api()) return;
    const pluginId = entry.manifest.id;
    if (get().saving.includes(pluginId)) return;
    const previous = get().entries.find((item) => item.filename === entry.filename)?.enabled ?? entry.enabled;
    // Update a controlled checkbox during the user event, before persistence yields.
    set((state) => ({
      saving: [...state.saving, pluginId],
      error: null,
      entries: state.entries.map((item) =>
        item.filename === entry.filename ? { ...item, enabled } : item,
      ),
    }));
    if (!enabled && (get().running?.pluginId === pluginId || get().activeFilename === entry.filename)) {
      get().cancel();
      clearPreview();
    }
    try {
      await api().setEnabled(pluginId, enabled);
      await get().refresh();
    } catch (error) {
      set((state) => ({
        error: message(error),
        entries: state.entries.map((item) =>
          item.filename === entry.filename && item.manifest?.id === pluginId
            ? { ...item, enabled: previous }
            : item,
        ),
      }));
    } finally {
      set((state) => ({ saving: state.saving.filter((id) => id !== pluginId) }));
    }
  },
  installExample: async () => {
    if (!api()) return;
    try {
      const before = new Set(get().entries.map((entry) => entry.filename));
      await api().installExample();
      await get().refresh();
      const candidates = get().entries.filter((entry) =>
        entry.manifest?.input === "none" && entry.enabled && !entry.error,
      );
      const example = candidates.find((entry) => !before.has(entry.filename)) ?? candidates[0];
      if (example) {
        get().select(example);
        window.dispatchEvent(new Event("terraforge:show-properties"));
      }
    } catch (error) {
      set({ error: message(error) });
    }
  },

  openFolder: async () => {
    try {
      await api()?.openFolder();
    } catch (error) {
      set({ error: message(error) });
    }
  },

  cancel: () => {
    const running = get().running;
    if (!running) return;
    pendingAbort?.abort();
    pendingAbort = undefined;
    const generation = ++panelGeneration;
    // Invalidate locally before requesting cancellation, including for late replies.
    set({ running: null, runError: "Plugin cancelled. No artwork was added." });
    const task = useTaskStore.getState().tasks[running.runId];
    if (task) useTaskStore.getState().upsertTask({ ...task, status: "cancelled", progress: null });
    void api().cancel(running.runId).catch((error) => {
      if (generation === panelGeneration) set({ runError: `Plugin cancelled locally: ${message(error)}` });
    });
  },

  run: () => runActivePlugin(false),
}));

async function runActivePlugin(previewOnly: boolean) {
  const get = usePluginStore.getState;
  const set = usePluginStore.setState;
    const state = get();
    const entry = state.entries.find((item) => item.filename === state.activeFilename);
    if (!entry?.manifest || !entry.enabled || entry.error || state.running || !api()) return;
    const manifest = entry.manifest;
    const { target, error: editingError } = resolvePluginTarget(
      state.editingImportId, manifest.id, useCanvasStore.getState().imports, state.entries,
    );
    if (editingError) {
      set({ runError: editingError });
      return;
    }
    const parameters = { ...defaultParameters(manifest), ...state.parameters[manifest.id] };
    const detailBudget = state.detailBudgets[manifest.id] ?? "standard";
    const error = (manifest.controls ?? [])
      .map((control) => parameterError(control, parameters[control.key]))
      .find(Boolean);
    if (error) {
      set({ runError: error });
      return;
    }
    clearPreview();
    const generation = ++panelGeneration;
    const runId = uuid();
    const canvas = useCanvasStore.getState();
    const machine = useMachineStore.getState().activeConfig();
    const page = generatorPage(canvas, machine);
    const abort = new AbortController();
    pendingAbort = abort;
    let source: CanvasItem | undefined;
    try { source = selectedPluginSource(manifest, canvas, state.editingImportId); }
    catch (error) { pendingAbort = undefined; set({ runError: message(error) }); return; }
    let stale = false;
    const invalidate = () => {
      stale = true;
      if (get().running?.runId === runId) {
        get().cancel();
        set({ runError: "The document or page changed while this plugin was running. Preview or run it again." });
      }
      if (get().preview) {
        clearPreview();
        set({ runError: "The document or page changed. Preview again before applying artwork." });
      }
    };
    // Observe edits throughout the run, including edits that are subsequently undone.
    const unsubscribe = useCanvasStore.subscribe((next) => {
      if (next.imports !== canvas.imports || next.layerGroups !== canvas.layerGroups ||
          next.pageTemplate !== canvas.pageTemplate || next.pageSizes !== canvas.pageSizes ||
          next.assets !== canvas.assets || next.activePenId !== canvas.activePenId ||
          next.selectedImportId !== canvas.selectedImportId || next.selectedPathId !== canvas.selectedPathId ||
          next.selectedGroupId !== canvas.selectedGroupId || next.allImportsSelected !== canvas.allImportsSelected ||
          next.toolpathSelected !== canvas.toolpathSelected) invalidate();
    });
    const unsubscribeMachine = useMachineStore.subscribe((next) => {
      if (next.activeConfig() !== machine) invalidate();
    });
    const unsubscribePlugins = usePluginStore.subscribe((next) => {
      const current = next.entries.find((item) => item.filename === entry.filename);
      if (!current?.enabled || current.error || current.manifest?.version !== manifest.version ||
          next.activeFilename !== entry.filename || next.parameters[manifest.id] !== state.parameters[manifest.id] ||
          next.detailBudgets[manifest.id] !== state.detailBudgets[manifest.id]) invalidate();
    });
    let retainedPreview = false;
    const release = () => { unsubscribe(); unsubscribeMachine(); unsubscribePlugins(); };
    const assertCurrent = () => {
      if (stale || generation !== panelGeneration || abort.signal.aborted) {
        throw new Error("The document or page changed while this plugin was running. Preview or run it again to add artwork.");
      }
      const current = get().entries.find((item) => item.filename === entry.filename);
      if (!current?.enabled || current.error || current.manifest?.version !== manifest.version) {
        throw new Error("The plugin changed or was disabled. No artwork was added.");
      }
    };
    set({ running: { runId, pluginId: manifest.id }, runError: null });
    useTaskStore.getState().registerCancelCallback(runId, () => {
      if (get().running?.runId === runId) get().cancel();
    });
    try {
      const palette = canvas.layerGroups.map(({ id, name, color }) => ({ id, name: name.slice(0, 120), color: normalizeSvgColor(color) }));
      for (const control of manifest.controls ?? []) {
        if (control.type !== "pen") continue;
        const selected = suggestedPluginPen(control, String(parameters[control.key]), palette);
        if (!selected || !palette.some(pen => pen.id === selected)) throw new Error(`Choose an available ${control.label} from your configured pens.`);
        parameters[control.key] = selected;
      }
      const input: PluginInput = manifest.input === "none"
        ? { kind: "none", page, ...(palette.length ? { palette } : {}) }
        : await buildPluginInput(manifest, canvas, page, source, abort.signal, detailBudget);
      assertCurrent();
      const seed = target?.pluginSource?.seed ?? 1;
      const request: PluginRunRequest = { runId, pluginId: manifest.id, input, parameters, seed, ...(detailBudget === "extended" ? { detailBudget } : {}) };
      const returned = await api().run(request);
      if (get().running?.runId !== runId) return;
      assertCurrent();
      const result = validatePluginResult(returned, request, manifest);
      const legacy = manifest.input === "none" && "paths" in result &&
        !result.paths.some((path) => path.penId) && (!target || !target.pluginSource?.outputGroupId);
      let commit: () => void;
      if (legacy && !previewOnly) {
        const artwork = importPluginResult(result, manifest, parameters, page, machine);
        artwork.pluginSource = { ...artwork.pluginSource!, apiVersion: 1, seed, ...(detailBudget === "extended" ? { detailBudget } : {}) };
        commit = () => commitPluginArtwork(artwork, target && isVectorImport(target) ? target : undefined);
      } else {
        const prepared = await preparePluginArtwork(result, manifest, parameters, page, machine, source, seed, {
          groupId: target?.pluginSource?.outputGroupId,
          groupName: target?.pluginSource?.outputGroupName,
          palette: input.palette,
          detailBudget,
        });
        assertCurrent();
        if (get().running?.runId !== runId) return;
        const revision = prepared.items[0]?.pluginSource?.sourceRevision;
        const previous = target?.pluginSource?.outputGroupId
          ? canvas.imports.filter((item) => item.id !== source?.id &&
            item.pluginSource?.outputGroupId === target.pluginSource!.outputGroupId &&
            item.pluginSource?.pluginId === manifest.id && item.pluginSource?.pluginVersion === manifest.version &&
            item.pluginSource?.sourceId === target.pluginSource?.sourceId)
          : target && target.id !== source?.id ? [target] : [];
        remapUpdatedItems(prepared, previous, canvas.layerGroups, revision);
        if (legacy && canvas.activePenId) {
          for (const item of prepared.items) if (isVectorImport(item)) prepared.penAssignments[item.id] = canvas.activePenId;
        }
        commit = () => {
          assertCurrent();
          if (!useCanvasStore.getState().commitPluginResult({
            items: prepared.items, assets: prepared.assets,
            replaceIds: previous.map((item) => item.id), penAssignments: prepared.penAssignments,
          })) throw new Error("The artwork changed or was removed. Preview again before applying.");
        };
        if (previewOnly || manifest.input !== "none") {
          retainedPreview = true;
          releasePreview = release;
          applyPrepared = () => {
            assertCurrent();
            clearPreview();
            commit();
            useTaskStore.getState().upsertTask({
              id: runId, type: "plugin-run", label: `${manifest.name}: artwork ${target ? "updated" : "added"}`,
              progress: 100, status: result.warnings?.length ? "warning" : "completed", error: result.warnings?.join(" "),
            });
          };
          set({ preview: { ...prepared, replaceIds: previous.map((item) => item.id) } });
        }
      }
      assertCurrent();
      if (!retainedPreview) { release(); commit!(); }
      const warnings = result.warnings?.join(" ");
      useTaskStore.getState().upsertTask({
        id: runId, type: "plugin-run", label: `${manifest.name}: ${retainedPreview ? "preview ready" : `artwork ${target ? "updated" : "added"}`}`,
        progress: 100, status: warnings ? "warning" : "completed", error: warnings,
      });
    } catch (error) {
      if (get().running?.runId !== runId) return;
      const detail = message(error);
      set({ runError: detail });
      useTaskStore.getState().upsertTask({
        id: runId, type: "plugin-run", label: `${manifest.name}: no artwork added`,
        progress: null, status: "error", error: detail,
      });
    } finally {
      if (!retainedPreview) release();
      if (pendingAbort === abort) pendingAbort = undefined;
      useTaskStore.getState().unregisterCancelCallback(runId);
      if (get().running?.runId === runId) set({ running: null });
    }
}

function remapUpdatedItems(
  prepared: Awaited<ReturnType<typeof preparePluginArtwork>>, previous: CanvasItem[],
  pens: ReturnType<typeof useCanvasStore.getState>["layerGroups"], revision?: string,
) {
  prepared.items = prepared.items.map((item) => {
    const assignment = prepared.penAssignments[item.id];
    const old = previous.find((candidate) => {
      if (isVectorImport(candidate) !== isVectorImport(item)) return false;
      if (item.pluginSource?.outputKey && candidate.pluginSource?.outputKey) return candidate.pluginSource.outputKey === item.pluginSource.outputKey;
      return candidate.pluginSource?.outputIndex === item.pluginSource?.outputIndex &&
        pens.find((pen) => pen.importIds.includes(candidate.id))?.id === assignment;
    });
    if (!old) return item;
    delete prepared.penAssignments[item.id];
    if (assignment) prepared.penAssignments[old.id] = assignment;
    const preservePlacement = !revision || old.pluginSource?.sourceRevision === revision;
    return { ...item, id: old.id, name: old.name, visible: old.visible,
      ...(preservePlacement ? {
        x: old.x, y: old.y, rotation: old.rotation, scale: old.scale,
        scaleX: (old.scaleX ?? old.scale) * (isVectorImport(item) ? 1 : old.svgWidth / item.svgWidth *
          (item.pluginSource?.outputWidth ?? 1) / (old.pluginSource?.outputWidth ?? 1)),
        scaleY: (old.scaleY ?? old.scale) * (isVectorImport(item) ? 1 : old.svgHeight / item.svgHeight *
          (item.pluginSource?.outputHeight ?? 1) / (old.pluginSource?.outputHeight ?? 1)),
      } : {}),
    };
  });
}

function commitPluginArtwork(artwork: SvgImport, target?: SvgImport): void {
  const canvas = useCanvasStore.getState();
  if (!target) {
    canvas.addImport(artwork);
    canvas.selectImport(artwork.id);
    return;
  }
  const replacement = {
    ...target,
    paths: artwork.paths,
    svgWidth: artwork.svgWidth,
    svgHeight: artwork.svgHeight,
    viewBoxX: artwork.viewBoxX,
    viewBoxY: artwork.viewBoxY,
    layers: artwork.layers,
    pluginSource: artwork.pluginSource,
  };
  if (!canvas.replaceImport(target.id, replacement)) {
    throw new Error("The artwork was removed. No changes were made.");
  }
  canvas.selectImport(target.id);
}
