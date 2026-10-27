import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, renderHook } from "@testing-library/react";
import { ToolpathOverlay, type ToolpathOverlayProps } from "./ToolpathOverlay";
import type { Vp } from "../types";
import { MM_TO_PX, PAD } from "../constants";
import { PageTemplateOverlay } from "./PageTemplateOverlay";
import { usePlotCanvasGeometry } from "../../../components/PlotCanvas/hooks/usePlotCanvasGeometry";

// ── Helpers ──────────────────────────────────────────────────────────────────

const defaultVp: Vp = { zoom: 1, panX: 0, panY: 0 };

function makeProps(
  overrides?: Partial<ToolpathOverlayProps>,
): ToolpathOverlayProps {
  return {
    vp: defaultVp,
    containerSize: { w: 800, h: 600 },
    isCenter: false,
    isBottom: false,
    isRight: false,
    bedW: 220,
    bedH: 200,
    bedXMin: 0,
    bedXMax: 220,
    bedYMin: 0,
    bedYMax: 200,
    canvasH: 200 * 3.7795 + 20 * 2,
    imports: [],
    selectedImportId: null,
    allImportsSelected: false,
    selectedGroupId: null,
    layerGroups: [],
    gcodeToolpath: null,
    toolpathSelected: false,
    toolpathVisible: true,
    toolpathColorized: true,
    toolpathOpacity: 1,
    plotProgressCuts: null,
    plotProgressRapids: null,
    respectSvgColorsOnCanvas: false,
    theme: "dark",
    ...overrides,
  };
}

// Build a minimal canvas 2D context mock.
function makeMockCtx() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
    setLineDash: vi.fn(),
    strokeStyle: "",
    fillStyle: "",
    lineWidth: 1,
  };
}

// Make rAF synchronous and restore afterwards.
function stubRAF() {
  const orig = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    cb(0);
    return 0;
  };
  return () => {
    globalThis.requestAnimationFrame = orig;
  };
}

