import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PenSpecificationsEditor } from "./PenSpecificationsEditor";
import { PenLibraryPicker } from "./PenLibraryPicker";
import { useCanvasStore } from "../../store/canvasStore";
import { usePenLibraryStore } from "../../store/penLibraryStore";

beforeEach(() => {
  useCanvasStore.setState({ layerGroups: [{ id: "layout-pen", name: "Black brush", color: "#000000", importIds: [] }], undoStack: [], redoStack: [] });
  usePenLibraryStore.setState({ pens: [] });
});
afterEach(cleanup);

describe("pen specifications", () => {
  it("saves a calibrated brush and makes it available grouped in the library", () => {
    render(<><PenSpecificationsEditor pen={useCanvasStore.getState().layerGroups[0]} /><PenLibraryPicker /></>);
    fireEvent.change(screen.getByLabelText("Pen type"), { target: { value: "brush" } });
    fireEvent.change(screen.getByLabelText("Maximum drawing speed (mm/min)"), { target: { value: "900" } });
    fireEvent.change(screen.getByLabelText("Z at maximum width (mm)"), { target: { value: "-1.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pen to library" }));
    expect(screen.getByRole("status")).toHaveTextContent("Pen saved");
    expect(usePenLibraryStore.getState().pens[0]).toMatchObject({ type: "brush", maxDrawSpeedMMMin: 900, brush: { maxZ: -1.5 } });
    expect(screen.getByRole("group", { name: "Brush" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Group pen library by"), { target: { value: "colour" } });
    expect(screen.getByRole("group", { name: "#000000" })).toBeInTheDocument();
  });
  it("blocks invalid numbers before either layout or library is updated", () => {
    render(<PenSpecificationsEditor pen={useCanvasStore.getState().layerGroups[0]} />);
    fireEvent.change(screen.getByLabelText("Tip width (mm)"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pen to library" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Tip width");
    expect(useCanvasStore.getState().layerGroups[0].penProfile).toBeUndefined();
    expect(usePenLibraryStore.getState().pens).toEqual([]);
  });
});
