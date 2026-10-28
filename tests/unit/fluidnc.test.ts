import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FluidNCClient } from "../../src/machine/fluidnc";

// ── Mock WebSocket from "ws" ──────────────────────────────────────────────────
// vi.hoisted creates a value accessible in vi.mock factories (they're both
// hoisted before static imports by Vitest).

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
  // EventEmitter must be required inside the factory (hoisted context)

  const { EventEmitter } = require("events");

  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 0;
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

// ── Mock global fetch ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
  // Clear WS instance registry between tests
  wsCapture.instances.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Helper: create a mock Response */
function mockResponse(body: string | object, status = 200): Response {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof body === "string" ? JSON.parse(body) : body),
    headers: new Headers(),
  } as unknown as Response;
}

async function connectedClient(client = new FluidNCClient(), setupAck = true) {
  await client.connectWebSocket("192.168.1.100", 80, 80);
  const socket = wsCapture.instances[wsCapture.instances.length - 1];
  socket.readyState = 1;
  socket.emit("open");
  if (setupAck) socket.emit("message", "ok"); // $RI=500 owns this reply.
  return { client, socket };
}
const flushMicrotasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

describe("FluidNCClient", () => {
  let client: FluidNCClient;

  beforeEach(() => {
    client = new FluidNCClient();
    client.setHost("192.168.1.100", 80);
  });

  // ── getStatus ───────────────────────────────────────────────────────────

  it("parses status through the read-only HTTP realtime query", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse("<Idle|MPos:10.000,20.000,0.000>"),
    );
    const status = await client.getStatus();
    expect(status.state).toBe("Idle");
    expect(status.mpos).toEqual({ x: 10, y: 20, z: 0 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.1.100:80/command?plain=%3F",
      expect.objectContaining({ method: "GET" }),
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const query = new URL(mockFetch.mock.calls[0][0] as string);
    expect([...query.searchParams.entries()]).toEqual([["plain", "?"]]);
    expect(wsCapture.instances).toHaveLength(0);
  });

  it("parses a FluidNC 4.1.1 status response with a trailing newline", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse("<Idle|MPos:0,0,0|FS:0,0|Ov:100,100,100>\n"),
    );

    const status = await client.getStatus();

    expect(status.state).toBe("Idle");
    expect(status.mpos).toEqual({ x: 0, y: 0, z: 0 });
    expect(mockFetch).toHaveBeenCalledExactlyOnceWith(
      "http://192.168.1.100:80/command?plain=%3F",
      expect.objectContaining({ method: "GET" }),
    );
  });

  // ── sendCommand ─────────────────────────────────────────────────────────

  it("sends command via GET commandText for fw 4.x (default)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    const result = await client.sendCommand("G0 X10");
    expect(result).toBe("ok");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/command?commandText="),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("falls back to GET plain query when commandText query fails", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse("", 404))
      .mockResolvedValueOnce(mockResponse("ok"));

    const result = await client.sendCommand("G10 L20 P1 X0 Y0");
    expect(result).toBe("ok");
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toEqual(
      expect.stringContaining("/command?commandText="),
    );
    expect(mockFetch.mock.calls[1][0]).toEqual(
      expect.stringContaining("/command?plain="),
    );
  });

  // ── listFiles ───────────────────────────────────────────────────────────

  it("parses file listing from /files endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        files: [
          { name: "test.gcode", size: 1234 },
          { name: "subdir", size: 0, dir: true },
        ],
        path: "/",
      }),
    );
    const files = await client.listFiles("/");
    expect(files).toHaveLength(2);
    expect(files[0].name).toBe("test.gcode");
    expect(files[0].size).toBe(1234);
    expect(files[0].isDirectory).toBe(false);
    expect(files[1].name).toBe("subdir");
    expect(files[1].isDirectory).toBe(true);
  });

  it("handles empty file list", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse({ files: [], path: "/" }));
    const files = await client.listFiles("/");
    expect(files).toEqual([]);
  });

  // ── listSDFiles ─────────────────────────────────────────────────────────

  it("parses SD file listing from /upload endpoint", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({
        files: [{ name: "job.gcode", size: "5678" }],
        path: "/",
        status: "ok",
      }),
    );
    const files = await client.listSDFiles("/");
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("job.gcode");
  });

  // ── runFile ─────────────────────────────────────────────────────────────

  it.each(["sd", "fs"] as const)("sends one file Run on the live socket for %s", async (filesystem) => {
    const { socket } = await connectedClient(client);
    const run = client.runFile("/job.gcode", filesystem);
    const command = filesystem === "sd" ? "$SD/Run=/job.gcode\n" : "$LocalFS/Run=/job.gcode\n";
    expect(socket.send).toHaveBeenCalledWith(command);
    socket.emit("message", "ok");
    await run;
    expect(mockFetch).not.toHaveBeenCalled();
    client.disconnectWebSocket();
  });

  it("does not transmit a Run command whose Unicode filename would be altered by FluidNC",async()=>{
    await expect(client.runFile("/CMYK Cyan — Cyan_opt.gcode","sd")).rejects.toThrow(/Rename the file/);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ── Error handling ──────────────────────────────────────────────────────

  it("throws on HTTP error from getStatus", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    await expect(client.getStatus()).rejects.toThrow("HTTP 500");
  });

  it("throws on HTTP error from sendCommand", async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse("", 404))
      .mockResolvedValueOnce(mockResponse("", 404));
    await expect(client.sendCommand("test")).rejects.toThrow("HTTP 404");
  });

  // ── setHost ─────────────────────────────────────────────────────────────

  it("constructs correct base URL", async () => {
    client.setHost("myplotter.local", 8080);
    mockFetch.mockResolvedValueOnce(mockResponse("<Idle|MPos:0,0,0>"));
    await client.getStatus();
    expect(mockFetch).toHaveBeenCalledWith(
      "http://myplotter.local:8080/command?plain=%3F",
      expect.any(Object),
    );
  });

  // ── getStatus variants ──────────────────────────────────────────────────

  it("parses Run state with line numbers from getStatus", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse("<Run|MPos:5.000,10.000,0.000|Ln:42,100>"),
    );
    const status = await client.getStatus();
    expect(status.state).toBe("Run");
    expect(status.lineNum).toBe(42);
    expect(status.lineTotal).toBe(100);
  });

  it("parses Hold sub-state from getStatus", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse("<Hold:0|MPos:0.000,0.000,0.000>"),
    );
    const status = await client.getStatus();
    expect(status.state).toBe("Hold");
  });

  it("returns Unknown for unrecognised state", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse("<Banana|MPos:0.000,0.000,0.000>"),
    );
    const status = await client.getStatus();
    expect(status.state).toBe("Unknown");
  });

  // ── sendCommand 3.x ─────────────────────────────────────────────────────

  it("sends command via POST for fw 3.x", async () => {
    // Force fwMajor to 3 by accessing private field
    (client as any).fwMajor = 3;
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    const result = await client.sendCommand("G0 X10");
    expect(result).toBe("ok");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/command"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  // ── listSDFiles error ───────────────────────────────────────────────────

  it("throws on SD card error status from listSDFiles", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse({ status: "SD CARD READER FAILED" }),
    );
    await expect(client.listSDFiles("/")).rejects.toThrow(
      /SD card.*READER FAILED/,
    );
  });

  it("throws on unexpected JSON from listSDFiles", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => "not json",
      json: async () => {
        throw new Error("not json");
      },
      headers: new Headers(),
    } as unknown as Response);
    await expect(client.listSDFiles("/")).rejects.toThrow(
      /unexpected response/i,
    );
  });

  // ── deleteFile ──────────────────────────────────────────────────────────

  it("sends WebDAV DELETE to /sd/ for SD delete (4.x)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.deleteFile("/old.gcode", "sd");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sd/old.gcode"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends delete via REST DELETE for localFS (4.x)", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.deleteFile("/myfile.txt", "fs");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/localfs/myfile.txt"),
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("sends REST GET /upload?action=delete for SD delete (3.x)", async () => {
    (client as any).fwMajor = 3;
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.deleteFile("/job.gcode", "sd");
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/upload?");
    expect(url).toContain("action=delete");
    expect(url).toContain("filename=job.gcode");
    // path param should be the directory (%2F for root)
    expect(url).toContain("path=%2F");
    expect(mockFetch.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("sends $LocalFS/Delete command for 3.x firmware", async () => {
    (client as any).fwMajor = 3;
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.deleteFile("/config.yaml", "fs");
    // 3.x uses POST /command with commandText body
    const body = decodeURIComponent(mockFetch.mock.calls[0][1]?.body as string);
    expect(body).toContain("$LocalFS/Delete=/config.yaml");
  });

  // ── Job control ─────────────────────────────────────────────────────────

  it("pauseJob sends '!' realtime via sendCommand fallback", async () => {
    // No WS connected → falls back to HTTP sendCommand
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.pauseJob();
    expect(mockFetch).toHaveBeenCalled();
  });

  it("resumeJob sends '~' realtime via sendCommand fallback", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.resumeJob();
    expect(mockFetch).toHaveBeenCalled();
  });

  it("abortJob sends 0x18 realtime via sendCommand fallback", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.abortJob();
    expect(mockFetch).toHaveBeenCalled();
  });

  it.each(["pauseJob", "resumeJob", "abortJob"] as const)(
    "%s waits for the HTTP fallback and reports failures",
    async (action) => {
      let rejectCommand!: (error: Error) => void;
      vi.spyOn(client, "sendCommand").mockReturnValue(
        new Promise<string>((_resolve, reject) => {
          rejectCommand = reject;
        }),
      );
      const settled = vi.fn();
      const result = client[action]().then(settled, (error: Error) => error);

      await Promise.resolve();
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();

      const error = new Error("Controller unreachable");
      rejectCommand(error);
      await expect(result).resolves.toBe(error);
      expect(settled).not.toHaveBeenCalled();
    },
  );

  // ── fetchFileText ───────────────────────────────────────────────────────

  it("fetches SD card file text via /sd/ prefix", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("G0 X10 Y10\nG1 X20 Y20"));
    const text = await client.fetchFileText("/test.gcode", "sdcard");
    expect(text).toContain("G0 X10 Y10");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/sd/test.gcode"),
      expect.any(Object),
    );
  });

  it("fetches LocalFS file text via /localfs/ prefix", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("config data"));
    const text = await client.fetchFileText("/config.yaml", "internal");
    expect(text).toBe("config data");
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/localfs/config.yaml"),
      expect.any(Object),
    );
  });

  // ── probeFirmwareVersion ────────────────────────────────────────────────

  it("parses v4.x from [ESP800] response", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        "FW version: FluidNC v4.0.1 # webcommunication: Sync: 80 # ...",
      ),
    );
    const result = await client.probeFirmwareVersion();
    expect(result).not.toBeNull();
    expect(result!.major).toBe(4);
    expect(result!.version).toBe("4.0.1");
    expect(result!.wsPort).toBe(80);
  });

  it("parses v3.x from [ESP800] response with port 81", async () => {
    mockFetch.mockResolvedValueOnce(
      mockResponse(
        "FW version: FluidNC v3.9.7 # webcommunication: Sync: 81 # ...",
      ),
    );
    const result = await client.probeFirmwareVersion();
    expect(result!.major).toBe(3);
    expect(result!.wsPort).toBe(81);
  });

  it("falls back to strategy 2 (POST) when strategy 1 fails", async () => {
    // Strategy 1 fails
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    // Strategy 2 succeeds
    mockFetch.mockResolvedValueOnce(
      mockResponse("FW version: FluidNC v4.1.0 # webcommunication: Sync: 80"),
    );
    const result = await client.probeFirmwareVersion();
    expect(result!.major).toBe(4);
  });

  it("falls back to strategy 3 ($I) when strategies 1+2 fail", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    mockFetch.mockResolvedValueOnce(
      mockResponse("[VER:3.9.7.FluidNC v3.9.7:]"),
    );
    const result = await client.probeFirmwareVersion();
    expect(result!.major).toBe(3);
    expect(result!.wsPort).toBeNull(); // no webcommunication field in $I
  });

  it("returns null when all probe strategies fail", async () => {
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    const result = await client.probeFirmwareVersion();
    expect(result).toBeNull();
  });

  it("emits probe failure message when strategy throws non-Error", async () => {
    const consoleEvents: string[] = [];
    client.on("console", (msg) => consoleEvents.push(msg));

    mockFetch.mockRejectedValueOnce("network-down");
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));
    mockFetch.mockResolvedValueOnce(mockResponse("", 500));

    const result = await client.probeFirmwareVersion();
    expect(result).toBeNull();
    expect(consoleEvents.some((msg) => msg.includes("network-down"))).toBe(
      true,
    );
  });

  it("returns null when responses contain no version info", async () => {
    // All succeed but body has no version
    mockFetch.mockResolvedValueOnce(mockResponse("no version here"));
    mockFetch.mockResolvedValueOnce(mockResponse("still nothing"));
    mockFetch.mockResolvedValueOnce(mockResponse("nope"));
    const result = await client.probeFirmwareVersion();
    expect(result).toBeNull();
  });

  // ── disconnectWebSocket ─────────────────────────────────────────────────

  it("disconnectWebSocket resets fwMajor to null", () => {
    (client as any).fwMajor = 4;
    client.disconnectWebSocket();
    expect((client as any).fwMajor).toBeNull();
  });

  it("disconnectWebSocket clears reconnect timer and closes ws", () => {
    vi.useFakeTimers();
    try {
      (client as any).wsReconnectTimer = setTimeout(() => {}, 60_000);
      const mockWs = { close: vi.fn() };
      (client as any).ws = mockWs;

      client.disconnectWebSocket();

      expect((client as any).wsReconnectTimer).toBeNull();
      expect(mockWs.close).toHaveBeenCalledWith(1000);
      expect((client as any).ws).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("disconnectWebSocket tolerates ws close errors", () => {
    const mockWs = {
      close: vi.fn(() => {
        throw new Error("already closed");
      }),
    };
    (client as any).ws = mockWs;

    expect(() => client.disconnectWebSocket()).not.toThrow();
    expect((client as any).ws).toBeNull();
  });

  // ── Generation counter ──────────────────────────────────────────────────

  it("increments wsGeneration on disconnectWebSocket", () => {
    const gen1 = (client as any).wsGeneration;
    client.disconnectWebSocket();
    const gen2 = (client as any).wsGeneration;
    expect(gen2).toBeGreaterThan(gen1);
  });

  it("killWs clears timer and terminates socket", () => {
    vi.useFakeTimers();
    try {
      (client as any).wsReconnectTimer = setTimeout(() => {}, 60_000);
      const mockWs = { terminate: vi.fn() };
      (client as any).ws = mockWs;

      (client as any).killWs();

      expect((client as any).wsReconnectTimer).toBeNull();
      expect(mockWs.terminate).toHaveBeenCalledTimes(1);
      expect((client as any).ws).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("killWs tolerates terminate errors", () => {
    const mockWs = {
      terminate: vi.fn(() => {
        throw new Error("already dead");
      }),
    };
    (client as any).ws = mockWs;

    expect(() => (client as any).killWs()).not.toThrow();
    expect((client as any).ws).toBeNull();
  });

  // ── sendRealtime via open WebSocket (line 196) ──────────────────────────

  it("pauseJob sends '!' directly via WebSocket when WS is open", async () => {
    const mockWs = { readyState: 1 /* OPEN */, send: vi.fn() };
    (client as any).ws = mockWs;
    await client.pauseJob();
    expect(mockWs.send).toHaveBeenCalledWith("!");
    (client as any).ws = null;
  });

  it("resumeJob sends '~' directly via WebSocket when WS is open", async () => {
    const mockWs = { readyState: 1, send: vi.fn() };
    (client as any).ws = mockWs;
    await client.resumeJob();
    expect(mockWs.send).toHaveBeenCalledWith("~");
    (client as any).ws = null;
  });

  it("abortJob sends 0x18 directly via WebSocket when WS is open", async () => {
    const mockWs = { readyState: 1, send: vi.fn() };
    (client as any).ws = mockWs;
    await client.abortJob();
    expect(mockWs.send).toHaveBeenCalledWith("\x18");
    (client as any).ws = null;
  });

  // ── resolveHost DNS fallback (lines 49-53) ─────────────────────────────

  it("resolveHost returns the original hostname when DNS lookup fails", async () => {
    // ".invalid" TLD is RFC-guaranteed to never resolve
    const result = await (client as any).resolveHost("bogus.host.invalid");
    expect(result).toBe("bogus.host.invalid");
  });

  it("resolveHost returns resolved address on successful lookup", async () => {
    const result = await (client as any).resolveHost("127.0.0.1");
    expect(result).toBe("127.0.0.1");
  });

  // ── connectWebSocket explicit wsPort override (lines 534-537) ──────────

  it("connectWebSocket with wsPort override skips firmware probe", async () => {
    const openWsSpy = vi
      .spyOn(client as any, "openWs")
      .mockImplementation(() => {});
    const probeSpy = vi
      .spyOn(client as any, "probeFirmwareVersion")
      .mockResolvedValue(null);

    await client.connectWebSocket("192.168.1.10", 80, 8888);

    expect(probeSpy).not.toHaveBeenCalled();
    expect((client as any).wsPort).toBe(8888);
    expect(openWsSpy).toHaveBeenCalled();
    openWsSpy.mockRestore();
    probeSpy.mockRestore();
  });

  // ── connectWebSocket without wsPort, probe succeeds ────────────────────

  it("connectWebSocket without wsPort uses firmware-probed WS port", async () => {
    const openWsSpy = vi
      .spyOn(client as any, "openWs")
      .mockImplementation(() => {});
    const resolveHostSpy = vi
      .spyOn(client as any, "resolveHost")
      .mockResolvedValue("192.168.1.10");
    const probeSpy = vi
      .spyOn(client as any, "probeFirmwareVersion")
      .mockResolvedValue({ major: 4, version: "4.0.1", wsPort: 80 });

    await client.connectWebSocket("myplotter.local", 80);

    expect(probeSpy).toHaveBeenCalled();
    expect((client as any).fwMajor).toBe(4);
    expect((client as any).wsPort).toBe(80);
    openWsSpy.mockRestore();
    resolveHostSpy.mockRestore();
    probeSpy.mockRestore();
  });

  it("connectWebSocket updates REST base URL to resolved IP for subsequent commands", async () => {
    const openWsSpy = vi
      .spyOn(client as any, "openWs")
      .mockImplementation(() => {});
    const resolveHostSpy = vi
      .spyOn(client as any, "resolveHost")
      .mockResolvedValue("192.168.1.10");
    const probeSpy = vi
      .spyOn(client as any, "probeFirmwareVersion")
      .mockResolvedValue({ major: 4, version: "4.0.1", wsPort: 80 });

    await client.connectWebSocket("myplotter.local", 80);

    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(mockResponse("ok"));
    await client.sendCommand("$H");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("http://192.168.1.10:80/command?commandText="),
      expect.objectContaining({ method: "GET" }),
    );

    openWsSpy.mockRestore();
    resolveHostSpy.mockRestore();
    probeSpy.mockRestore();
  });

  it("connectWebSocket emits firmware event on probe success", async () => {
    const openWsSpy = vi
      .spyOn(client as any, "openWs")
      .mockImplementation(() => {});
    vi.spyOn(client as any, "resolveHost").mockResolvedValue("192.168.1.10");
    vi.spyOn(client as any, "probeFirmwareVersion").mockResolvedValue({
      major: 4,
      version: "4.0.1",
      wsPort: 80,
    });

    const fwEvents: (string | null)[] = [];
    client.on("firmware", (info) => fwEvents.push(info));

    await client.connectWebSocket("myplotter.local", 80);

    expect(fwEvents).toContain("FluidNC v4.0.1");
    openWsSpy.mockRestore();
  });

  it("connectWebSocket uses version heuristic when probe returns null wsPort", async () => {
    const openWsSpy = vi
      .spyOn(client as any, "openWs")
      .mockImplementation(() => {});
    vi.spyOn(client as any, "resolveHost").mockResolvedValue("192.168.1.5");
    vi.spyOn(client as any, "probeFirmwareVersion").mockResolvedValue({
      major: 3,
      version: "3.9.7",
      wsPort: null, // no webcommunication field
    });

    await client.connectWebSocket("oldplotter.local", 80);

    // major < 4 → heuristic wsPort = 81
    expect((client as any).wsPort).toBe(81);
    openWsSpy.mockRestore();
  });

  // ── connectWebSocket without wsPort, probe fails ────────────────────────

  it("connectWebSocket defaults to HTTP port when probe fails", async () => {
    const openWsSpy = vi
      .spyOn(client as any, "openWs")
      .mockImplementation(() => {});
    vi.spyOn(client as any, "resolveHost").mockResolvedValue("192.168.1.20");
    vi.spyOn(client as any, "probeFirmwareVersion").mockResolvedValue(null);

    const fwEvents: (string | null)[] = [];
    client.on("firmware", (info) => fwEvents.push(info));

    await client.connectWebSocket("unknown.local", 80);

    expect((client as any).wsPort).toBe(80);
    expect((client as any).fwInfo).toBeNull();
    expect(fwEvents).toContain(null);
    openWsSpy.mockRestore();
  });

  // ── openWs WebSocket event handlers ────────────────────────────────────

  describe("openWs event handlers", () => {
    beforeEach(() => {
      client = new FluidNCClient();
      client.setHost("192.168.1.100", 80);
      (client as any).wsEnabled = true;
    });

    afterEach(() => {
      // Prevent reconnect timers from leaking
      (client as any).wsEnabled = false;
    });

    function lastWs() {
      return wsCapture.instances[wsCapture.instances.length - 1];
    }

    it("'open' event emits console message and sends $RI=500", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("open");

      expect(consoleEvents).toContain("[terraForge] WebSocket connected");
      expect(lastWs().send).toHaveBeenCalledWith("$RI=500\n");
    });

    it("'message' with status string emits status event", () => {
      const statusEvents: unknown[] = [];
      client.on("status", (s) => statusEvents.push(s));

      (client as any).openWs();
      lastWs().emit("message", "<Idle|MPos:1.000,2.000,0.000>");

      expect(statusEvents).toHaveLength(1);
      expect((statusEvents[0] as any).state).toBe("Idle");
    });

    it("'message' with PING emits ping event and suppresses console", () => {
      const pingEvents: unknown[] = [];
      const consoleEvents: string[] = [];
      client.on("ping", () => pingEvents.push(true));
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("message", "PING");

      expect(pingEvents).toHaveLength(1);
      expect(consoleEvents).toHaveLength(0);
    });

    it("'message' with PING:<...> also emits ping and suppresses console", () => {
      const pingEvents: unknown[] = [];
      client.on("ping", () => pingEvents.push(true));

      (client as any).openWs();
      lastWs().emit("message", "PING:60000:60000");

      expect(pingEvents).toHaveLength(1);
    });

    it("'message' with currentID: suppresses console output", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("message", "currentID:12345");

      expect(consoleEvents).toHaveLength(0);
    });

    it("'message' with ACTIVE_ID: suppresses console output", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("message", "ACTIVE_ID:session1");

      expect(consoleEvents).toHaveLength(0);
    });

    it("'message' with regular text emits console event", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("message", "ok");

      expect(consoleEvents).toContain("ok");
    });

    it("'close' event schedules reconnect", () => {
      vi.useFakeTimers();
      const openWsSpy = vi.spyOn(client as any, "openWs");

      (client as any).openWs();
      (client as any).wsEnabled = true; // keep reconnect loop alive
      lastWs().emit("close", 1006, Buffer.from(""));

      vi.advanceTimersByTime(5000);
      // openWs should have been called again via scheduleReconnect
      expect(openWsSpy).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it("'error' with 503 does not emit console message", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("error", new Error("HTTP 503 Bad Gateway"));

      // Only WS-internal console messages (none for 503)
      expect(consoleEvents.some((m) => !m.startsWith("[terraForge]"))).toBe(
        false,
      );
    });

    it("'error' with HTTP 200 switches wsPort to 81", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).wsPort = 80;
      (client as any).openWs();
      lastWs().emit("error", new Error("Unexpected server response: 200"));

      expect((client as any).wsPort).toBe(81);
      expect(consoleEvents.some((m) => m.includes("port 81"))).toBe(true);
    });

    it("'error' with non-503 non-HTTP200 emits console error message", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      lastWs().emit("error", new Error("ECONNREFUSED"));

      expect(consoleEvents.some((m) => m.includes("WebSocket error"))).toBe(
        true,
      );
    });

    it("stale-generation open event is ignored", () => {
      const consoleEvents: string[] = [];
      client.on("console", (msg) => consoleEvents.push(msg));

      (client as any).openWs();
      // Bump generation so the handlers are stale
      (client as any).wsGeneration++;
      lastWs().emit("open");

      expect(consoleEvents).toHaveLength(0);
    });
  });
});

