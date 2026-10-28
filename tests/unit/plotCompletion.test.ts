import { describe, it, expect, vi } from "vitest";
import { PlotCompletionController } from "../../src/machine/plotCompletion";
import type { MachineStatus, PlotCompletionConfig } from "../../src/types";

const config: PlotCompletionConfig = { penUpCommand: "M3 S0", penUpDelayMs: 300, jogSpeed: 2500 };
const status = (state: MachineStatus["state"], file = "", x = 10): MachineStatus => ({
  state, raw: `<${state}|WPos:${x},20,0${file ? `|SD:99.9,${file}` : ""}>`,
  mpos: { x: x + 50, y: 70, z: 0 }, wpos: { x, y: 20, z: 0 },
  lineNum: 100, lineTotal: 100,
});
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function setup(override = {}) {
  const send = vi.fn(async (_line: string) => "ok");
  const report = vi.fn();
  const controller = new PlotCompletionController(send, report);
  const plot = controller.begin("/art.gcode", { ...config, ...override });
  controller.accepted(plot);
  return { send, report, controller };
}
const eof = "[MSG:INFO: /sd/art.gcode file job succeeded]";

describe("safe controller-file plot completion", () => {
  it("waits for EOF and subsequent planner Idle, never transmitted line count or transient Idle", async () => {
    const { controller, send } = setup();
    controller.status(status("Run", "/sd/art.gcode"));
    controller.status(status("Idle", "/sd/art.gcode")); // spindle/dwell wait mid file
    await flush();
    expect(send).not.toHaveBeenCalled();
    controller.message(eof); // Last line buffered, motion still running
    controller.status(status("Run"));
    await flush();
    expect(send).not.toHaveBeenCalled();
    controller.status(status("Idle"));
    await flush();
    expect(send.mock.calls.map(([line]) => line)).toEqual([
      "G90 G21 G94", "M3 S0", "G4 P0.3", "G90 G21 G94 G1 X0 Y0 F2500",
    ]);
    controller.status(status("Idle"));
    controller.message(eof);
    controller.status(status("Idle"));
    await flush();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("uses file progress disappearing as EOF on firmware with no console EOF notification", async () => {
    const { controller, send } = setup();
    controller.status(status("Run", "/sd/art.gcode"));
    controller.status(status("Run")); // file reader ended, planner draining
    expect(send).not.toHaveBeenCalled();
    controller.status(status("Idle"));
    await flush();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it("does not use another file, startup Idle, or acknowledgement as completion", async () => {
    const { controller, send } = setup();
    controller.status(status("Idle"));
    controller.message("ok");
    controller.message("[MSG:INFO: /sd/other.gcode file job succeeded]");
    controller.status(status("Run", "/sd/other.gcode"));
    controller.status(status("Idle"));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("handles newer job sent notification but waits for start acknowledgement and a later Idle", async () => {
    const send = vi.fn(async () => "ok");
    const controller = new PlotCompletionController(send, vi.fn());
    const plot = controller.begin("art.gcode", config);
    controller.message("[MSG:DEBUG: /sd/art.gcode job sent]");
    controller.status(status("Idle"));
    expect(send).not.toHaveBeenCalled();
    controller.accepted(plot);
    expect(send).not.toHaveBeenCalled();
    controller.status(status("Idle"));
    await flush();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it.each(["Alarm", "Door", "Sleep", "Unknown", "Check", "Home", "Jog"] as const)("does not return after %s", async (state) => {
    const { controller, send } = setup();
    controller.message(eof);
    controller.status(status(state));
    controller.status(status("Idle"));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["ALARM:1", "error:20", "[MSG:ERR: File read failed]", "[MSG:INFO: Reset during file job]", "Grbl 3.0 [FluidNC]"])("invalidates on %s", async (message) => {
    const { controller, send } = setup();
    controller.message(eof);
    controller.message(message);
    controller.status(status("Idle"));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not clear an explicit pause from an in-flight stale Run report", async () => {
    const { controller, send } = setup();
    controller.pause();
    controller.status(status("Run"));
    controller.message(eof);
    controller.status(status("Idle"));
    await flush();
    expect(send).not.toHaveBeenCalled();
  });

  it("does not treat paused EOF as completion, and supports resume", async () => {
    const { controller, send } = setup();
    controller.message(eof);
    controller.pause();
    controller.status(status("Hold"));
    controller.status(status("Idle"));
    expect(send).not.toHaveBeenCalled();
    controller.resume();
    controller.status(status("Run"));
    controller.status(status("Idle"));
    await flush();
    expect(send).toHaveBeenCalledTimes(4);
  });

  it.each(["pause", "cancel", "hold"])("stops finalization when %s occurs while lift is pending", async (action) => {
    const { controller, send } = setup();
    let resolve!: (value: string) => void;
    send.mockImplementationOnce(() => new Promise<string>((done) => { resolve = done; }));
    controller.message(eof);
    controller.status(status("Idle"));
    if (action === "hold") controller.status(status("Hold"));
    else controller[action as "pause" | "cancel"]();
    resolve("ok");
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(["throw", "error-response"])("does not return after a failed lift (%s)", async (kind) => {
    const { controller, send } = setup();
    send.mockResolvedValueOnce("ok");
    if (kind === "throw") send.mockRejectedValueOnce(new Error("Transport failed"));
    else send.mockResolvedValueOnce("error:20");
    controller.message(eof);
    controller.status(status("Idle"));
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("uses configured absolute machine-coordinate stepper lift and zero delay before travel", async () => {
    const { controller, send } = setup({ penUpCommand: "G53 G0 Z-2", penUpDelayMs: 0 });
    controller.message(eof);
    controller.status(status("Idle"));
    await flush();
    expect(send.mock.calls.map(([line]) => line)).toEqual([
      "G90 G21 G94", "G53 G0 Z-2", "G4 P0", "G90 G21 G94 G1 X0 Y0 F2500",
    ]);
    expect(send.mock.calls.flat().join(" ")).not.toContain("$H");
  });

  it("lifts but skips duplicate XY return when a generated footer already reached work origin", async () => {
    const { controller, send } = setup();
    controller.message(eof);
    const atOrigin = status("Idle", "", 0); atOrigin.wpos.y = 0; atOrigin.raw = "<Idle|WPos:0,0,0>";
    controller.status(atOrigin);
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("rejects new plots until the return has finished executing", async () => {
    const { controller } = setup();
    controller.message(eof);
    controller.status(status("Idle"));
    await flush();
    expect(() => controller.begin("/next.gcode", config)).toThrow("already active");
    controller.status(status("Run"));
    controller.status(status("Idle")); // Stale Idle before the return starts is insufficient.
    expect(() => controller.begin("/next.gcode", config)).toThrow("already active");
    const home = status("Idle", "", 0); home.wpos.y = 0; home.raw = "<Idle|WPos:0,0,0>";
    controller.status(home);
    expect(() => controller.begin("/next.gcode", config)).not.toThrow();
  });

  it("snapshots pen settings and rejects missing safe lift settings", async () => {
    const local = { ...config };
    const send = vi.fn(async () => "ok");
    const controller = new PlotCompletionController(send, vi.fn());
    controller.accepted(controller.begin("/art.gcode", local));
    local.penUpCommand = "M3 S100";
    controller.message(eof); controller.status(status("Idle")); await flush();
    expect(send).toHaveBeenCalledWith("M3 S0", expect.any(AbortSignal));
    controller.cancel();
    expect(() => controller.begin("/art.gcode", { ...config, penUpCommand: "" })).toThrow("machine profile");
  });
});
