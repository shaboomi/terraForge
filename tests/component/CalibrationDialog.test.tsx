import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CalibrationDialog } from "@renderer/components/CalibrationDialog";
import { useMachineStore } from "@renderer/store/machineStore";
import { createMachineConfig } from "../helpers/factories";

beforeEach(() => {
  vi.clearAllMocks();
  const config = createMachineConfig({penType: "stepper", bedWidth: 300, bedHeight: 300});
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
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith("C:/tests/pen.gcode.txt", expect.stringContaining("Row 6: 3600 mm/min"));
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
  it("uses mm/min for all speed controls and exports the entered feed unchanged", async () => {
    vi.mocked(window.terraForge.fs.saveGcodeDialog).mockResolvedValue("C:/tests/speed.gcode");
    render(<CalibrationDialog onClose={vi.fn()} />);
    expect(screen.getByLabelText("Start speed (mm/min)")).toHaveValue(600);
    expect(screen.getByLabelText("End speed (mm/min)")).toHaveValue(3600);
    expect(screen.getByLabelText("Drawing / reference speed (mm/min)")).toHaveValue(3000);
    fireEvent.change(screen.getByLabelText("End speed (mm/min)"), {target: {value: "6000"}});
    fireEvent.click(screen.getByRole("button", {name: "Save calibration test"}));
    await waitFor(() => expect(window.terraForge.fs.writeFile).toHaveBeenCalledTimes(2));
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith("C:/tests/speed.gcode", expect.stringContaining("F6000"));
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith("C:/tests/speed.gcode.txt", expect.stringContaining("6000 mm/min"));
    expect(screen.queryByText(/mm\/s/)).not.toBeInTheDocument();
  });
  it.each([
    ["timing", "Pen timing"], ["geometry", "Geometry"], ["repeatability", "Repeatability"], ["hatching", "Ink and hatching"],
  ])("exports %s calibration and results without requiring brush Z fields", async (kind, label) => {
    vi.mocked(window.terraForge.fs.saveGcodeDialog).mockResolvedValue(`C:/tests/${kind}.gcode`);
    render(<CalibrationDialog onClose={vi.fn()} />);
    expect(screen.getByRole("option", {name: label})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Test"), {target: {value: kind}});
    expect(screen.queryByLabelText("Safe lift Z (mm)")).not.toBeInTheDocument();
    const save = screen.getByRole("button", {name: "Save calibration test"});
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(window.terraForge.fs.writeFile).toHaveBeenCalledTimes(2));
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith(`C:/tests/${kind}.gcode`, expect.stringContaining(`TerraForge ${kind} calibration`));
    expect(window.terraForge.fs.writeFile).toHaveBeenCalledWith(`C:/tests/${kind}.gcode.txt`, expect.stringContaining(`TerraForge ${kind} calibration`));
    expect(window.terraForge.fluidnc.sendCommand).not.toHaveBeenCalled();
  });
  it("lets pen timing vary either up or down delay", () => {
    render(<CalibrationDialog onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Test"), {target: {value: "timing"}});
    expect(screen.getByLabelText("Delay to test")).toHaveValue("down");
    fireEvent.change(screen.getByLabelText("Delay to test"), {target: {value: "up"}});
    expect(screen.getByLabelText("Delay to test")).toHaveValue("up");
    expect(screen.getByRole("button", {name: "Save calibration test"})).toBeEnabled();
  });
  it("shows a machine-Y-up preview so number orientation matches the plotted sheet", () => {
    render(<CalibrationDialog onClose={vi.fn()} />);
    const preview = screen.getByLabelText(/Calibration pattern schematic/);
    expect(preview.querySelector("g")).toHaveAttribute("transform", "translate(0 164) scale(1 -1)");
  });
});
