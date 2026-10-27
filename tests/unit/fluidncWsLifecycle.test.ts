import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  disconnectFluidNCWebSocket,
  killFluidNCWebSocket,
  openFluidNCWebSocket,
  scheduleFluidNCReconnect,
  type FluidNCWebSocketState,
} from "../../src/machine/fluidnc/transport/wsLifecycle";

const wsCapture = vi.hoisted(() => ({
  instances: [] as Array<{
    url: string;
    readyState: number;
    send: ReturnType<typeof vi.fn>;
    terminate: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    emit: (event: string, ...args: unknown[]) => boolean;
    on: (event: string, listener: (...args: unknown[]) => void) => void;
  }>,
}));

vi.mock("ws", () => {
   
  const { EventEmitter } = require("events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    url: string;
    send = vi.fn();
    terminate = vi.fn();
    close = vi.fn();

    constructor(url: string) {
      super();
      this.url = url;
      wsCapture.instances.push(
        this as unknown as (typeof wsCapture.instances)[0],
      );
    }
  }

  return { WebSocket: MockWebSocket };
});

function createState(): FluidNCWebSocketState {
  return {
    ws: null,
    wsReconnectTimer: null,
    wsStatusTimer: null,
    wsHost: "192.168.1.100",
    wsPort: 80,
    wsRetryDelay: 3000,
    wsEnabled: true,
    wsGeneration: 0,
  };
}

function lastWs() {
  return wsCapture.instances[wsCapture.instances.length - 1];
}