describe("FluidNC confirmed safe-return commands", () => {
  const connected = connectedClient;

  it("waits for parser ok, ignoring status and unrelated output, without using HTTP", async () => {
    const { client, socket } = await connected();
    let done = false;
    const result = client.sendCommandAndWait("M3 S0").then(() => { done = true; });
    expect(socket.send).toHaveBeenCalledWith("M3 S0\n");
    socket.emit("message", "<Idle|WPos:0,0,0>\n[MSG:INFO: hello]");
    await Promise.resolve();
    expect(done).toBe(false);
    socket.emit("message", "ok");
    await result;
    expect(done).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
    client.disconnectWebSocket();
  });

  it.each(["error:20", "ALARM:1", "[MSG:ERR: lift failed]"])("rejects asynchronously on %s", async (line) => {
    const { client, socket } = await connected();
    const result = client.sendCommandAndWait("M3 S0");
    const assertion = expect(result).rejects.toThrow(line);
    socket.emit("message", line);
    await assertion;
    expect(socket.send.mock.calls.filter(([cmd]) => cmd === "M3 S0\n")).toHaveLength(1);
    client.disconnectWebSocket();
  });

  it("rejects on socket loss and never falls back to HTTP or retries motion", async () => {
    const { client, socket } = await connected();
    const result = client.sendCommandAndWait("G4 P0.3");
    const assertion = expect(result).rejects.toThrow("Connection lost");
    socket.emit("close", 1006, "gone");
    await assertion;
    expect(mockFetch).not.toHaveBeenCalled();
    client.disconnectWebSocket();
  });

  it("fails closed when no acknowledgement arrives and rejects concurrent commands", async () => {
    vi.useFakeTimers();
    try {
      const { client } = await connected();
      const result = client.sendCommandAndWait("M3 S0");
      const assertion = expect(result).rejects.toThrow("timed out");
      await expect(client.sendCommandAndWait("G1 X0 Y0")).rejects.toThrow("already pending");
      await vi.advanceTimersByTimeAsync(12_000);
      await assertion;
      expect(mockFetch).not.toHaveBeenCalled();
      client.disconnectWebSocket();
    } finally { vi.useRealTimers(); }
  });

  it("requires a live socket and rejects multiline commands", async () => {
    const client = new FluidNCClient();
    await expect(client.sendCommandAndWait("M3 S0")).rejects.toThrow("Live WebSocket");
    const live = await connected();
    await expect(live.client.sendCommandAndWait("M3 S0\nG1 X0")).rejects.toThrow("one line");
    live.client.disconnectWebSocket();
  });
});


