import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProcessedFont } from "../../../../types/fonts";
import { useCanvasStore } from "../../store/canvasStore";
import { TextGeneratorDialog } from "./TextGeneratorDialog";
import { createTextImport, DEFAULT_TEXT_SETTINGS, layoutText } from "./textLayout";

const font: ProcessedFont = { id: "test", version: 1, name: "Test font", sourceName: "test.ttf", createdAt: "2026-10-29T00:00:00Z",
  unitsPerEm: 1000, ascender: 800, descender: -200, lineGap: 0, kerning: {}, warnings: ["Test processing note"],
  glyphs: { A: { advanceWidth: 600, paths: [{ points: [{ x: 0, y: 0, width: 100 }, { x: 500, y: 700, width: 200 }] }] },
    " ": { advanceWidth: 300, paths: [] } } };
const outlineFont: ProcessedFont = { ...font, id: "outline", name: "Outline font", mode: "outline", glyphs: {
  A: { advanceWidth: 600, paths: [], outline: [{ type: "M", x: 0, y: 0 }, { type: "L", x: 500, y: 0 }, { type: "L", x: 500, y: 700 }, { type: "L", x: 0, y: 700 }, { type: "Z" }] },
} };

beforeEach(() => {
  window.terraForge.fonts = { list: vi.fn().mockResolvedValue([font]), importFont: vi.fn().mockResolvedValue(null), remove: vi.fn().mockResolvedValue(undefined), convertToCenterline: vi.fn(), smoothCentrelines: vi.fn() };
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

  it("automatically converts the selected outline font when switching modes and reuses linked versions", async () => {
    vi.mocked(window.terraForge.fonts.list).mockResolvedValue([outlineFont]);
    const settings = { ...DEFAULT_TEXT_SETTINGS, text: "A" };
    const original = { ...createTextImport(outlineFont, settings, layoutText(outlineFont, settings), "existing-text"), x: 42, y: 24, rotation: 15, scale: 2 };
    const canvas = useCanvasStore.getState();
    const penId = canvas.addPen("Selected brush", "#000000"); canvas.setActivePen(penId);
    canvas.addImport(original); canvas.selectImport(original.id);
    const storedOriginal = structuredClone(useCanvasStore.getState().imports[0]);
    let finish!: (value: ProcessedFont) => void;
    vi.mocked(window.terraForge.fonts.convertToCenterline).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Outline font" });
    expect(screen.getByLabelText("Font mode")).toHaveValue("outline");
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "AA" } });
    fireEvent.change(screen.getByLabelText("Font size (mm)"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("Letter spacing (mm)"), { target: { value: "0.7" } });
    fireEvent.change(screen.getByLabelText("Font mode"), { target: { value: "centerline" } });
    expect(screen.getByRole("status")).toHaveTextContent("Generating long continuous centrelines");
    expect(screen.getByRole("button", { name: "Add text to canvas" })).toBeDisabled();
    expect(screen.getByRole("img", { name: "Text outline preview" })).toBeInTheDocument();
    const converted: ProcessedFont = { ...font, id: "converted", mode: "centerline", sourceFontId: outlineFont.id, processingVersion: 2 };
    await act(async () => { finish(converted); });
    expect(window.terraForge.fonts.convertToCenterline).toHaveBeenCalledWith(outlineFont.id);
    expect(window.terraForge.fonts.importFont).not.toHaveBeenCalled();
    expect(window.terraForge.fonts.remove).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Font mode")).toHaveValue("centerline");
    expect(screen.getByLabelText("Text font")).toHaveValue(converted.id);
    const preview = screen.getByRole("img", { name: "Text centre-line preview" });
    expect(preview.querySelectorAll("path")).toHaveLength(2);
    expect(preview.querySelector("path")!.getAttribute("d")).not.toContain("Z");
    expect(screen.getByLabelText("Text to generate")).toHaveValue("AA");
    expect(screen.getByLabelText("Font size (mm)")).toHaveValue(18);
    expect(screen.getByLabelText("Letter spacing (mm)")).toHaveValue(0.7);
    expect(useCanvasStore.getState().imports[0]).toEqual(storedOriginal);
    expect(useCanvasStore.getState().activePenId).toBe(penId);
    fireEvent.click(screen.getByRole("checkbox", { name: "Use stroke width information" }));
    fireEvent.change(screen.getByLabelText("Brush lead-in (mm)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Font mode"), { target: { value: "outline" } });
    expect(screen.getByLabelText("Text font")).toHaveValue(outlineFont.id);
    fireEvent.change(screen.getByLabelText("Font mode"), { target: { value: "centerline" } });
    await waitFor(() => expect(screen.getByLabelText("Text font")).toHaveValue(converted.id));
    expect(screen.getByRole("checkbox", { name: "Use stroke width information" })).toBeChecked();
    expect(screen.getByLabelText("Brush lead-in (mm)")).toHaveValue(2);
    expect(window.terraForge.fonts.convertToCenterline).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Update selected text" }));
    expect(useCanvasStore.getState().imports[0]).toMatchObject({ id: original.id, x: 42, y: 24, rotation: 15, scale: 2,
      textSource: { text: "AA", fontId: converted.id, mode: "centerline", fontSizeMM: 18, letterSpacingMM: 0.7, useStrokeWidths: true, brushLeadInMM: 2 } });
    expect(useCanvasStore.getState().layerGroups[0].importIds).toEqual([original.id]);
  });

  it("starts with an available outline font and keeps its preview if conversion fails", async () => {
    vi.mocked(window.terraForge.fonts.list).mockResolvedValue([outlineFont]);
    vi.mocked(window.terraForge.fonts.convertToCenterline).mockRejectedValue(new Error("Font could not be converted"));
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Outline font" });
    expect(screen.getByLabelText("Font mode")).toHaveValue("outline");
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "A" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate centrelines" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Font could not be converted"));
    expect(screen.getByLabelText("Font mode")).toHaveValue("outline");
    expect(screen.getByLabelText("Text font")).toHaveValue(outlineFont.id);
    expect(screen.getByRole("img", { name: "Text outline preview" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add text to canvas" })).toBeEnabled();
    expect(useCanvasStore.getState().imports).toHaveLength(0);
    expect(window.terraForge.fonts.importFont).not.toHaveBeenCalled();
  });

  it("falls back to the remaining outline version after deleting a derived centreline font", async () => {
    const converted: ProcessedFont = { ...font, id: "converted", mode: "centerline", sourceFontId: outlineFont.id };
    vi.mocked(window.terraForge.fonts.list).mockResolvedValue([outlineFont, converted]);
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "A" } });
    expect(screen.getByLabelText("Text font")).toHaveValue(converted.id);
    fireEvent.click(screen.getByRole("button", { name: "Delete selected font" }));
    await waitFor(() => expect(screen.getByLabelText("Text font")).toHaveValue(outlineFont.id));
    expect(screen.getByLabelText("Font mode")).toHaveValue("outline");
    expect(screen.getByRole("img", { name: "Text outline preview" })).toBeInTheDocument();
    expect(window.terraForge.fonts.remove).toHaveBeenCalledWith(converted.id);
  });

  it("updates a legacy library font to smooth curves without changing canvas text until committed", async () => {
    const settings = { ...DEFAULT_TEXT_SETTINGS, text: "A", fontSizeMM: 18, useStrokeWidths: true, brushLeadInMM: 2 };
    const original = { ...createTextImport(font, settings, layoutText(font, settings), "legacy-text"), x: 42, y: 24 };
    useCanvasStore.getState().addImport(original); useCanvasStore.getState().selectImport(original.id);
    const storedOriginal = structuredClone(useCanvasStore.getState().imports[0]);
    const smoothed: ProcessedFont = { ...font, processingVersion: 2, glyphs: { A: { advanceWidth: 600, paths: [{
      points: [{ x: 0, y: 0, width: 100 }, { x: 250, y: 350, width: 150 }, { x: 500, y: 700, width: 200 }],
      commands: [{ type: "M", x: 0, y: 0 }, { type: "C", x1: 0, y1: 300, x2: 500, y2: 400, x: 500, y: 700 }],
    }] } } };
    vi.mocked(window.terraForge.fonts.smoothCentrelines).mockResolvedValue(smoothed);
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    expect(screen.getByText(/Update this font to replace jagged line segments/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Smooth centrelines" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Text centre-line preview" }).querySelector("path")!.getAttribute("d")).toContain("C"));
    expect(window.terraForge.fonts.smoothCentrelines).toHaveBeenCalledWith(font.id);
    expect(window.terraForge.fonts.importFont).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Text font")).toHaveValue(font.id);
    expect(screen.getByLabelText("Font size (mm)")).toHaveValue(18);
    expect(screen.getByRole("checkbox", { name: "Use stroke width information" })).toBeChecked();
    expect(screen.getByLabelText("Brush lead-in (mm)")).toHaveValue(2);
    expect(useCanvasStore.getState().imports[0]).toEqual(storedOriginal);
    fireEvent.click(screen.getByRole("button", { name: "Update selected text" }));
    const item = useCanvasStore.getState().imports[0];
    expect(item).toMatchObject({ id: original.id, x: 42, y: 24, textSource: { fontId: font.id, fontSizeMM: 18, useStrokeWidths: true, brushLeadInMM: 2 } });
    if (item.kind === "bitmap") throw new Error("Text should remain vector artwork.");
    expect(item.paths[0].d).toContain("C");
    expect(item.paths[0].centerline?.commands?.some((command) => command.type === "C")).toBe(true);
  });

  it("retains the existing preview when smoothing fails", async () => {
    vi.mocked(window.terraForge.fonts.smoothCentrelines).mockRejectedValue(new Error("Could not fit smooth curves"));
    render(<TextGeneratorDialog open onOpenChange={vi.fn()} />);
    await screen.findByRole("option", { name: "Test font" });
    fireEvent.change(screen.getByLabelText("Text to generate"), { target: { value: "A" } });
    const originalD = screen.getByRole("img", { name: "Text centre-line preview" }).querySelector("path")!.getAttribute("d");
    fireEvent.click(screen.getByRole("button", { name: "Smooth centrelines" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not fit smooth curves"));
    expect(screen.getByRole("img", { name: "Text centre-line preview" }).querySelector("path")!.getAttribute("d")).toBe(originalD);
    expect(screen.getByRole("button", { name: "Add text to canvas" })).toBeEnabled();
  });
});
