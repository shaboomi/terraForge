import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PluginEntry, PluginManifest, PluginsApi } from "../../../../types";
import { useCanvasStore } from "../../store/canvasStore";
import { PluginPanel } from "./PluginPanel";
import { PluginsMenu } from "./PluginsMenu";
import { usePluginStore } from "./pluginStore";

const manifest: PluginManifest = {
  id: "test.rectangle", name: "Rectangle Generator", version: "1.0.0", apiVersion: 1,
  description: "Draw a rectangle.", category: "generator", input: "none", outputs: ["vector"],
  controls: [{ key: "width", label: "Width (mm)", type: "number", default: 20, min: 1, max: 100 }],
};
const generator: PluginEntry = { filename: "rectangle.js", enabled: true, manifest };
const filter: PluginEntry = { filename: "filter.js", enabled: true, manifest: {
  ...manifest, id: "test.filter", name: "Bitmap Tones", category: "bitmap-processor", input: "bitmap", outputs: ["bitmap"],
} };
const spiral: PluginEntry = { filename: "spiral.js", enabled: true, manifest: {
  ...manifest, id: "test.spiral", name: "Spiral Sawtooth", category: "bitmap-processor", input: "bitmap", outputs: ["vector"],
} };
let plugins: PluginsApi;

beforeEach(() => {
  plugins = {
    list: vi.fn().mockResolvedValue([generator, filter, spiral]),
    openFolder: vi.fn().mockResolvedValue(undefined), installExample: vi.fn().mockResolvedValue(undefined),
    setEnabled: vi.fn().mockResolvedValue(undefined), run: vi.fn(), cancel: vi.fn().mockResolvedValue(undefined),
  };
  window.terraForge.plugins = plugins;
  usePluginStore.setState({ entries: [generator, filter, spiral], activeFilename: null, parameters: {},
    loading: false, saving: [], collapsed: false, editingImportId: null, error: null, runError: null,
    running: null, preview: null });
  useCanvasStore.setState({ imports: [], layerGroups: [], selectedImportId: null, selectedPathId: null,
    selectedGroupId: null, allImportsSelected: false });
});

async function openMenu() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Plugins", exact: true }));
  await screen.findByRole("menu", { name: "Plugins", exact: true });
  return user;
}

