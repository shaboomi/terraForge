import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FluidNCClient } from "../../src/machine/fluidnc";
import { PlotCompletionController } from "../../src/machine/plotCompletion";

const sockets = vi.hoisted(() => ({ instances: [] as any[] }));

vi.mock("ws", () => {
  const { EventEmitter } = require("events");
  class SimulatedSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    sent: string[] = [];
    send = vi.fn((command: string) => { this.sent.push(command); });
    close = vi.fn();
    terminate = vi.fn();
    constructor() { super(); sockets.instances.push(this); }
  }
  return { WebSocket: SimulatedSocket };
});

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const clients: FluidNCClient[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  sockets.instances.length = 0;
  // Any HTTP request is a regression: these tests never contact a controller.
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected HTTP request"); }));
});

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnectWebSocket();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function fixture(filesystem: "sd" | "fs" = "sd") {
  const client = new FluidNCClient();
  clients.push(client);
  const report = vi.fn();
  const controller = new PlotCompletionController(
    (command, signal) => client.sendCommandAndWait(command, signal),
    report,
  );
  client.on("status", (status) => controller.status(status));
  client.on("console", (line) => controller.message(line));
  client.on("connection-lost", () => controller.cancel());
  await client.connectWebSocket("simulator.invalid", 80, 80);
  const socket = sockets.instances.at(-1)!;
  socket.emit("open");
  socket.emit("message", "ok"); // Initial reporting-interval setup acknowledgement.
  const prefix = filesystem === "sd" ? "/sd" : "/localfs";
  const plot = controller.begin("/art.gcode", {
    penUpCommand: "M3 S0", penUpDelayMs: 350, jogSpeed: 2100,
  });
  let started = false;
  const start = client.runFile("/art.gcode", filesystem).then(() => {
    started = true;
    controller.accepted(plot);
  });
  const progress = () => socket.emit("message", `<Run|MPos:60,70,0|WCO:50,50,0|SD:50.00,${prefix}/art.gcode>`);
  const idle = () => socket.emit("message", "<Idle|MPos:60,70,0|WCO:50,50,0>");
  const commands = () => socket.sent.filter((command: string) => command !== "?" && !command.startsWith("$RI="));
  return { client, socket, controller, report, start, progress, idle, commands, started: () => started };
}

describe("long-running plot transport and safe-return lifecycle", () => {
  it.each(["sd", "fs"] as const)("keeps a %s plot armed beyond HTTP timeout and drains its deferred Run reply before lifting", async (filesystem) => {
    const f = await fixture(filesystem);
    f.progress();
    await flush();
    expect(f.started()).toBe(true);
    await f.start;

    // Modern firmware defers the Run parser ACK until file EOF. The old HTTP
    // path timed out after ten seconds and cancelled the completion monitor.
    await vi.advanceTimersByTimeAsync(30_000);
    f.progress();
    f.socket.emit("message", "[MSG:INFO: Job output channel webclient closed; the job continues]");
    f.idle();
    await flush();
    expect(f.commands()).toEqual([`${filesystem === "sd" ? "$SD" : "$LocalFS"}/Run=/art.gcode\n`]);

    // This ACK belongs to the original Run command. It must never be mistaken
    // for acknowledgement of the first safety command that has not been sent.
    f.socket.emit("message", "ok");
    await flush();
    expect(f.commands().at(-1)).toBe("G90 G21 G94\n");
    expect(f.commands()).toHaveLength(2);

    f.socket.emit("message", "ok"); await flush();
    expect(f.commands().at(-1)).toBe("M3 S0\n");
    f.socket.emit("message", "ok"); await flush();
    expect(f.commands().at(-1)).toBe("G4 P0.35\n");
    f.socket.emit("message", "ok"); await flush();
    expect(f.commands().at(-1)).toBe("G90 G21 G94 G1 X0 Y0 F2100\n");
    f.socket.emit("message", "ok"); await flush();
    f.socket.emit("message", "<Idle|MPos:50,50,0|WCO:50,50,0>");
    await flush();

    expect(f.commands()).toEqual([
      `${filesystem === "sd" ? "$SD" : "$LocalFS"}/Run=/art.gcode\n`,
      "G90 G21 G94\n", "M3 S0\n", "G4 P0.35\n", "G90 G21 G94 G1 X0 Y0 F2100\n",
    ]);
    expect(f.report).toHaveBeenCalledWith(expect.stringContaining("Safe plot return complete"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["pause", "cancel"] as const)("never sends a queued return if %s happens while the deferred Run ACK is pending", async (action) => {
    const f = await fixture();
    f.progress(); await flush(); await f.start;
    f.idle(); await flush();
    f.controller[action]();
    f.socket.emit("message", "ok");
    await flush();
    expect(f.commands()).toEqual(["$SD/Run=/art.gcode\n"]);
    expect(f.report).not.toHaveBeenCalledWith(expect.stringContaining("return to work origin queued"));
  });

  it("does not return after a delayed Run error, even if prior file progress looked valid", async () => {
    const f = await fixture();
    f.progress(); await flush(); await f.start;
    f.idle(); await flush();
    f.socket.emit("message", "error:20");
    await flush();
    f.idle(); await flush();
    expect(f.commands()).toEqual(["$SD/Run=/art.gcode\n"]);
  });

  it("does not return when the socket disconnects after start was confirmed", async () => {
    const f = await fixture();
    f.progress(); await flush(); await f.start;
    f.socket.emit("close", 1006, "connection lost");
    f.socket.emit("message", "ok");
    f.idle(); await flush();
    expect(f.commands()).toEqual(["$SD/Run=/art.gcode\n"]);
  });
});
