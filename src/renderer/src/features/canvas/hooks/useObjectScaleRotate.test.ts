import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useObjectScaleRotate } from "./useObjectScaleRotate";
import { useCanvasStore } from "../../../store/canvasStore";
import { createSvgImport } from "../../../../../../tests/helpers/factories";
import { MM_TO_PX } from "../constants";
import { rotatePoint } from "../utils/geometry";
import type { CanvasItem } from "../../../../../types";
import type { Vp, HandlePos } from "../types";

const INITIAL_STORE = {
  imports: [],
  selectedImportId: null,
  allImportsSelected: false,
  selectedGroupId: null,
};

beforeEach(() => {
  useCanvasStore.setState(INITIAL_STORE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeContainer(left = 0, top = 0) {
  const div = document.createElement("div");
  div.getBoundingClientRect = () =>
    ({ left, top, width: 800, height: 600 }) as DOMRect;
  return div;
}

function makeRefs(zoom = 1) {
  const containerRef: { current: HTMLDivElement | null } = {
    current: makeContainer(),
  };
  const vpRef: { current: Vp } = { current: { zoom, panX: 0, panY: 0 } };
  return { containerRef, vpRef };
}

function fakeCircleEvent(
  clientX: number,
  clientY: number,
): React.MouseEvent<SVGCircleElement> {
  return {
    clientX,
    clientY,
    stopPropagation: vi.fn(),
  } as unknown as React.MouseEvent<SVGCircleElement>;
}

describe("useObjectScaleRotate", () => {
  describe("initial state", () => {
    it("scaling and rotating are null on init", () => {
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, vi.fn()),
      );
      expect(result.current.scaling).toBeNull();
      expect(result.current.rotating).toBeNull();
    });
  });

  describe("onHandleMouseDown", () => {
    it("records uniform scales and gesture dimensions", () => {
      const imp = createSvgImport({
        id: "imp1",
        x: 10,
        y: 20,
        scale: 2,
        svgWidth: 50,
        svgHeight: 40,
      });
      useCanvasStore.setState({ imports: [imp] });
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, vi.fn()),
      );
      act(() =>
        result.current.onHandleMouseDown(
          fakeCircleEvent(300, 200),
          "imp1",
          "br",
        ),
      );
      const s = result.current.scaling!;
      expect(s.id).toBe("imp1");
      expect(s.handle).toBe("br");
      expect(s.startScale).toBe(2);
      expect(s.startScaleX).toBe(2);
      expect(s.startScaleY).toBe(2);
      expect(s.hasAxisScales).toBe(false);
      expect(s.startW).toBeCloseTo(imp.svgWidth * 2 * MM_TO_PX);
      expect(s.startH).toBeCloseTo(imp.svgHeight * 2 * MM_TO_PX);
    });

    it("records existing independent axis scales", () => {
      const imp = createSvgImport({
        id: "imp1",
        scale: 1,
        scaleX: 2,
        scaleY: 3,
        svgWidth: 50,
        svgHeight: 40,
      });
      useCanvasStore.setState({ imports: [imp] });
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, vi.fn()),
      );
      act(() =>
        result.current.onHandleMouseDown(
          fakeCircleEvent(100, 100),
          "imp1",
          "r",
        ),
      );
      expect(result.current.scaling?.hasAxisScales).toBe(true);
    });
  });

  describe("updateScaleMove", () => {
    it("does nothing when not scaling", () => {
      const updateImport = vi.fn();
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, updateImport),
      );
      act(() =>
        result.current.updateScaleMove(
          new MouseEvent("mousemove", { clientX: 100, clientY: 100 }),
        ),
      );
      expect(updateImport).not.toHaveBeenCalled();
    });

    it("calls updateImport for locked scale drag on br handle", () => {
      const imp = createSvgImport({
        id: "imp1",
        scale: 1,
        svgWidth: 100,
        svgHeight: 100,
      });
      useCanvasStore.setState({ imports: [imp] });
      const updateImport = vi.fn();
      const { containerRef, vpRef } = makeRefs(1);
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, updateImport),
      );
      // Start scale at (100, 100) with br handle — dx=+positive grows br handle
      act(() =>
        result.current.onHandleMouseDown(
          fakeCircleEvent(100, 100),
          "imp1",
          "br",
        ),
      );
      // startW = 100*1*3 = 300px; move dx=30 → delta=30, scale *= (1 + 30/300) = 1.1
      act(() =>
        result.current.updateScaleMove(
          new MouseEvent("mousemove", { clientX: 130, clientY: 130 }),
        ),
      );
      expect(updateImport).toHaveBeenCalledWith("imp1", expect.objectContaining({
        scale: expect.closeTo(1.1, 5),
        scaleX: undefined,
        scaleY: undefined,
      }));
    });

    it("calls updateImport for independent axis scale on r handle", () => {
      const imp = createSvgImport({
        id: "imp1",
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        svgWidth: 100,
        svgHeight: 100,
      });
      useCanvasStore.setState({ imports: [imp] });
      const updateImport = vi.fn();
      const { containerRef, vpRef } = makeRefs(1);
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, updateImport),
      );
      act(() =>
        result.current.onHandleMouseDown(
          fakeCircleEvent(100, 100),
          "imp1",
          "r",
        ),
      );
      // r handle: only X axis, dx=30, startW=300, deltaX=+30
      act(() =>
        result.current.updateScaleMove(
          new MouseEvent("mousemove", { clientX: 130, clientY: 100, ctrlKey: true }),
        ),
      );
      const call = updateImport.mock.calls[0][1] as {
        scaleX?: number;
        scaleY?: number;
      };
      expect(call.scaleX).toBeCloseTo(1.1, 5);
      expect(call.scaleY).toBe(1); // r handle does not resize Y
    });
  });

  describe("endScale / endRotate", () => {
    it("endScale clears scaling", () => {
      const imp = createSvgImport({ id: "i1" });
      useCanvasStore.setState({ imports: [imp] });
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, vi.fn()),
      );
      act(() =>
        result.current.onHandleMouseDown(fakeCircleEvent(0, 0), "i1", "tl"),
      );
      expect(result.current.scaling).not.toBeNull();
      act(() => result.current.endScale());
      expect(result.current.scaling).toBeNull();
    });

    it("endRotate clears rotating", () => {
      const imp = createSvgImport({ id: "i1", rotation: 0 });
      useCanvasStore.setState({ imports: [imp] });
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, vi.fn()),
      );
      act(() =>
        result.current.onRotateHandleMouseDown(
          fakeCircleEvent(10, 10),
          "i1",
          100,
          100,
        ),
      );
      expect(result.current.rotating).not.toBeNull();
      act(() => result.current.endRotate());
      expect(result.current.rotating).toBeNull();
    });
  });

  describe("onRotateHandleMouseDown", () => {
    it("sets rotating with correct startAngle", () => {
      const imp = createSvgImport({ id: "i1", rotation: 45 });
      useCanvasStore.setState({ imports: [imp] });
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, vi.fn()),
      );
      // Centre of object at (100, 100) in SVG space; mouse at (110, 100) → angle = 0
      act(() =>
        result.current.onRotateHandleMouseDown(
          fakeCircleEvent(110, 100), // clientX=110, clientY=100; vp.panX=0, zoom=1
          "i1",
          100,
          100,
        ),
      );
      const r = result.current.rotating!;
      expect(r.id).toBe("i1");
      expect(r.cx).toBe(100);
      expect(r.cy).toBe(100);
      expect(r.startRotation).toBe(45);
      expect(r.startAngle).toBeCloseTo(0); // atan2(0, 10) = 0
    });
  });

  describe("updateRotateMove", () => {
    it("calls updateImport with rotation delta", () => {
      const imp = createSvgImport({ id: "i1", rotation: 0 });
      useCanvasStore.setState({ imports: [imp] });
      const updateImport = vi.fn();
      const { containerRef, vpRef } = makeRefs();
      const { result } = renderHook(() =>
        useObjectScaleRotate(containerRef, vpRef, updateImport),
      );
      // Mouse at (110, 100) → startAngle = 0 (pointing east of centre at 100,100)
      act(() =>
        result.current.onRotateHandleMouseDown(
          fakeCircleEvent(110, 100),
          "i1",
          100,
          100,
        ),
      );
      // Move mouse to (100, 110) → angle = π/2 (pointing south), delta = 90� degrees
      act(() =>
        result.current.updateRotateMove(
          new MouseEvent("mousemove", { clientX: 100, clientY: 110 }),
        ),
      );
      expect(updateImport).toHaveBeenCalledWith("i1", {
        rotation: expect.closeTo(90, 3),
      });
    });
  });
});


