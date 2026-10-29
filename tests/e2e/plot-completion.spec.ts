import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { WebSocket, WebSocketServer } from "ws";

const ROOT = path.resolve(__dirname, "../..");
const EXECUTABLE = process.env.TERRAFORGE_PLOT_EXECUTABLE;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Real renderer -> preload -> main-process IPC -> loopback WebSocket integration.
 * The simulator owns all controller responses; no machine address or serial port is used.
 */
test("a plot longer than the former HTTP timeout starts once and safely returns only after EOF, Idle and its deferred ACK", async ({}, testInfo) => {
  test.setTimeout(45_000);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "terraforge-plot-e2e-"));
  const profile = path.join(temporaryRoot, "profile");
  const pluginDir = path.join(temporaryRoot, "plugins");
  mkdirSync(profile);
  mkdirSync(pluginDir);
  const httpRequests: string[] = [];
  const commands: { command: string; at: number }[] = [];
  const server = createServer((request, response) => {
    httpRequests.push(request.url ?? "");
    response.writeHead(500);
    response.end("This regression must use its confirmed WebSocket transport.");
  });
  const sockets = new WebSocketServer({ server });
  let socket: WebSocket | undefined;
  let application: ElectronApplication | undefined;
  let status = "<Idle|MPos:20,30,0|WPos:20,30,0>";
  const run = "$SD/Run=/long-plot.gcode";
  sockets.on("connection", (connected) => {
    socket = connected;
    connected.on("message", (data) => {
      const command = data.toString().trim();
      commands.push({ command, at: Date.now() });
      if (command === "$RI=500") connected.send("ok\n");
      else if (command === "?") connected.send(status);
      else if (command === run) {
        // Modern FluidNC confirms execution via SD status but holds the Run ACK until EOF.
        status = "<Run|MPos:20,30,0|WPos:20,30,0|SD:1.00,/long-plot.gcode>";
        connected.send(status);
      }
      // All safety command ACKs are explicitly released by the test below.
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Loopback simulator did not bind a TCP port");
  const port = address.port;
  const writes = () => commands.filter(({ command }) => command !== "?" && command !== "$RI=500").map(({ command }) => command);
  const acknowledge = () => socket!.send("ok\n");

  try {
    application = await electron.launch({
      ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : {}),
      args: [`--user-data-dir=${profile}`, ...(EXECUTABLE ? [] : [path.join(ROOT, "out/main/index.js")])],
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined, TERRAFORGE_PLUGIN_DIR: pluginDir },
    });
    const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
    expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
    expect(identity.packaged).toBe(!!EXECUTABLE);
    const page = await application.firstWindow();
    await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
    await page.evaluate(async (simulatorPort) => {
      (window as any).__plotSimulatorMessages = [];
      window.terraForge.fluidnc.onConsoleMessage((message) => (window as any).__plotSimulatorMessages.push(message));
      // Explicit loopback WS override also avoids any firmware HTTP probe.
      await window.terraForge.fluidnc.connectWebSocket("127.0.0.1", simulatorPort, simulatorPort);
    }, port);
    await expect.poll(() => commands.some(({ command }) => command === "$RI=500")).toBe(true);

    const startElapsedMs = await page.evaluate(async () => {
      const start = performance.now();
      await window.terraForge.fluidnc.runFile("/long-plot.gcode", "sd", {
        penUpCommand: "G0 Z5", penUpDelayMs: 350, jogSpeed: 4200,
      });
      return performance.now() - start;
    });
    expect(startElapsedMs).toBeLessThan(1500);
    expect(writes()).toEqual([run]);
    const runStartedAt = commands.find(({ command }) => command === run)!.at;

    // Exceed the former 10-second REST timeout in real wall-clock time. A live
    // SD status accepts start promptly; it does not impose a job-duration timeout.
    await pause(Math.max(0, runStartedAt + 12_100 - Date.now()));
    expect(writes()).toEqual([run]);
    expect(httpRequests).toEqual([]);

    // EOF is queued and planner Idle arrives before the deferred Run ACK.
    // Neither may cause a lift command to consume that earlier command's ACK.
    status = "<Idle|MPos:20,30,0|WPos:20,30,0>";
    socket!.send("[MSG:INFO: /long-plot.gcode job sent]\n" + status);
    await pause(250);
    expect(writes()).toEqual([run]);
    acknowledge();
    await expect.poll(writes).toEqual([run, "G90 G21 G94"]);
    await pause(100);
    expect(writes()).toHaveLength(2);
    acknowledge();
    await expect.poll(writes).toEqual([run, "G90 G21 G94", "G0 Z5"]);
    await pause(100);
    expect(writes()).toHaveLength(3);
    acknowledge();
    await expect.poll(writes).toEqual([run, "G90 G21 G94", "G0 Z5", "G4 P0.35"]);
    // Simulate the controller holding the dwell ACK until lift time has elapsed.
    await pause(350);
    expect(writes()).toHaveLength(4);
    acknowledge();
    const expectedWrites = [run, "G90 G21 G94", "G0 Z5", "G4 P0.35", "G90 G21 G94 G1 X0 Y0 F4200"];
    await expect.poll(writes).toEqual(expectedWrites);
    acknowledge();
    await expect.poll(async () => page.evaluate(() => (window as any).__plotSimulatorMessages as string[])).toContain("[terraForge] Plot execution complete; pen lifted and return to work origin queued.");
    status = "<Idle|MPos:0,0,5|WPos:0,0,5>";
    socket!.send(status);
    await expect.poll(async () => page.evaluate(() => (window as any).__plotSimulatorMessages as string[])).toContain("[terraForge] Safe plot return complete; pen left lifted.");

    // Duplicate terminal updates must not enqueue a second return or homing cycle.
    socket!.send("[MSG:INFO: /long-plot.gcode job sent]\n" + status + "\n" + status);
    await pause(250);
    expect(writes()).toEqual(expectedWrites);
    expect(commands.filter(({ command }) => /\/Run=/.test(command))).toHaveLength(1);
    expect(commands.some(({ command }) => command === "$H")).toBe(false);
    expect(httpRequests).toEqual([]);
    const messages = await page.evaluate(() => (window as any).__plotSimulatorMessages as string[]);
    expect(messages.filter((message) => /timed out|Safe plot return stopped|error:/i.test(message))).toEqual([]);
    await page.screenshot({ path: `test-results/plot-completion-${EXECUTABLE ? "packaged" : "development"}.png` });
    const evidencePath = `test-results/plot-completion-${EXECUTABLE ? "packaged" : "development"}.json`;
    writeFileSync(evidencePath, JSON.stringify({ packaged: identity.packaged, loopbackOnly: true, startElapsedMs, simulatedPlotDurationMs: Date.now() - runStartedAt, httpRequests, commands, messages }, null, 2));
    await testInfo.attach("loopback plot command evidence", { path: evidencePath, contentType: "application/json" });
    await page.evaluate(() => window.terraForge.fluidnc.disconnectWebSocket());
  } finally {
    if (application) await application.close();
    for (const client of sockets.clients) client.terminate();
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (path.basename(temporaryRoot).startsWith("terraforge-plot-e2e-")) rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