describe("cascading Plugins menu", () => {
  it("starts with four categories and a separate utility section, without executing plugins", async () => {
    render(<PluginsMenu />);
    await openMenu();
    const menu = screen.getByRole("menu", { name: "Plugins", exact: true });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      "Bitmap Filters", "Bitmap to Vector", "Generators", "Font Tools",
      "Open Plugin Folder", "Rescan Plugins", "Add Example Generator", "Manage Plugins",
    ]);
    expect(within(menu).getByRole("separator")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Spiral Sawtooth" })).not.toBeInTheDocument();
    expect(plugins.run).not.toHaveBeenCalled();
  });

  it("keeps categories visible, replaces submenus on click and includes the built-in font tool", async () => {
    render(<PluginsMenu />);
    const user = await openMenu();
    const filters = screen.getByRole("menuitem", { name: "Bitmap Filters", exact: true });
    await user.click(filters);
    expect(await screen.findByRole("menuitem", { name: "Bitmap Tones" })).toBeVisible();
    expect(filters).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Bitmap to Vector", exact: true })).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Bitmap to Vector", exact: true }));
    expect(await screen.findByRole("menuitem", { name: "Spiral Sawtooth" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "Bitmap Tones" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Font Tools", exact: true }));
    const fontTools = await screen.findByRole("menu", { name: "Font Tools", exact: true });
    expect(within(fontTools).getByRole("menuitem", { name: "Text generator" })).toHaveTextContent("Built in");
  });

  it("labels vector processors and opens current Properties controls without running", async () => {
    const vector: PluginEntry = { filename: "vector.js", enabled: true, manifest: {
      ...manifest, id: "test.vector", name: "Reverse Vectors", input: "vector",
    } };
    vi.mocked(plugins.list).mockResolvedValue([generator, vector]);
    const show = vi.fn();
    window.addEventListener("terraforge:show-properties", show);
    try {
      render(<><PluginsMenu /><PluginPanel /></>);
      const user = await openMenu();
      await user.click(screen.getByRole("menuitem", { name: "Generators", exact: true }));
      const item = await screen.findByRole("menuitem", { name: "Reverse Vectors", exact: true });
      expect(item).toHaveTextContent("Vector input");
      // jsdom has no menu geometry for Radix's pointer grace region. The desktop
      // suite exercises the pointer journey; here verify the selection action.
      fireEvent.click(item);
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      const panel = screen.getByRole("region", { name: "Plugin: Reverse Vectors" });
      expect(panel).toHaveTextContent("Select one vector to use this plugin.");
      expect(within(panel).getByRole("button", { name: "Preview", exact: true })).toBeDisabled();
      expect(show).toHaveBeenCalledOnce();
      expect(plugins.run).not.toHaveBeenCalled();
    } finally { window.removeEventListener("terraforge:show-properties", show); }
  });

  it("exposes disabled plugins and invalid-file explanations through management", async () => {
    const disabled: PluginEntry = { ...generator, enabled: false };
    vi.mocked(plugins.list).mockResolvedValue([disabled, { filename: "broken.js", enabled: false, error: "Invalid manifest" }]);
    render(<PluginsMenu />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Generators", exact: true }));
    const item = await screen.findByRole("menuitem", { name: "Rectangle Generator", exact: true });
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menu", { name: "Generators", exact: true })).toHaveTextContent(/Enable.*Manage Plugins|Disabled/i);
    await user.click(screen.getByRole("menuitem", { name: "Manage Plugins", exact: true }));
    const management = await screen.findByRole("dialog", { name: "Manage Plugins", exact: true });
    expect(within(management).getByRole("checkbox", { name: "Enable Rectangle Generator" })).not.toBeChecked();
    expect(within(management).getByText("broken.js")).toBeInTheDocument();
    expect(within(management).getByRole("alert")).toHaveTextContent("Invalid manifest");
    expect(plugins.run).not.toHaveBeenCalled();
  });

  it("updates enable controls immediately and rolls back failed persistence", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(plugins.setEnabled).mockReturnValue(new Promise((_, fail) => { reject = fail; }));
    render(<PluginsMenu />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Manage Plugins", exact: true }));
    const checkbox = await screen.findByRole("checkbox", { name: "Enable Rectangle Generator" });
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    await act(async () => { reject(new Error("Cannot save plugin settings")); });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeEnabled();
    expect(screen.getByRole("dialog", { name: "Manage Plugins" })).toHaveTextContent("Cannot save plugin settings");
  });

  it("navigates into and back out of a submenu, selects with Enter and closes with Escape", async () => {
    render(<PluginsMenu />);
    const user = userEvent.setup();
    const trigger = screen.getByRole("button", { name: "Plugins", exact: true });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const filters = await screen.findByRole("menuitem", { name: "Bitmap Filters", exact: true });
    await waitFor(() => expect(filters).toHaveFocus());
    await user.keyboard("{ArrowDown}{ArrowRight}");
    const sawtooth = await screen.findByRole("menuitem", { name: "Spiral Sawtooth", exact: true });
    await waitFor(() => expect(sawtooth).toHaveFocus());
    await user.keyboard("{ArrowLeft}");
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "Bitmap to Vector", exact: true })).toHaveFocus());
    await user.keyboard("{ArrowUp}{ArrowRight}{Enter}");
    await waitFor(() => expect(usePluginStore.getState().activeFilename).toBe(filter.filename));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("closes the whole cascade on an outside pointer press", async () => {
    render(<PluginsMenu />);
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Bitmap to Vector", exact: true }));
    expect(await screen.findByRole("menuitem", { name: "Spiral Sawtooth", exact: true })).toBeVisible();
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });
});
