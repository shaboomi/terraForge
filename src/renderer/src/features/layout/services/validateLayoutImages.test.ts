import { afterEach, describe, expect, it, vi } from "vitest";
import type { CanvasLayout } from "../../../../../types";
import { validateCanvasLayoutImages } from "./validateLayoutImages";
import { useCanvasStore } from "../../../store/canvasStore";

const id = "0".repeat(64);
function layout(): CanvasLayout {
  return { tfVersion: 2, savedAt: "2026-10-27T00:00:00.000Z", imports: [], assets: { [id]: { id, mimeType: "image/png", data: btoa("decoder-test-bytes"), widthPx: 2, heightPx: 3 } } };
}

afterEach(() => vi.unstubAllGlobals());

describe("validateCanvasLayoutImages", () => {
  it("leaves vector-only layouts independent of the image decoder", async () => {
    const decoder = vi.fn(); vi.stubGlobal("createImageBitmap", decoder);
    await validateCanvasLayoutImages({ tfVersion: 2, savedAt: "2026-10-27", imports: [] });
    expect(decoder).not.toHaveBeenCalled();
  });

  it("verifies decoded dimensions and releases each successfully decoded image", async () => {
    const close = vi.fn();
    const decoder = vi.fn().mockResolvedValue({ width: 2, height: 3, close });
    vi.stubGlobal("createImageBitmap", decoder);
    await validateCanvasLayoutImages(layout());
    expect(decoder).toHaveBeenCalledOnce();
    expect(decoder.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects corrupted compressed image data without changing the canvas", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("Invalid IDAT data")));
    const before = useCanvasStore.getState();
    await expect(validateCanvasLayoutImages(layout())).rejects.toThrow(/damaged PNG/);
    expect(useCanvasStore.getState()).toBe(before);
  });

  it("rejects decoded dimension mismatch and closes the image even on failure", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 99, height: 3, close }));
    await expect(validateCanvasLayoutImages(layout())).rejects.toThrow(/dimensions/);
    expect(close).toHaveBeenCalledOnce();
  });

  it("closes earlier images before decoding the next one and propagates later corruption", async () => {
    const value = layout(), nextId = "1".repeat(64);
    value.assets = { ...value.assets, [nextId]: { ...value.assets![id], id: nextId } };
    const close = vi.fn();
    const decoder = vi.fn().mockResolvedValueOnce({ width: 2, height: 3, close }).mockImplementationOnce(() => {
      expect(close).toHaveBeenCalledOnce();
      return Promise.reject(new Error("Invalid image"));
    });
    vi.stubGlobal("createImageBitmap", decoder);
    await expect(validateCanvasLayoutImages(value)).rejects.toThrow(/damaged PNG/);
    expect(decoder).toHaveBeenCalledTimes(2);
  });
});