describe("FluidNC single-send file start and deferred Run acknowledgement", () => {
  it("confirms a long job from matching progress without a duration timeout or HTTP retry", async () => {
    vi.useFakeTimers();
    try {
      const {client,socket} = await connectedClient();
      let started = false;
      const run = client.runFile("/art.gcode", "sd").then(() => { started = true; });
      socket.emit("message", "<Run|WPos:10,20,0|SD:0.20,/sd/art.gcode>");
      await run;
      await vi.advanceTimersByTimeAsync(120_000);
      expect(started).toBe(true);
      expect(socket.send.mock.calls.filter(([line]) => line === "$SD/Run=/art.gcode\n")).toHaveLength(1);
      expect(mockFetch).not.toHaveBeenCalled();
      socket.emit("message", "ok");
      client.disconnectWebSocket();
    } finally { vi.useRealTimers(); }
  });

  it("keeps the deferred Run ACK separate from every safe-return command ACK", async () => {
    const {client,socket} = await connectedClient();
    const run = client.runFile("/art.gcode", "sd");
    socket.emit("message", "<Run|SD:30.00,/sd/art.gcode>");
    await run;
    let lifted = false;
    const lift = client.sendCommandAndWait("M3 S0").then(() => { lifted = true; });
    expect(socket.send).not.toHaveBeenCalledWith("M3 S0\n");
    socket.emit("message", "ok"); // Only the file Run's reply.
    await flushMicrotasks();
    expect(socket.send).toHaveBeenCalledWith("M3 S0\n");
    expect(lifted).toBe(false);
    socket.emit("message", "ok");
    await lift;
    expect(lifted).toBe(true);
    client.disconnectWebSocket();
  });

  it.each(["[MSG:INFO: /localfs/tiny.gcode file job succeeded]", "[MSG:DEBUG: /localfs/tiny.gcode job sent]"])(
    "confirms a tiny file from matching EOF: %s", async (eof) => {
      const {client,socket} = await connectedClient();
      const run = client.runFile("/tiny.gcode", "fs");
      socket.emit("message", eof);
      await run;
      socket.emit("message", "ok");
      expect(mockFetch).not.toHaveBeenCalled();
      client.disconnectWebSocket();
    },
  );

  it("never mistakes the $RI setup ACK for the Run ACK", async () => {
    const {client,socket} = await connectedClient(undefined,false);
    const run = client.runFile("/art.gcode", "sd");
    expect(socket.send).not.toHaveBeenCalledWith("$SD/Run=/art.gcode\n");
    socket.emit("message", "ok");
    await flushMicrotasks();
    expect(socket.send).toHaveBeenCalledWith("$SD/Run=/art.gcode\n");
    let started = false; void run.then(() => { started = true; });
    await flushMicrotasks();
    expect(started).toBe(false);
    socket.emit("message", "ok");
    await run;
    client.disconnectWebSocket();
  });

  it("ignores other filenames, transient Idle, and unrelated console messages as start confirmation", async () => {
    const {client,socket} = await connectedClient();
    let started = false;
    const run = client.runFile("/art.gcode", "sd").then(() => { started = true; });
    socket.emit("message", "<Idle|WPos:0,0,0>\n<Run|SD:2.00,/sd/other.gcode>\n[MSG:INFO: /sd/other.gcode file job succeeded]");
    await flushMicrotasks();
    expect(started).toBe(false);
    socket.emit("message", "<Run|SD:2.00,/sd/art.gcode>");
    await run;
    socket.emit("message", "ok");
    client.disconnectWebSocket();
  });

  it.each(["error:8", "ALARM:1", "[MSG:ERR: Cannot open file]"])("rejects failed start %s with one send and no HTTP", async (error) => {
    const {client,socket} = await connectedClient();
    const run = client.runFile("/art.gcode", "sd");
    const assertion = expect(run).rejects.toThrow(error);
    socket.emit("message", error);
    await assertion;
    expect(socket.send.mock.calls.filter(([line]) => line === "$SD/Run=/art.gcode\n")).toHaveLength(1);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(client.listenerCount("status")).toBe(0);
    client.disconnectWebSocket();
  });

  it("aborts a return waiting behind Run ACK without transmitting it, then drains that ACK", async () => {
    const {client,socket} = await connectedClient();
    const run = client.runFile("/art.gcode","sd");
    socket.emit("message", "<Run|SD:2.00,/sd/art.gcode>"); await run;
    const abort = new AbortController();
    const lift = client.sendCommandAndWait("M3 S0",abort.signal);
    const assertion = expect(lift).rejects.toThrow("interrupted before transmission");
    abort.abort(); await assertion;
    socket.emit("message","ok"); await flushMicrotasks();
    expect(socket.send).not.toHaveBeenCalledWith("M3 S0\n");
    const later = client.sendCommandAndWait("G90 G21 G94");
    socket.emit("message","ok"); await later;
    client.disconnectWebSocket();
  });

  it("times out an unconfirmed start without retry and prevents stale ACK reuse until reconnect", async () => {
    vi.useFakeTimers();
    try {
      const {client,socket} = await connectedClient();
      const run = client.runFile("/art.gcode","sd");
      const assertion = expect(run).rejects.toThrow("sent once and may still run");
      await vi.advanceTimersByTimeAsync(12_000); await assertion;
      socket.emit("message","ok");
      await expect(client.sendCommandAndWait("M3 S0")).rejects.toThrow("acknowledgement is uncertain");
      await expect(client.runFile("/art.gcode","sd")).rejects.toThrow("acknowledgement is uncertain");
      expect(socket.send.mock.calls.filter(([line]) => line === "$SD/Run=/art.gcode\n")).toHaveLength(1);
      expect(client.listenerCount("status")).toBe(0);
      expect(mockFetch).not.toHaveBeenCalled();
      client.disconnectWebSocket();
    } finally { vi.useRealTimers(); }
  });

  it("fails closed if EOF arrives but the deferred Run ACK never does", async () => {
    vi.useFakeTimers();
    try {
      const {client,socket} = await connectedClient();
      const run = client.runFile("/art.gcode","sd");
      socket.emit("message","<Run|SD:2.00,/sd/art.gcode>"); await run;
      const lift = client.sendCommandAndWait("M3 S0");
      const assertion = expect(lift).rejects.toThrow("Previous command acknowledgement timed out");
      await vi.advanceTimersByTimeAsync(12_000); await assertion;
      expect(socket.send).not.toHaveBeenCalledWith("M3 S0\n");
      expect(client.listenerCount("status")).toBe(0);
      client.disconnectWebSocket();
    } finally { vi.useRealTimers(); }
  });

  it("rejects a pending start on disconnect and leaves no ACK/status listeners", async () => {
    const {client,socket} = await connectedClient();
    const run = client.runFile("/art.gcode","sd");
    const assertion = expect(run).rejects.toThrow("Connection lost");
    socket.emit("close",1006,"gone"); await assertion;
    expect(client.listenerCount("status")).toBe(0);
    expect(client.listenerCount("console")).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
    client.disconnectWebSocket();
  });
});
