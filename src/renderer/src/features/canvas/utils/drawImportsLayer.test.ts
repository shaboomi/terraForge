import { describe, expect, it, vi } from "vitest";
import { drawImportsLayer } from "./toolpathOverlayDraw";
import type { SvgImport } from "../../../../../types";

function makeMockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    setTransform: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setLineDash: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
    lineWidth: 1,
  };
}

function makeBaseImport(overrides?: Partial<SvgImport>): SvgImport {
  return {
    id: "imp-1",
    name: "imp",
    paths: [],
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    visible: true,
    svgWidth: 10,
    svgHeight: 10,
    viewBoxX: 0,
    viewBoxY: 0,
    ...overrides,
  };
}

describe("drawImportsLayer", () => {
  it("skips a bitmap import's paths entirely, even when colour separation populated them", () => {
    const ctx = makeMockCtx();
    const bitmapImport = makeBaseImport({
      kind: "bitmap",
      paths: [
        { id: "ink-0", d: "M0 0 L1 1", svgSource: "", visible: true, strokeColor: "#00ffff" },
        { id: "ink-1", d: "M2 2 L3 3", svgSource: "", visible: true, strokeColor: "#ff00ff" },
      ],
    });

    drawImportsLayer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      dpr: 1,
      vp: { zoom: 1, panX: 0, panY: 0 },
      imports: [bitmapImport],
      layerGroups: [],
      selectedImportId: null,
      allImportsSelected: false,
      selectedGroupId: null,
      isBottom: true,
      canvasH: 1000,
      respectSvgColorsOnCanvas: true,
      cache: new Map(),
    });

    expect(ctx.stroke).not.toHaveBeenCalled();
  });

  it("still draws a regular (non-bitmap) SVG import's paths", () => {
    const ctx = makeMockCtx();
    const svgImport = makeBaseImport({
      paths: [{ id: "p1", d: "M0 0 L1 1", svgSource: "", visible: true, strokeColor: "#123456" }],
    });

    drawImportsLayer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      dpr: 1,
      vp: { zoom: 1, panX: 0, panY: 0 },
      imports: [svgImport],
      layerGroups: [],
      selectedImportId: null,
      allImportsSelected: false,
      selectedGroupId: null,
      isBottom: true,
      canvasH: 1000,
      respectSvgColorsOnCanvas: true,
      cache: new Map(),
    });

    expect(ctx.stroke).toHaveBeenCalled();
  });

  describe("on a page", () => {
    const page = { paper: "#f3ecd8", pen: "#202020", rect: { x: 10, y: 20, w: 300, h: 200 } };
    const draw = (imports: SvgImport[], options: { selected?: string | null; respect?: boolean } = {}) => {
      const ctx = { ...makeMockCtx(), fillRect: vi.fn(), fillStyle: "", strokes: [] as [string, number][] };
      ctx.stroke.mockImplementation(() => ctx.strokes.push([ctx.strokeStyle, ctx.lineWidth]));
      drawImportsLayer({
        ctx: ctx as unknown as CanvasRenderingContext2D,
        dpr: 1,
        vp: { zoom: 1, panX: 0, panY: 0 },
        imports,
        layerGroups: [],
        selectedImportId: options.selected ?? null,
        allImportsSelected: false,
        selectedGroupId: null,
        isBottom: true,
        canvasH: 1000,
        respectSvgColorsOnCanvas: options.respect ?? false,
        cache: new Map(),
        page,
      });
      return ctx;
    };

    it("fills the page with its paper colour beneath the imports", () => {
      const ctx = draw([makeBaseImport({ paths: [{ id: "p", d: "M0 0 L1 1", svgSource: "", visible: true }] })]);
      expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 300, 200);
      expect(ctx.fillStyle).toBe("#f3ecd8");
      expect(ctx.fillRect.mock.invocationCallOrder[0]).toBeLessThan(ctx.stroke.mock.invocationCallOrder[0]);
    });

    it("draws paths in the page's pen, shaded when selected", () => {
      const imp = makeBaseImport({ paths: [{ id: "p", d: "M0 0 L1 1", svgSource: "", visible: true }] });
      expect(draw([imp]).strokes[0][0]).toBe("#202020");
      const selected = draw([imp], { selected: imp.id }).strokes[0][0];
      expect(selected).not.toBe("#202020");
      expect(parseInt(selected.slice(1, 3), 16)).toBeGreaterThan(0x20); // lighter, for a dark pen
    });

    it("keeps a path's own colour when SVG colours are respected", () => {
      const imp = makeBaseImport({ paths: [{ id: "p", d: "M0 0 L1 1", svgSource: "", visible: true, strokeColor: "#123456" }] });
      expect(draw([imp], { respect: true }).strokes[0][0]).toBe("#123456");
    });

    it("strokes at the pen's real width, whatever the zoom", () => {
      // 0.25 mm per local unit and a 0.5 mm pen: 2 local units.
      const imp = makeBaseImport({ scale: 0.25, strokeWidthMM: 0.5, paths: [{ id: "p", d: "M0 0 L1 1", svgSource: "", visible: true }] });
      expect(draw([imp]).strokes[0][1]).toBe(2);
    });
  });

  it("fills no paper and uses the default blues without a page", () => {
    const ctx = { ...makeMockCtx(), fillRect: vi.fn() };
    const strokes: string[] = [];
    ctx.stroke.mockImplementation(() => strokes.push(ctx.strokeStyle));
    drawImportsLayer({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      dpr: 1,
      vp: { zoom: 1, panX: 0, panY: 0 },
      imports: [makeBaseImport({ paths: [{ id: "p", d: "M0 0 L1 1", svgSource: "", visible: true }] })],
      layerGroups: [],
      selectedImportId: null,
      allImportsSelected: false,
      selectedGroupId: null,
      isBottom: true,
      canvasH: 1000,
      respectSvgColorsOnCanvas: false,
      cache: new Map(),
    });
    expect(ctx.fillRect).not.toHaveBeenCalled();
    expect(strokes[0]).toBe("#3a6aaa");
  });
});
