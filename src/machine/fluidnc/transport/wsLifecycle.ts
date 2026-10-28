import { WebSocket } from "ws";
import type { MachineStatus } from "../../../types";

export interface FluidNCWebSocketState {
  ws: WebSocket | null;
  wsReconnectTimer: NodeJS.Timeout | null;
  wsStatusTimer: NodeJS.Timeout | null;
  wsHost: string;
  wsPort: number;
  wsRetryDelay: number;
  wsEnabled: boolean;
  wsGeneration: number;
}

interface DisconnectHandlers {
  onFirmwareReset: () => void;
}

interface OpenHandlers {
  onDisconnected?: () => void;
  parseStatus: (raw: string) => MachineStatus;
  emitConsole: (message: string) => void;
  emitStatus: (status: MachineStatus) => void;
  emitPing: () => void;
  scheduleReconnect: (generation: number) => void;
  setWsPort: (port: number) => void;
}

function clearStatusTimer(state: FluidNCWebSocketState): void {
  if (state.wsStatusTimer) {
    clearInterval(state.wsStatusTimer);
    state.wsStatusTimer = null;
  }
}

export function disconnectFluidNCWebSocket(
  state: FluidNCWebSocketState,
  handlers: DisconnectHandlers,
): void {
  state.wsEnabled = false;
  state.wsGeneration++;
  clearStatusTimer(state);
  if (state.wsReconnectTimer) {
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
  }
  if (state.ws) {
    try {
      state.ws.close(1000);
    } catch {
      // already closed
    }
    state.ws = null;
  }
  handlers.onFirmwareReset();
}

export function killFluidNCWebSocket(state: FluidNCWebSocketState): void {
  state.wsEnabled = false;
  state.wsGeneration++;
  clearStatusTimer(state);
  if (state.wsReconnectTimer) {
    clearTimeout(state.wsReconnectTimer);
    state.wsReconnectTimer = null;
  }
  if (state.ws) {
    try {
      state.ws.terminate();
    } catch {
      // already dead
    }
    state.ws = null;
  }
}

export function scheduleFluidNCReconnect(
  state: FluidNCWebSocketState,
  generation: number,
  reopen: () => void,
): void {
  if (!state.wsEnabled || generation !== state.wsGeneration) return;
  state.wsReconnectTimer = setTimeout(() => reopen(), state.wsRetryDelay);
  state.wsRetryDelay = Math.min(state.wsRetryDelay * 2, 60_000);
}

export function openFluidNCWebSocket(
  state: FluidNCWebSocketState,
  handlers: OpenHandlers,
): void {
  if (!state.wsEnabled) return;

  clearStatusTimer(state);

  if (state.ws) {
    try {
      state.ws.terminate();
    } catch {
      // ignore stale socket failures
    }
    state.ws = null;
  }

  const generation = ++state.wsGeneration;
  // `independent_session` gives this socket a FluidNC session of its own.
  // FluidNC 4.0.4+ closes older websockets in the same session whenever a new
  // one connects ("the newest websocket for a session wins", WSChannel.cpp),
  // and a client without a sessionId cookie -- this one, or a pendant such as
  // terraDial -- lands in the shared empty session. Two such clients then
  // close each other's sockets on every reconnect, every few seconds. With
  // the flag the session is this socket's own IP:port. 3.x ignores it.
  const ws = new WebSocket(
    `ws://${state.wsHost}:${state.wsPort}/?independent_session=1`,
  );
  state.ws = ws;
  let lastStatusAt = 0;

  ws.on("open", () => {
    if (generation !== state.wsGeneration) {
      ws.terminate();
      return;
    }
    state.wsRetryDelay = 3000;
    lastStatusAt = Date.now();
    handlers.emitConsole("[terraForge] WebSocket connected");
    try {
      ws.send("$RI=500\n");
      // Seed the UI with an explicit status report even if the controller is
      // idle and has no periodic state changes to report. '?' is read-only.
      ws.send("?");
    } catch {
      // ignore send errors during startup
    }
    // Some controllers stop pushing status while a job runs. Query only
    // stale streams, at most twice per second, without sending any motion.
    const timer = setInterval(() => {
      if (
        !state.wsEnabled ||
        generation !== state.wsGeneration ||
        state.ws !== ws ||
        ws.readyState !== WebSocket.OPEN
      ) {
        clearInterval(timer);
        if (state.wsStatusTimer === timer) state.wsStatusTimer = null;
        return;
      }
      if (Date.now() - lastStatusAt < 1000) return;
      try {
        ws.send("?");
      } catch {
        // Socket close/error handlers manage reconnects.
      }
    }, 500);
    timer.unref?.();
    state.wsStatusTimer = timer;
  });

  ws.on("message", (raw) => {
    if (generation !== state.wsGeneration) return;
    // FluidNC can batch console output, status and session messages into one
    // frame. Route each line so a console prefix cannot hide a status report.
    for (const line of raw.toString().split(/\r?\n/)) {
      const text = line.trim();
      if (text.startsWith("<")) {
        lastStatusAt = Date.now();
        handlers.emitStatus(handlers.parseStatus(text));
        continue;
      }
      if (text === "PING" || text.startsWith("PING:")) {
        handlers.emitPing();
        continue;
      }
      if (
        text.startsWith("currentID:") ||
        text.startsWith("CURRENT_ID:") ||
        text.startsWith("activeID:") ||
        text.startsWith("ACTIVE_ID:")
      ) {
        continue;
      }
      if (text.length > 0) {
        handlers.emitConsole(text);
      }
    }
  });

  ws.on("close", (_code, reason) => {
    if (generation !== state.wsGeneration) return;
    clearStatusTimer(state);
    handlers.onDisconnected?.();
    const message = reason?.toString() ?? "";
    const is503 = message.includes("503");
    if (!is503 && state.wsRetryDelay <= 3000) {
      handlers.emitConsole("[terraForge] WebSocket disconnected — retrying…");
    }
    handlers.scheduleReconnect(generation);
  });

  ws.on("error", (err) => {
    if (generation !== state.wsGeneration) return;
    handlers.onDisconnected?.();
    const is503 = err.message.includes("503");
    const isHttp200 =
      err.message.includes("200") ||
      /unexpected server response/i.test(err.message);

    if (isHttp200 && state.wsPort !== 81) {
      handlers.emitConsole(
        `[terraForge] WS got HTTP response instead of 101 Upgrade on port ${state.wsPort} — switching to port 81 (FluidNC 3.x)`,
      );
      handlers.setWsPort(81);
      state.wsRetryDelay = 3000;
      return;
    }

    if (!is503) {
      handlers.emitConsole(`[terraForge] WebSocket error: ${err.message}`);
    }
  });
}