function createHandlers() {
  return {
    parseStatus: vi.fn().mockReturnValue({ state: "Idle" }),
    emitConsole: vi.fn(),
    emitStatus: vi.fn(),
    emitPing: vi.fn(),
    scheduleReconnect: vi.fn(),
    setWsPort: vi.fn(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  wsCapture.instances.length = 0;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("FluidNC WebSocket lifecycle", () => {
  it("opens a socket, emits connection output, and requests status updates", () => {
    const state = createState();
    const emitConsole = vi.fn();

    openFluidNCWebSocket(state, {
      parseStatus: vi.fn(),
      emitConsole,
      emitStatus: vi.fn(),
      emitPing: vi.fn(),
      scheduleReconnect: vi.fn(),
      setWsPort: vi.fn(),
    });

    lastWs().emit("open");

    expect(lastWs().url).toBe(
      "ws://192.168.1.100:80/?independent_session=1",
    );
    expect(emitConsole).toHaveBeenCalledWith(
      "[terraForge] WebSocket connected",
    );
    expect(lastWs().send.mock.calls).toEqual([["$RI=500\n"], ["?"]]);
    expect(state.wsRetryDelay).toBe(3000);
  });

  it("receives initial idle status from the explicit query without waiting for an interval", () => {
    const state = createState();
    const status = { state: "Idle", mpos: { x: 0, y: 0, z: 0 } };
    const rawStatus = "<Idle|MPos:0,0,0|FS:0,0>";
    const emitStatus = vi.fn();
    const parseStatus = vi.fn().mockReturnValue(status);

    openFluidNCWebSocket(state, {
      parseStatus,
      emitConsole: vi.fn(),
      emitStatus,
      emitPing: vi.fn(),
      scheduleReconnect: vi.fn(),
      setWsPort: vi.fn(),
    });
    const socket = lastWs();
    socket.send.mockImplementation((command: string) => {
      if (command === "?") socket.emit("message", rawStatus);
    });

    socket.emit("open");

    expect(parseStatus).toHaveBeenCalledExactlyOnceWith(rawStatus);
    expect(emitStatus).toHaveBeenCalledExactlyOnceWith(status);
  });

  it("does not request status from a socket whose connection was superseded", () => {
    const state = createState();
    openFluidNCWebSocket(state, {
      parseStatus: vi.fn(),
      emitConsole: vi.fn(),
      emitStatus: vi.fn(),
      emitPing: vi.fn(),
      scheduleReconnect: vi.fn(),
      setWsPort: vi.fn(),
    });
    const socket = lastWs();
    state.wsGeneration++;

    socket.emit("open");

    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("queries a stale status stream at most twice per second using only realtime '?'", () => {
    const state = createState();
    openFluidNCWebSocket(state, createHandlers());
    const socket = lastWs();
    socket.emit("open");
    socket.send.mockClear();

    vi.advanceTimersByTime(999);
    expect(socket.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.send.mock.calls).toEqual([["?"]]);
    vi.advanceTimersByTime(1500);
    expect(socket.send.mock.calls).toEqual([["?"], ["?"], ["?"], ["?"]]);
  });

  it("does not poll while pushed status stays current and resumes after it becomes stale", () => {
    const state = createState();
    openFluidNCWebSocket(state, createHandlers());
    const socket = lastWs();
    socket.emit("open");
    socket.send.mockClear();

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(500);
      socket.emit("message", "ok\n<Run|MPos:1,2,3>\n");
    }
    expect(socket.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(999);
    expect(socket.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.send).toHaveBeenCalledExactlyOnceWith("?");

    socket.emit("message", "<Hold:0|MPos:1,2,3>");
    vi.advanceTimersByTime(500);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it.each(["disconnect", "kill", "close", "generation", "not-open"])(
    "stops stale-status polling after %s",
    (action) => {
      const state = createState();
      openFluidNCWebSocket(state, createHandlers());
      const socket = lastWs();
      socket.emit("open");
      socket.send.mockClear();

      switch (action) {
        case "disconnect":
          disconnectFluidNCWebSocket(state, { onFirmwareReset: vi.fn() });
          break;
        case "kill":
          killFluidNCWebSocket(state);
          break;
        case "close":
          socket.emit("close", 1000, "");
          break;
        case "generation":
          state.wsGeneration++;
          break;
        case "not-open":
          socket.readyState = 3;
          break;
      }

      vi.advanceTimersByTime(5000);

      expect(socket.send).not.toHaveBeenCalled();
      expect(state.wsStatusTimer).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("replaces the polling timer and ignores a close event from the old socket", () => {
    const state = createState();
    openFluidNCWebSocket(state, createHandlers());
    const previous = lastWs();
    previous.emit("open");
    previous.send.mockClear();

    openFluidNCWebSocket(state, createHandlers());
    const current = lastWs();
    current.emit("open");
    current.send.mockClear();
    previous.emit("close", 1000, "");

    vi.advanceTimersByTime(1000);

    expect(previous.send).not.toHaveBeenCalled();
    expect(current.send).toHaveBeenCalledExactlyOnceWith("?");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("contains polling send errors and leaves reconnect handling to the socket", () => {
    const state = createState();
    openFluidNCWebSocket(state, createHandlers());
    const socket = lastWs();
    socket.emit("open");
    socket.send.mockReset().mockImplementation(() => {
      throw new Error("Socket closing");
    });

    expect(() => vi.advanceTimersByTime(1500)).not.toThrow();
    expect(socket.send.mock.calls).toEqual([["?"], ["?"]]);
  });

  it("parses status and suppresses ping/session noise", () => {
    const state = createState();
    const parseStatus = vi.fn().mockReturnValue({ state: "Idle" });
    const emitStatus = vi.fn();
    const emitPing = vi.fn();
    const emitConsole = vi.fn();

    openFluidNCWebSocket(state, {
      parseStatus,
      emitConsole,
      emitStatus,
      emitPing,
      scheduleReconnect: vi.fn(),
      setWsPort: vi.fn(),
    });

    lastWs().emit("message", "<Idle|MPos:0.000,0.000,0.000>");
    lastWs().emit("message", "PING");
    lastWs().emit("message", "ACTIVE_ID:session1");

    expect(parseStatus).toHaveBeenCalledWith("<Idle|MPos:0.000,0.000,0.000>");
    expect(emitStatus).toHaveBeenCalledWith({ state: "Idle" });
    expect(emitPing).toHaveBeenCalledTimes(1);
    expect(emitConsole).not.toHaveBeenCalled();
  });

  it("routes status from a batched FluidNC 4.1.1 startup frame", () => {
    const state = createState();
    const status = { state: "Idle" };
    const parseStatus = vi.fn().mockReturnValue(status);
    const emitStatus = vi.fn();
    const emitPing = vi.fn();
    const emitConsole = vi.fn();
    const rawStatus = "<Idle|MPos:0,0,10|FS:0,0|WCO:0,0,0>";

    openFluidNCWebSocket(state, {
      parseStatus,
      emitConsole,
      emitStatus,
      emitPing,
      scheduleReconnect: vi.fn(),
      setWsPort: vi.fn(),
    });
    lastWs().emit(
      "message",
      Buffer.from(
        `[MSG:INFO: websocket auto report interval set to 500 ms]\nok\n${rawStatus}\n[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]\n`,
      ),
    );

    expect(parseStatus).toHaveBeenCalledExactlyOnceWith(rawStatus);
    expect(emitStatus).toHaveBeenCalledExactlyOnceWith(status);
    expect(emitConsole.mock.calls).toEqual([
      ["[MSG:INFO: websocket auto report interval set to 500 ms]"],
      ["ok"],
      ["[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]"],
    ]);
    expect(emitPing).not.toHaveBeenCalled();
  });

  it("routes every line in a mixed CRLF frame and suppresses session identifiers", () => {
    const state = createState();
    const parseStatus = vi.fn().mockReturnValue({ state: "Run" });
    const emitStatus = vi.fn();
    const emitPing = vi.fn();
    const emitConsole = vi.fn();

    openFluidNCWebSocket(state, {
      parseStatus,
      emitConsole,
      emitStatus,
      emitPing,
      scheduleReconnect: vi.fn(),
      setWsPort: vi.fn(),
    });
    lastWs().emit(
      "message",
      "\r\ncurrentID:1\r\nCURRENT_ID:1\r\nactiveID:1\r\nACTIVE_ID:1\r\nPING:60000:60000\r\n<Run|MPos:1,2,3>\r\nmessage\r\n\r\n",
    );

    expect(parseStatus).toHaveBeenCalledExactlyOnceWith("<Run|MPos:1,2,3>");
    expect(emitStatus).toHaveBeenCalledTimes(1);
    expect(emitPing).toHaveBeenCalledTimes(1);
    expect(emitConsole).toHaveBeenCalledExactlyOnceWith("message");
  });

  it("switches to port 81 when the server answers HTTP instead of upgrading", () => {
    const state = createState();
    const setWsPort = vi.fn((port: number) => {
      state.wsPort = port;
    });
    const emitConsole = vi.fn();

    openFluidNCWebSocket(state, {
      parseStatus: vi.fn(),
      emitConsole,
      emitStatus: vi.fn(),
      emitPing: vi.fn(),
      scheduleReconnect: vi.fn(),
      setWsPort,
    });

    lastWs().emit("error", new Error("Unexpected server response: 200"));

    expect(setWsPort).toHaveBeenCalledWith(81);
    expect(state.wsPort).toBe(81);
    expect(emitConsole).toHaveBeenCalledWith(
      "[terraForge] WS got HTTP response instead of 101 Upgrade on port 80 — switching to port 81 (FluidNC 3.x)",
    );
  });

  it("schedules reconnects with exponential backoff", () => {
    vi.useFakeTimers();
    const state = createState();
    const reopen = vi.fn();

    scheduleFluidNCReconnect(state, 0, reopen);
    vi.advanceTimersByTime(3000);

    expect(reopen).toHaveBeenCalledTimes(1);
    expect(state.wsRetryDelay).toBe(6000);
  });

  it("disconnects and kills sockets safely", () => {
    vi.useFakeTimers();
    const state = createState();
    state.wsReconnectTimer = setTimeout(() => {}, 60000);
    state.ws = {
      close: vi.fn(),
      terminate: vi.fn(),
    } as unknown as FluidNCWebSocketState["ws"];

    const onFirmwareReset = vi.fn();
    disconnectFluidNCWebSocket(state, { onFirmwareReset });

    expect(onFirmwareReset).toHaveBeenCalledTimes(1);
    expect(state.wsReconnectTimer).toBeNull();
    expect(state.ws).toBeNull();

    state.wsEnabled = true;
    state.wsReconnectTimer = setTimeout(() => {}, 60000);
    state.ws = {
      terminate: vi.fn(),
    } as unknown as FluidNCWebSocketState["ws"];

    killFluidNCWebSocket(state);

    expect(state.wsReconnectTimer).toBeNull();
    expect(state.ws).toBeNull();
  });
});
