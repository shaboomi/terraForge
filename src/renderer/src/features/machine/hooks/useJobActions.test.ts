import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJobActions } from "./useJobActions";
import { useCanvasStore } from "../../../store/canvasStore";
import { useMachineStore } from "../../../store/machineStore";
import { useTaskStore } from "../../../store/taskStore";
import { DEFAULT_GCODE_PREFS } from "../../gcode-options/gcodePrefs";
import { createMachineConfig, createSvgImport } from "../../../../../../tests/helpers/factories";
import type { VectorObject } from "../../../../../types";

let generated: VectorObject[][];

beforeEach(() => {
  vi.clearAllMocks();
  generated = [];
  vi.stubGlobal("Worker", class {
    onmessage: ((event: MessageEvent) => void) | null = null;
    terminate = vi.fn();
    postMessage(message: { objects: VectorObject[] }) {
      generated.push(message.objects);
      queueMicrotask(() => this.onmessage?.({ data: { type: "complete", gcode: "; Generated test output" } } as MessageEvent));
    }
  });
  const config = createMachineConfig();
  useMachineStore.setState({ configs: [config], activeConfigId: config.id, connected: false });
  useTaskStore.setState({ tasks: {} });
  useCanvasStore.setState({ imports: ["dark", "medium", "light"].map((id) => createSvgImport({ id, name: id,
    paths: [{ id: `${id}-path`, d: "M0 0L10 10", svgSource: "", visible: true,
      strokeColor: "red", fillColor: "blue", hatchLines: ["M0 1L10 1"] }] })),
    // Deliberately unsorted: exports must use luminance rather than insertion/name order.
    layerGroups: [
      { id: "dark-pen", name: "A dark", color: "#000000", importIds: ["dark"] },
      { id: "light-pen", name: "Z light", color: "#ffffff", importIds: ["light"] },
      { id: "medium-pen", name: "M medium", color: "#808080", importIds: ["medium"] },
    ], selectedImportId: null, selectedGroupId: null, allImportsSelected: false,
    selectedPathId: null, pageTemplate: null, undoStack: [], redoStack: [] });
  window.terraForge.fs.chooseDirectory = vi.fn().mockResolvedValue("/exports");
});

afterEach(() => vi.unstubAllGlobals());

describe("pen export order", () => {
  it("generates and saves per-pen files in lightest-first order", async () => {
    const { result } = renderHook(() => useJobActions());
    await act(async () => result.current.handleGenerateGcode({ ...DEFAULT_GCODE_PREFS,
      exportPerGroup: true, uploadToSd: false, saveLocally: true, optimise: false }));
    expect(generated.map((objects) => objects[0].sourceColor)).toEqual(["#ffffff", "#808080", "#000000"]);
    expect(vi.mocked(window.terraForge.fs.writeFile).mock.calls.map(([path]) => path))
      .toEqual(["/exports/Z_light.gcode", "/exports/M_medium.gcode", "/exports/A_dark.gcode"]);
    expect(generated.every((objects) => objects.every((object) => object.sourceColor === objects[0].sourceColor))).toBe(true);
  });

  it("uses assigned pen colours and lightest-first order for per-colour and hatch files", async () => {
    const { result } = renderHook(() => useJobActions());
    await act(async () => result.current.handleGenerateGcode({ ...DEFAULT_GCODE_PREFS,
      exportPerColor: true, exportPerHatch: true, uploadToSd: false, saveLocally: true, optimise: false }));
    expect(generated.map((objects) => objects[0].sourceColor))
      .toEqual(["#ffffff", "#808080", "#000000", "#ffffff", "#808080", "#000000"]);
    expect(vi.mocked(window.terraForge.fs.writeFile).mock.calls.map(([path]) => path)).toEqual([
      "/exports/color_hex-ffffff.gcode", "/exports/color_hex-808080.gcode", "/exports/color_hex-000000.gcode",
      "/exports/hatch_hex-ffffff.gcode", "/exports/hatch_hex-808080.gcode", "/exports/hatch_hex-000000.gcode",
    ]);
    expect(generated.slice(0, 3).every((objects) => objects.every((object) => !object.id.includes("-h")))).toBe(true);
    expect(generated.slice(3).every((objects) => objects.every((object) => object.id.includes("-h")))).toBe(true);
  });
});