const handles: HandlePos[] = ["tl", "t", "tr", "r", "br", "b", "bl", "l"];
const rotations = [0, 37, 90, 180, 270];
const zooms = [0.5, 1, 2.5];
function oppositeAnchor(item: CanvasItem, handle: HandlePos, yDirection: number) {
  const w = item.svgWidth * (item.scaleX ?? item.scale) * MM_TO_PX;
  const h = item.svgHeight * (item.scaleY ?? item.scale) * MM_TO_PX;
  const hx = handle.includes("l") ? -1 : handle.includes("r") ? 1 : 0;
  const hy = handle.includes("t") ? -1 : handle.includes("b") ? 1 : 0;
  const [ax, ay] = rotatePoint(-hx * w / 2, -hy * h / 2, item.rotation);
  return [item.x * MM_TO_PX + w / 2 + ax,
    yDirection * (item.y * MM_TO_PX + h) + h / 2 + ay];
}

describe("anchored rotated resizing", () => {
  for (const rotation of rotations) for (const zoom of zooms) for (const handle of handles) {
    it(`${handle} at ${rotation} degrees and zoom ${zoom} enlarges and shrinks around its opposite anchor`, () => {
      const item = createSvgImport({id: "resize", x: 40, y: 60, rotation,
        svgWidth: 80, svgHeight: 50, scale: 1, scaleX: 1.5, scaleY: 0.7});
      useCanvasStore.setState({imports: [item]});
      const {containerRef, vpRef} = makeRefs(zoom);
      const update = vi.fn();
      const {result} = renderHook(() => useObjectScaleRotate(containerRef, vpRef, update));
      act(() => result.current.onHandleMouseDown(fakeCircleEvent(250, 250), item.id, handle));
      const hx = handle.includes("l") ? -1 : handle.includes("r") ? 1 : 0;
      const hy = handle.includes("t") ? -1 : handle.includes("b") ? 1 : 0;
      const w = item.svgWidth * item.scaleX! * MM_TO_PX;
      const h = item.svgHeight * item.scaleY! * MM_TO_PX;
      const anchor = oppositeAnchor(item, handle, -1);
      for (const amount of [0, 0.25, -0.25]) {
        const [dx,dy] = rotatePoint(hx * w * amount, hy * h * amount, rotation);
        act(() => result.current.updateScaleMove(new MouseEvent("mousemove", {
          clientX: 250 + dx * zoom, clientY: 250 + dy * zoom,
        })));
        const changed = {...item, ...update.mock.calls.at(-1)![1]};
        expect(changed.scaleX).toBeCloseTo(item.scaleX! * (1 + amount), 8);
        expect(changed.scaleY).toBeCloseTo(item.scaleY! * (1 + amount), 8);
        const nextAnchor = oppositeAnchor(changed, handle, -1);
        expect(nextAnchor[0]).toBeCloseTo(anchor[0], 8);
        expect(nextAnchor[1]).toBeCloseTo(anchor[1], 8);
      }
    });
  }

  it.each([-1, 1])("Ctrl freely scales local axes at 90 degrees and anchors with Y direction %s", (yDirection) => {
    const item = createSvgImport({id: "free", x: 40, y: 60, rotation: 90,
      svgWidth: 80, svgHeight: 50, scale: 1, scaleX: 1.5, scaleY: 0.7});
    useCanvasStore.setState({imports: [item]});
    const {containerRef, vpRef} = makeRefs(2);
    const update = vi.fn();
    const {result} = renderHook(() => useObjectScaleRotate(containerRef, vpRef, update,
      (mm) => yDirection * mm * MM_TO_PX));
    act(() => result.current.onHandleMouseDown(fakeCircleEvent(250, 250), item.id, "tr"));
    const [dx,dy] = rotatePoint(item.svgWidth * item.scaleX! * MM_TO_PX * 0.4,
      -item.svgHeight * item.scaleY! * MM_TO_PX * 0.1, 90);
    act(() => result.current.updateScaleMove(new MouseEvent("mousemove", {
      clientX: 250 + dx * 2, clientY: 250 + dy * 2, ctrlKey: true,
    })));
    const changed = {...item, ...update.mock.calls.at(-1)![1]};
    expect(changed.scaleX).toBeCloseTo(item.scaleX! * 1.4, 8);
    expect(changed.scaleY).toBeCloseTo(item.scaleY! * 1.1, 8);
    const anchor = oppositeAnchor(item, "tr", yDirection);
    const nextAnchor = oppositeAnchor(changed, "tr", yDirection);
    expect(nextAnchor[0]).toBeCloseTo(anchor[0], 8);
    expect(nextAnchor[1]).toBeCloseTo(anchor[1], 8);
  });

  it("keeps a resize gesture in one Undo/Redo step", () => {
    const item = createSvgImport({id: "undo-resize", rotation: 270});
    useCanvasStore.setState({imports: [item], undoStack: [], redoStack: []});
    const {containerRef,vpRef} = makeRefs();
    const {result} = renderHook(() => useObjectScaleRotate(containerRef, vpRef, useCanvasStore.getState().updateImport));
    act(() => result.current.onHandleMouseDown(fakeCircleEvent(250,250), item.id,"br"));
    act(() => result.current.updateScaleMove(new MouseEvent("mousemove",{clientX: 280,clientY: 220})));
    act(() => result.current.updateScaleMove(new MouseEvent("mousemove",{clientX: 300,clientY: 200})));
    act(() => {result.current.endScale(); useCanvasStore.getState().commitGesture();});
    const changed = structuredClone(useCanvasStore.getState().imports[0]);
    expect(useCanvasStore.getState().undoStack).toHaveLength(1);
    act(() => useCanvasStore.getState().undo());
    expect(useCanvasStore.getState().imports[0]).toEqual(item);
    act(() => useCanvasStore.getState().redo());
    expect(useCanvasStore.getState().imports[0]).toEqual(changed);
  });
});
