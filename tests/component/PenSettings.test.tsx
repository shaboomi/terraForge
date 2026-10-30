import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MachineConfigDialog } from "@renderer/components/MachineConfigDialog";
import { useMachineStore } from "@renderer/store/machineStore";
import { usePenLibraryStore } from "@renderer/store/penLibraryStore";
import { createMachineConfig } from "../helpers/factories";

beforeEach(() => {
  const config = createMachineConfig({ bedWidth: 300, bedHeight: 300 });
  useMachineStore.setState({ configs: [config], activeConfigId: config.id, connected: false });
  usePenLibraryStore.setState({ pens: [] });
  vi.clearAllMocks();
});

it("opens calibration from Settings → Pens without adding a toolbar control", async () => {
  render(<MachineConfigDialog onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Pens" }));
  fireEvent.click(screen.getByRole("button", { name: "Create calibration sheet" }));
  expect(await screen.findByRole("dialog", { name: "Pen calibration" })).toBeVisible();
  expect(screen.getByLabelText("Start speed (mm/min)")).toHaveValue(600);
  expect(window.terraForge.fluidnc.sendCommand).not.toHaveBeenCalled();
});

it("saves and edits reusable pen measurements and rejects invalid speed", () => {
  render(<MachineConfigDialog onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("tab", { name: "Pens" }));
  fireEvent.change(screen.getByLabelText("Pen name"), { target: { value: "Grey fineliner" } });
  fireEvent.change(screen.getByLabelText("Maximum drawing speed (mm/min)"), { target: { value: "900" } });
  fireEvent.click(screen.getByRole("button", { name: "Save pen to library" }));
  expect(usePenLibraryStore.getState().pens[0]).toMatchObject({ name: "Grey fineliner", maxDrawSpeedMMMin: 900 });
  fireEvent.change(screen.getByLabelText("Maximum drawing speed (mm/min)"), { target: { value: "-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Save pen to library" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Maximum drawing speed");
  expect(usePenLibraryStore.getState().pens[0].maxDrawSpeedMMMin).toBe(900);
});
