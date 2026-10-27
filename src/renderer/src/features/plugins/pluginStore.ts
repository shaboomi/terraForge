import { create } from "zustand";
import { pluginEditor, resolvePluginTarget } from "./pluginEditing";
import { v4 as uuid } from "uuid";
import type { PluginEntry, PluginParameters, SvgImport } from "../../../../types";
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
  loading: boolean;
  saving: string[];
  error: string | null;
  runError: string | null;
  running: { runId: string; pluginId: string } | null;
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

export const usePluginStore = create<PluginState>((set, get) => ({
  entries: [],
  activeFilename: null,
  collapsed: false,
  editingImportId: null,
  parameters: {},
  loading: false,
  saving: [],
  error: null,
  runError: null,
  running: null,

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
      panelGeneration++;
      set({ activeFilename: entry.filename, editingImportId: null, collapsed: false, runError: null });
    }
  },

  editImport: (importId) => {
    const artwork = useCanvasStore.getState().imports.find((item) => item.id === importId);
    const editor = pluginEditor(artwork, get().entries);
    if (!editor.entry || !editor.parameters) {
      set({ runError: editor.error ?? "This artwork's plugin is unavailable." });
      return;
    }
    get().cancel();
    panelGeneration++;
    const manifest = editor.entry.manifest;
    set((state) => ({
      activeFilename: editor.entry.filename,
      editingImportId: importId,
      collapsed: false,
      runError: null,
      parameters: { ...state.parameters, [manifest.id]: editor.parameters },
    }));
  },
  setCollapsed: (collapsed) => set({ collapsed }),
  closePanel: () => {
    get().cancel();
    panelGeneration++;
    set({ activeFilename: null, editingImportId: null, collapsed: false, runError: null });
  },

  setParameter: (pluginId, key, value) => set((state) => ({
    parameters: {
      ...state.parameters,
      [pluginId]: { ...state.parameters[pluginId], [key]: value },
    },
    runError: null,
  })),

  resetParameters: (pluginId) => {
    const manifest = get().entries.find((entry) => entry.manifest?.id === pluginId)?.manifest;
    if (manifest) {
      set((state) => ({
        parameters: { ...state.parameters, [pluginId]: defaultParameters(manifest) },
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
    if (!enabled && get().running?.pluginId === pluginId) get().cancel();
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
    const generation = ++panelGeneration;
    // Invalidate locally before requesting cancellation, including for late replies.
    set({ running: null, runError: "Plugin cancelled. No artwork was added." });
    const task = useTaskStore.getState().tasks[running.runId];
    if (task) useTaskStore.getState().upsertTask({ ...task, status: "cancelled", progress: null });
    void api().cancel(running.runId).catch((error) => {
      if (generation === panelGeneration) set({ runError: `Plugin cancelled locally: ${message(error)}` });
    });
  },

  run: runActivePlugin,
}));

async function runActivePlugin() {
  const get = usePluginStore.getState;
  const set = usePluginStore.setState;
    const state = get();
    const entry = state.entries.find((item) => item.filename === state.activeFilename);
    if (!entry?.manifest || !entry.enabled || entry.error || state.running || !api()) return;
    const manifest = entry.manifest;
    if (manifest.input !== "none") {
      set({ runError: "Bitmap and vector processing will be available in a later stage." });
      return;
    }
    const { target, error: editingError } = resolvePluginTarget(
      state.editingImportId, manifest.id, useCanvasStore.getState().imports, state.entries,
    );
    if (editingError) {
      set({ runError: editingError });
      return;
    }
    const parameters = { ...defaultParameters(manifest), ...state.parameters[manifest.id] };
    const error = (manifest.controls ?? [])
      .map((control) => parameterError(control, parameters[control.key]))
      .find(Boolean);
    if (error) {
      set({ runError: error });
      return;
    }
    panelGeneration++;
    const runId = uuid();
    const canvas = useCanvasStore.getState();
    const machine = useMachineStore.getState().activeConfig();
    const page = generatorPage(canvas, machine);
    let stale = false;
    // Observe edits throughout the run, including edits that are subsequently undone.
    const unsubscribe = useCanvasStore.subscribe((next) => {
      if (next.imports !== canvas.imports || next.layerGroups !== canvas.layerGroups ||
          next.pageTemplate !== canvas.pageTemplate || next.pageSizes !== canvas.pageSizes) stale = true;
    });
    const unsubscribeMachine = useMachineStore.subscribe((next) => {
      if (next.activeConfig() !== machine) stale = true;
    });
    set({ running: { runId, pluginId: manifest.id }, runError: null });
    useTaskStore.getState().registerCancelCallback(runId, () => {
      if (get().running?.runId === runId) get().cancel();
    });
    try {
      const result = await api().run({
        runId, pluginId: manifest.id, input: { kind: "none", page }, parameters,
      });
      if (get().running?.runId !== runId) return;
      if (stale) {
        throw new Error("The document or page changed while this plugin was running. Run it again to add artwork.");
      }
      const current = get().entries.find((item) => item.filename === entry.filename);
      if (!current?.enabled || current.error) {
        throw new Error("The plugin was disabled while running. No artwork was added.");
      }
      const artwork = importPluginResult(result, manifest, parameters, page, machine);
      commitPluginArtwork(artwork, target);
      const warnings = result.warnings?.join(" ");
      useTaskStore.getState().upsertTask({
        id: runId, type: "plugin-run", label: `${manifest.name}: artwork ${target ? "updated" : "added"}`,
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
      unsubscribe();
      unsubscribeMachine();
      useTaskStore.getState().unregisterCancelCallback(runId);
      if (get().running?.runId === runId) set({ running: null });
    }
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
