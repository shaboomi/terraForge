import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PenColourControls } from "@renderer/components/Toolbar/PenColourControls";
import { useCanvasStore } from "@renderer/store/canvasStore";
import type { BitmapImport } from "../../src/types";
import { createSvgImport } from "../helpers/factories";

beforeEach(() => {
  useCanvasStore.setState({ imports: [], assets: {}, layerGroups: [], selectedImportId: null,
    selectedGroupId: null, selectedPathId: null, allImportsSelected: false,
    undoStack: [], redoStack: [], pageTemplate: null });
});

async function addPen(user: ReturnType<typeof userEvent.setup>, name: string, swatch?: string) {
  await user.type(screen.getByRole("textbox", { name: "New pen name" }), name);
  if (swatch) {
    await user.click(screen.getByRole("button", { name: "New pen colour", exact: true }));
    await user.click(screen.getByRole("button", { name: swatch }));
  }
  await user.click(screen.getByRole("button", { name: "Add pen", exact: true }));
}

describe("PenColourControls", () => {
  it("adds named pens in lightest-first order and keeps the selected pen when its colour moves", async () => {
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    await addPen(user, "Black");
    await addPen(user, "White", "White (#ffffff)");
    await addPen(user, "Yellow", "Yellow (#facc15)");
    const select = screen.getByRole("combobox", { name: "Pen", exact: true });
    expect(within(select).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "1. White (#ffffff)", "2. Yellow (#facc15)", "3. Black (#000000)",
    ]);
    const yellowId = useCanvasStore.getState().layerGroups.find((pen) => pen.name === "Yellow")!.id;
    expect(select).toHaveValue(yellowId);
    await user.click(screen.getByRole("button", { name: "Pen colour", exact: true }));
    fireEvent.change(screen.getByLabelText("Custom pen colour"), { target: { value: "#ffffff" } });
    expect(select).toHaveValue(yellowId);
    expect(screen.getByRole("textbox", { name: "Pen name", exact: true })).toHaveValue("Yellow");
  });

  it("keeps a loaded pen selected when changing its default selection moves it in the order", async () => {
    useCanvasStore.setState({ layerGroups: [
      { id: "white", name: "White", color: "#ffffff", importIds: [] },
      { id: "yellow", name: "Yellow", color: "#facc15", importIds: [] },
      { id: "black", name: "Black", color: "#000000", importIds: [] },
    ] });
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    await user.click(screen.getByRole("button", { name: "Pen colour", exact: true }));
    fireEvent.change(screen.getByLabelText("Custom pen colour"), { target: { value: "#101010" } });
    expect(screen.getByRole("combobox", { name: "Pen", exact: true })).toHaveValue("white");
    expect(screen.getByRole("textbox", { name: "Pen name", exact: true })).toHaveValue("White");
  });

  it("can open the colour picker immediately after renaming a pen", async () => {
    useCanvasStore.setState({ layerGroups: [{ id: "black", name: "Black", color: "#000000", importIds: [] }] });
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    const name = screen.getByRole("textbox", { name: "Pen name", exact: true });
    await user.clear(name);
    await user.type(name, "Fine black");
    await user.click(screen.getByRole("button", { name: "Pen colour", exact: true }));
    expect(useCanvasStore.getState().layerGroups[0].name).toBe("Fine black");
    expect(screen.getByRole("dialog", { name: "Pen colour picker" })).toBeVisible();
  });
  it("applies the chosen pen to selected vector artwork", async () => {
    const artwork = createSvgImport();
    useCanvasStore.setState({ imports: [artwork], selectedImportId: artwork.id,
      layerGroups: [{ id: "blue", name: "Blue", color: "#3b82f6", importIds: [] }] });
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    await user.click(screen.getByRole("button", { name: "Apply pen to selection" }));
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual([artwork.id]);
    expect(useCanvasStore.getState().imports).toEqual([artwork]);
  });

  it("disables applying a pen when only a bitmap is selected", async () => {
    const bitmap: BitmapImport = { ...createSvgImport(), kind: "bitmap", assetId: "image", opacity: 1 };
    useCanvasStore.setState({ imports: [bitmap], selectedImportId: bitmap.id,
      layerGroups: [{ id: "blue", name: "Blue", color: "#3b82f6", importIds: [] }] });
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    expect(screen.getByRole("button", { name: "Apply pen to selection" })).toBeDisabled();
    expect(screen.getByText("Select vector artwork on the canvas to apply a pen.")).toBeVisible();
  });

  it("removes a pen while preserving its artwork", async () => {
    const artwork = createSvgImport();
    useCanvasStore.setState({ imports: [artwork], layerGroups: [
      { id: "blue", name: "Blue", color: "#3b82f6", importIds: [artwork.id] },
    ] });
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    await user.click(screen.getByRole("button", { name: "Remove pen" }));
    expect(useCanvasStore.getState().layerGroups).toEqual([]);
    expect(useCanvasStore.getState().imports).toEqual([artwork]);
    expect(screen.getByText("Add your first pen below.")).toBeVisible();
  });

  it("uses Escape to close the colour picker before the parent pen dialog", async () => {
    const user = userEvent.setup();
    render(<PenColourControls />);
    await user.click(screen.getByRole("button", { name: "Pen colours" }));
    await user.click(screen.getByRole("button", { name: "New pen colour", exact: true }));
    expect(screen.getByRole("dialog", { name: "New pen colour picker" })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "New pen colour picker" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Pen colours", exact: true })).toBeVisible();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Pen colours", exact: true })).not.toBeInTheDocument();
  });
});
