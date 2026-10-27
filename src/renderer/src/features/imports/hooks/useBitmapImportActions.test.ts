import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useBitmapImportActions } from "./useBitmapImportActions";
import { normaliseBitmapAsset } from "../services/bitmapImport";
import { useTaskStore } from "../../../store/taskStore";
import { useCanvasStore } from "../../../store/canvasStore";
import type { BitmapAsset } from "../../../../../types";

vi.mock("../services/bitmapImport", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/bitmapImport")>(),
  normaliseBitmapAsset: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(normaliseBitmapAsset).mockReset();
  window.terraForge.fs.readBitmapFile = vi.fn().mockResolvedValue(new Uint8Array([1]));
  for (const id of Object.keys(useTaskStore.getState().tasks)) useTaskStore.getState().removeTask(id);
});
afterEach(() => cleanup());

function deferredDecode() {
  let reject!: (error: Error) => void;
  const promise = new Promise<BitmapAsset>((_resolve, failure) => { reject = failure; });
  vi.mocked(normaliseBitmapAsset).mockReturnValue(promise);
  return { reject };
}

describe("bitmap import cancellation", () => {
  it("does not resurrect a dismissed cancellation toast after late decode failure", async () => {
    const decode = deferredDecode();
    const items = useCanvasStore.getState().imports;
    const { result } = renderHook(() => useBitmapImportActions());
    const running = result.current("test.png");
    await waitFor(() => expect(normaliseBitmapAsset).toHaveBeenCalledOnce());
    const id = Object.keys(useTaskStore.getState().tasks)[0];
    useTaskStore.getState().cancelTask(id);
    expect(useTaskStore.getState().tasks[id].status).toBe("cancelled");
    useTaskStore.getState().removeTask(id);
    decode.reject(new Error("Late decoder failure"));
    await running;
    expect(useTaskStore.getState().tasks[id]).toBeUndefined();
    expect(useCanvasStore.getState().imports).toBe(items);
  });

  it("marks a still-running task cancelled when its import owner unmounts", async () => {
    const decode = deferredDecode();
    const { result, unmount } = renderHook(() => useBitmapImportActions());
    const running = result.current("test.png");
    await waitFor(() => expect(normaliseBitmapAsset).toHaveBeenCalledOnce());
    const id = Object.keys(useTaskStore.getState().tasks)[0];
    unmount();
    decode.reject(new Error("Late decoder failure"));
    await running;
    expect(useTaskStore.getState().tasks[id].status).toBe("cancelled");
  });
});
