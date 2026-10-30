import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalibrationDialog } from "@renderer/components/CalibrationDialog";
import { useMachineStore } from "@renderer/store/machineStore";
import { createMachineConfig } from "../helpers/factories";

beforeEach(() => {
  vi.clearAllMocks();
  const config = createMachineConfig({penType: "stepper"});
  useMachineStore.setState({configs: [config], activeConfigId: config.id});
  vi.mocked(window.terraForge.fs.saveGcodeDialog).mockResolvedValue(null);
});

describe("CalibrationDialog", () => {
  it("exports a plot and matching results sheet without sending machine commands", async () => {
    vi.mocked(window.terraForge.fs.saveGcodeDialog).mockResolvedValue("C:/tests/pen.gcode");
    render(<CalibrationDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Pen name"), {target: {value: "My felt pen"}});
    fireEvent.click(screen.getByRole("button", {name: "Save calibration test"}));
    await waitFor(() => expect(window.terraForge.fs.writeFile).toHaveBeenCalledTimes(2));
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith("C:/tests/pen.gcode", expect.stringContaining("; Pen: My felt pen"));
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith("C:/tests/pen.gcode.txt", expect.stringContaining("Row 6: 60 mm/s (3600 mm/min)"));
    expect(window.terraForge.fluidnc.sendCommand).not.toHaveBeenCalled();
  });
  it("does not write files when saving is cancelled", async () => {
    render(<CalibrationDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", {name: "Save calibration test"}));
    await waitFor(() => expect(screen.getByRole("button", {name: "Save calibration test"})).toBeEnabled());
    expect(window.terraForge.fs.writeFile).not.toHaveBeenCalled();
  });
  it("requires explicit brush depths and blocks an invalid safe lift", () => {
    render(<CalibrationDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Test"), {target:{value:"brush"}});
    expect(screen.getByRole("button", {name:"Save calibration test"})).toBeDisabled();
    for (const [label, value] of [["Deepest test Z (mm)","-1"], ["Lightest test Z (mm)","0"], ["Safe lift Z (mm)","5"], ["Contact Z for labels / dashes (mm)","0"]]) {
      fireEvent.change(screen.getByLabelText(label), {target:{value}});
    }
    expect(screen.getByRole("button", {name:"Save calibration test"})).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Safe lift Z (mm)"), {target:{value:"-2"}});
    expect(screen.getByRole("button", {name:"Save calibration test"})).toBeDisabled();
  });
});
