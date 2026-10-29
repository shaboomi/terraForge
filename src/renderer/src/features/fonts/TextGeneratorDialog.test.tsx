import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProcessedFont } from "../../../../types/fonts";
import { useCanvasStore } from "../../store/canvasStore";
import { TextGeneratorDialog } from "./TextGeneratorDialog";
import { createTextImport, DEFAULT_TEXT_SETTINGS, layoutText } from "./textLayout";

const font: ProcessedFont = { id: "test", version: 1, name: "Test font", sourceName: "test.ttf", createdAt: "2026-10-29T00:00:00Z",
  unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0, kerning: {}, warnings: ["Test processing note"],
  glyphs: { A: { advanceWidth: 600, paths: [{ points: [{ x: 0, y: 0, width: 100 }, { x: 500, y: 700, width: 200 }] }] },
    " ": { advanceWidth: 300, paths: [] } } };

beforeEach(() => {
  window.terraForge.fonts = { list: vi.fn().mockResolvedValue([font]), importFont: vi.fn().mockResolvedValue(null), remove: vi.fn().mockResolvedValue(undefined) };
  useCanvasStore.setState({ imports: [], layerGroups: [], activePenId: null, selectedImportId: null, selectedPathId: null,
    selectedGroupId: null, allImportsSelected: false, undoStack: [], redoStack: [] });
});

describe("built-in text generator", () => {
  it("adds editable width-bearing vectors using the selected pen and supports undo", async () => {
    const penId = useCanvasStore.getState().addPen("Black brush", "#000000");
    useCanvasStore.getState().setActivePen(penId);
    const close = vi.fn();
    render(<TextGeneratorDialog open onOpenChange={close} />);
    await screen.findByRole("option", { name: "Test font" });
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "AA" } });
    expect(await screen.findByRole("img", { name: "Text centre-line preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add text to canvas" }));
    const state = useCanvasStore.getState();
    expect(state.imports).toHaveLength(1);
    expect(state.layerGroups[0].importIds).toEqual([state.imports[0].id]);
    expect(state.imports[0]).toMatchObject({ textSource: { text: "AA", fontId: "test" }, paths: [{ centerline: { points: expect.any(Array) } }, { centerline: { points: expect.any(Array) } }] });
    expect(close).toHaveBeenCalledWith(false);
    state.undo();
    expect(useCanvasStore.getState().imports).toHaveLength(0);
  });

  it("updates selected text in one undoable replacement while keeping placement and pen membership", async () => {
    const settings = { ...DEFAULT_TEXT_SETTINGS, text: "A" };
    const item = { ...createTextImport(font, settings, layoutText(font, settings), "selected-text"), x: 42, y: 24, rotation: 15, scale: 2 };
    const canvas = useCanvasStore.getState();
    const penId = canvas.addPen("Grey", "#888888"); canvas.setActivePen(penId);
    canvas.addImport(item); canvas.selectImport(item.id);
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    expect(screen.getByLabelText("Text to generate")).toHaveValue("A");
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "AAA" } });
    fireEvent.click(screen.getByRole("button", { name: "Update selected text" }));
    const updated = useCanvasStore.getState();
    expect(updated.imports).toHaveLength(1);
    expect(updated.imports[0]).toMatchObject({ id: item.id, x: 42, y: 24, scale: 2, rotation: 15, textSource: { text: "AAA" } });
    expect(updated.layerGroups[0].importIds).toEqual([item.id]);
    updated.undo();
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ textSource: { text: "A" } });
  });

  it("blocks adding missing characters and reports font-library failures", async () => {
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "AZ" } });
    expect(screen.getByRole("alert")).toHaveTextContent("“Z”");
    expect(screen.getByRole("button", { name: "Add text to canvas" })).toBeDisabled();
    vi.mocked(window.terraForge.fonts.importFont).mockRejectedValue(new Error("Font could not be processed"));
    fireEvent.click(screen.getByRole("button", { name: "Import TTF / OTF" }));
    await waitFor(() => expect(screen.getAllByRole("alert").some((node) => node.textContent?.includes("Font could not be processed"))).toBe(true));
  });

  it("retains the newly chosen font identity when editing existing text", async () => {
    const alternate = { ...font, id: "alternate", name: "Another font" };
    vi.mocked(window.terraForge.fonts.list).mockResolvedValue([font, alternate]);
    const settings = { ...DEFAULT_TEXT_SETTINGS, text: "A" };
    const item = createTextImport(font, settings, layoutText(font, settings), "existing-text");
    useCanvasStore.getState().addImport(item);
    useCanvasStore.getState().selectImport(item.id);
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Another font" });
    fireEvent.change(screen.getByLabelText("Text font"), { target: { value: alternate.id } });
    fireEvent.click(screen.getByRole("button", { name: "Update selected text" }));
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ textSource: { fontId: alternate.id, fontName: alternate.name } });
  });

  it("imports and removes persistent library fonts without touching canvas artwork", async () => {
    vi.mocked(window.terraForge.fonts.list).mockResolvedValue([]);
    vi.mocked(window.terraForge.fonts.importFont).mockResolvedValue(font);
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Import TTF / OTF" }));
    await screen.findByRole("option", { name: "Test font" });
    expect(window.terraForge.fonts.importFont).toHaveBeenCalledWith(DEFAULT_TEXT_SETTINGS.text, "centerline");
    fireEvent.click(screen.getByRole("button", { name: "Delete selected font" }));
    await waitFor(() => expect(screen.queryByRole("option", { name: "Test font" })).not.toBeInTheDocument());
    expect(window.terraForge.fonts.remove).toHaveBeenCalledWith("test");
    expect(useCanvasStore.getState().imports).toHaveLength(0);
  });

  it("filters font versions by import mode and previews real Solid/Sketch strokes", async () => {
    const outlineFont: ProcessedFont = { ...font, id: "outline", name: "Outline font", mode: "outline", glyphs: {
      A: { advanceWidth: 600, paths: [], outline: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 500, y: 0 }, { type: "L", x: 500, y: 700 }, { type: "L", x: 0, y: 700 }, { type: "Z" }] },
    } };
    vi.mocked(window.terraForge.fonts.list).mockResolvedValue([font, outlineFont]);
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    expect(screen.queryByRole("option", { name: "Outline font" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Font mode"), { target: { value: "outline" } });
    expect(screen.getByRole("option", { name: "Outline font" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Use stroke width information" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Text outline preview" }).querySelectorAll("path")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Text infill"), { target: { value: "solid" } });
    expect(screen.getByRole("img", { name: "Text outline preview" }).querySelectorAll("path").length).toBeGreaterThan(2);
    fireEvent.change(screen.getByLabelText("Text infill"), { target: { value: "sketch" } });
    fireEvent.change(screen.getByLabelText("Fill spacing (mm)"), { target: { value: "0.6" } });
    fireEvent.click(screen.getByRole("button", { name: "Add text to canvas" }));
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ useStrokeWidths: false,
      textSource: { mode: "outline", infill: "sketch", fillSpacingMM: 0.6 }, paths: expect.any(Array) });
  });

  it("enables width control and saves the moving brush lead-in without discarding width data", async () => {
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "A" } });
    expect(screen.getByRole("checkbox", { name: "Use stroke width information" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Use stroke width information" }));
    fireEvent.change(screen.getByLabelText("Brush lead-in (mm)"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Add text to canvas" }));
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ useStrokeWidths: true, brushLeadInMM: 2,
      textSource: { useStrokeWidths: true, brushLeadInMM: 2 }, paths: [{ centerline: { points: expect.any(Array) } }] });
  });
});