// Stub getContext to return a mock ctx.
function stubGetContext(mockCtx: ReturnType<typeof makeMockCtx>) {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = vi
    .fn()
    .mockReturnValue(mockCtx) as typeof orig;
  return () => {
    HTMLCanvasElement.prototype.getContext = orig;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ToolpathOverlay", () => {
  it.each(["top-left", "top-right", "bottom-left", "bottom-right", "center"])("aligns page fill and SVG guides at %s origin while zoomed and panned", (origin) => {
    const ctx = makeMockCtx();
    const restoreContext = stubGetContext(ctx);
    const restoreRAF = stubRAF();
    const { result } = renderHook(() => usePlotCanvasGeometry({ bedWidth: 220, bedHeight: 200, origin }));
    const geometry = result.current;
    const pageTemplate = { sizeId: "a5", landscape: false, marginMM: 20, color: "#abc123" };
    const pageSizes = [{ id: "a5", name: "A5", widthMM: 148, heightMM: 210 }];
    const vp = { zoom: 2, panX: 11, panY: -24 };
    try {
      const { container, unmount } = render(<>
        <svg><PageTemplateOverlay pageTemplate={pageTemplate} pageSizes={pageSizes} vp={vp} getBedX={geometry.getBedX} getBedY={geometry.getBedY} /></svg>
        <ToolpathOverlay {...makeProps({ ...geometry, pageTemplate, pageSizes, vp })} />
      </>);
      const boundary = container.querySelector("svg rect")!;
      expect(ctx.fillRect.mock.calls[1]).toEqual(["x", "y", "width", "height"].map((attribute) => Number(boundary.getAttribute(attribute))));
      expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 11, -24);
      unmount();
    } finally {
      restoreContext(); restoreRAF();
    }
  });
  it("paints an opaque page beneath bitmap artwork and updates its colour and orientation", () => {
    const image = { src: "", naturalWidth: 200, naturalHeight: 100, onload: null, onerror: null } as unknown as HTMLImageElement;
    vi.stubGlobal("Image", class { constructor() { return image; } });
    const paintOrder: string[] = [];
    const ctx = { ...makeMockCtx(), drawImage: vi.fn(() => paintOrder.push("bitmap")), strokeRect: vi.fn(), fillText: vi.fn(), globalAlpha: 1 };
    ctx.fillRect = vi.fn(() => { paintOrder.push(ctx.fillStyle); });
    const restoreContext = stubGetContext(ctx);
    const restoreRAF = stubRAF();
    const bitmap = { id: "bitmap", kind: "bitmap" as const, name: "reference", assetId: "image", opacity: 0.7, x: 0, y: 0, scale: 0.2, rotation: 0, visible: true, svgWidth: 200, svgHeight: 100, viewBoxX: 0, viewBoxY: 0 };
    const assets = { image: { id: "image", mimeType: "image/png" as const, data: "cG5n", widthPx: 200, heightPx: 100 } };
    const props = makeProps({
      imports: [bitmap], assets,
      pageTemplate: { sizeId: "a5", landscape: false, marginMM: 20, color: "#abc123" },
      pageSizes: [{ id: "a5", name: "A5", widthMM: 148, heightMM: 210 }],
    });
    try {
      const { rerender, unmount } = render(<ToolpathOverlay {...props} />);
      paintOrder.length = 0;
      act(() => image.onload!.call(image, new Event("load")));
      expect(paintOrder.slice(-2)).toEqual(["#abc123", "bitmap"]);
      expect(ctx.fillRect).toHaveBeenLastCalledWith(PAD, PAD, 148 * MM_TO_PX, 210 * MM_TO_PX);
      rerender(<ToolpathOverlay {...props} pageTemplate={{ ...props.pageTemplate!, landscape: true, color: "#123456" }} />);
      expect(paintOrder.slice(-2)).toEqual(["#123456", "bitmap"]);
      expect(ctx.fillRect).toHaveBeenLastCalledWith(PAD, PAD, 210 * MM_TO_PX, 148 * MM_TO_PX);
      unmount();
    } finally {
      restoreContext(); restoreRAF(); vi.unstubAllGlobals();
    }
  });

  it("defaults older paper templates to opaque white and leaves No page unfilled", () => {
    const ctx = makeMockCtx();
    const restoreContext = stubGetContext(ctx);
    const restoreRAF = stubRAF();
    const props = makeProps({
      pageTemplate: { sizeId: "a5", landscape: false, marginMM: 20 },
      pageSizes: [{ id: "a5", name: "A5", widthMM: 148, heightMM: 210 }],
    });
    try {
      const { rerender, unmount } = render(<ToolpathOverlay {...props} />);
      expect(ctx.fillStyle).toBe("#ffffff");
      expect(ctx.fillRect).toHaveBeenCalledTimes(2);
      ctx.fillRect.mockClear();
      rerender(<ToolpathOverlay {...props} pageTemplate={null} />);
      expect(ctx.fillRect).toHaveBeenCalledTimes(1);
      unmount();
    } finally {
      restoreContext(); restoreRAF();
    }
  });
  it("repaints when a bitmap finishes decoding and releases it when hidden or unmounted", () => {
    const image = { src: "", naturalWidth: 200, naturalHeight: 100, onload: null, onerror: null } as unknown as HTMLImageElement;
    vi.stubGlobal("Image", class { constructor() { return image; } });
    const ctx = { ...makeMockCtx(), drawImage: vi.fn(), strokeRect: vi.fn(), fillText: vi.fn(), globalAlpha: 1 };
    const restoreContext = stubGetContext(ctx);
    const restoreRAF = stubRAF();
    const bitmap = { id: "bitmap", kind: "bitmap" as const, name: "reference", assetId: "image", opacity: 0.7, x: 0, y: 0, scale: 0.2, rotation: 0, visible: true, svgWidth: 200, svgHeight: 100, viewBoxX: 0, viewBoxY: 0 };
    const assets = { image: { id: "image", mimeType: "image/png" as const, data: "cG5n", widthPx: 200, heightPx: 100 } };
    try {
      const { rerender, unmount } = render(<ToolpathOverlay {...makeProps({ imports: [bitmap], assets })} />);
      expect(ctx.drawImage).not.toHaveBeenCalled();
      act(() => image.onload!.call(image, new Event("load")));
      expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0, 200, 100);
      rerender(<ToolpathOverlay {...makeProps({ imports: [{ ...bitmap, visible: false }], assets })} />);
      expect(image.src).toBe("");
      expect(image.onload).toBeNull();
      unmount();
      expect(image.onerror).toBeNull();
    } finally {
      restoreContext(); restoreRAF(); vi.unstubAllGlobals();
    }
  });
  it("renders a canvas element", () => {
    const { container } = render(<ToolpathOverlay {...makeProps()} />);
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("canvas has data-testid toolpath-canvas", () => {
    const { getByTestId } = render(<ToolpathOverlay {...makeProps()} />);
    expect(getByTestId("toolpath-canvas")).toBeTruthy();
  });

  it("canvas has pointer-events none style", () => {
    const { getByTestId } = render(<ToolpathOverlay {...makeProps()} />);
    const canvas = getByTestId("toolpath-canvas") as HTMLCanvasElement;
    expect(canvas.style.pointerEvents).toBe("none");
  });

  it("draw loop fires: clearRect called when container has size", () => {
    const restoreRAF = stubRAF();
    const mockCtx = makeMockCtx();
    const restoreCtx = stubGetContext(mockCtx);

    render(<ToolpathOverlay {...makeProps()} />);
    expect(mockCtx.clearRect).toHaveBeenCalled();

    restoreCtx();
    restoreRAF();
  });

  it("bed background fillRect always called, even without toolpath", () => {
    const restoreRAF = stubRAF();
    const mockCtx = makeMockCtx();
    const restoreCtx = stubGetContext(mockCtx);

    render(<ToolpathOverlay {...makeProps({ gcodeToolpath: null })} />);
    expect(mockCtx.fillRect).toHaveBeenCalled();

    restoreCtx();
    restoreRAF();
  });

  it("draw loop does not fire when containerSize is zero", () => {
    const restoreRAF = stubRAF();
    const mockCtx = makeMockCtx();
    const restoreCtx = stubGetContext(mockCtx);

    render(
      <ToolpathOverlay {...makeProps({ containerSize: { w: 0, h: 0 } })} />,
    );
    // clearRect should not be called because the guard exits early.
    expect(mockCtx.clearRect).not.toHaveBeenCalled();

    restoreCtx();
    restoreRAF();
  });

  it("setTransform receives non-zero values when container is sized", () => {
    const restoreRAF = stubRAF();
    const mockCtx = makeMockCtx();
    const restoreCtx = stubGetContext(mockCtx);

    render(<ToolpathOverlay {...makeProps()} />);
    // setTransform is called for the bed background fill and for imports.
    expect(mockCtx.setTransform).toHaveBeenCalled();

    restoreCtx();
    restoreRAF();
  });

  it("stroke is called when gcodeToolpath has cut paths", () => {
    const restoreRAF = stubRAF();
    const mockCtx = makeMockCtx();
    const restoreCtx = stubGetContext(mockCtx);

    const tp = {
      cutPaths: [new Float32Array([0, 0, 100, 100])],
      rapidPaths: new Float32Array([0, 0, 50, 50]),
      bounds: { minX: 0, maxX: 100, minY: 0, maxY: 100 },
      lineCount: 1,
      fileSizeBytes: 64,
      totalCutDistance: 141,
      totalRapidDistance: 70,
      feedrate: 3000,
    };

    render(<ToolpathOverlay {...makeProps({ gcodeToolpath: tp })} />);
    expect(mockCtx.stroke).toHaveBeenCalled();

    restoreCtx();
    restoreRAF();
  });
});
