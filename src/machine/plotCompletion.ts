import type { MachineStatus, PlotCompletionConfig } from "../types";

interface ActivePlot {
  path: string;
  config: PlotCompletionConfig;
  accepted: boolean;
  sawFile: boolean;
  fileEnded: boolean;
  paused: boolean;
  finishing: boolean;
  returnQueued: boolean;
  returnTargetMachine?: { x: number; y: number };
  abortController: AbortController;
}

function knownWorkPosition(status: MachineStatus): boolean {
  return /\|WPos:/.test(status.raw) || /\|MPos:/.test(status.raw) && /\|WCO:/.test(status.raw);
}

function atWorkOrigin(status: MachineStatus): boolean {
  return knownWorkPosition(status) && Math.abs(status.wpos.x) < 0.001 && Math.abs(status.wpos.y) < 0.001;
}

function normalizedPath(path: string): string {
  return "/" + path.replace(/\\/g, "/").replace(/^\/(?:sd|localfs)\//i, "").replace(/^\/+/, "");
}

/** Controller-file EOF and planner Idle are separate events. Neither is sufficient
 * alone: Idle occurs during G4/spindle waits; EOF can precede buffered motion.
 * Missing completion evidence fails closed (no automatic movement).
 */
export class PlotCompletionController {
  private active: ActivePlot | null = null;

  constructor(
    private readonly send: (command: string, signal: AbortSignal) => Promise<string>,
    private readonly report: (message: string) => void,
  ) {}

  begin(path: string, config: PlotCompletionConfig): ActivePlot {
    if (this.active) throw new Error("A plot or its safe return is already active");
    if (!config?.penUpCommand?.trim() || !Number.isFinite(config.jogSpeed) || config.jogSpeed <= 0 ||
        !Number.isFinite(config.penUpDelayMs) || config.penUpDelayMs < 0) {
      throw new Error("Select a machine profile with a pen-up command, lift delay and travel speed before plotting");
    }
    const plot: ActivePlot = {
      path: normalizedPath(path), config: { ...config }, accepted: false,
      sawFile: false, fileEnded: false, paused: false, finishing: false, returnQueued: false,
      abortController: new AbortController(),
    };
    this.active = plot;
    return plot;
  }

  accepted(plot: ActivePlot): void {
    if (this.active === plot) plot.accepted = true;
  }

  cancel(): void {
    const plot = this.active;
    this.active = null;
    plot?.abortController.abort(new Error("Safe plot return cancelled"));
  }
  pause(): void {
    if (this.active?.finishing) this.cancel();
    else if (this.active) this.active.paused = true;
  }
  resume(): void { if (this.active) this.active.paused = false; }

  message(message: string): void {
    const plot = this.active;
    if (!plot) return;
    for (const line of message.split(/\r?\n/)) {
      if (/^(?:error:|ALARM:|Grbl\s|FluidNC\s)|\[MSG:(?:ERR(?:OR)?:|[^\]]*(?:abort|cancel|reset|fail))/i.test(line.trim())) {
        this.cancel();
        return;
      }
      // Older firmware emits "file job succeeded", newer builds "job sent".
      // A matching filename is required so nested service jobs cannot finish it.
      const eof = line.trim().replace(/^\[MSG:(?:INFO|DEBUG):\s*/i, "").match(/^(.+?)(?: file)? job (?:succeeded|sent)\]?$/i);
      if (eof && normalizedPath(eof[1].trim()) === plot.path) plot.fileEnded = true;
    }
  }

  status(status: MachineStatus): void {
    const plot = this.active;
    if (!plot) return;
    if (!["Run", "Idle", "Hold"].includes(status.state)) { this.cancel(); return; }
    if (status.state === "Hold") { this.pause(); return; }
    if (plot.finishing) {
      const target = plot.returnTargetMachine;
      const reachedTarget = atWorkOrigin(status) || target && /\|MPos:/.test(status.raw) &&
        Math.abs(status.mpos.x - target.x) < 0.001 && Math.abs(status.mpos.y - target.y) < 0.001;
      if (plot.returnQueued && status.state === "Idle" && reachedTarget) {
        this.active = null;
        this.report("[terraForge] Safe plot return complete; pen left lifted.");
      }
      return;
    }
    // FluidNC reports SD:<percent>,<filename> only while a file job is active.
    // Its disappearance after observing this file is EOF evidence, even on
    // firmware that does not emit the optional console completion message.
    const file = status.raw.match(/\|SD:[^,|>]+,([^|>]+)/i);
    if (file) {
      if (normalizedPath(file[1]) === plot.path) plot.sawFile = true;
      return;
    }
    if (plot.sawFile) plot.fileEnded = true;
    if (!plot.accepted || !plot.fileEnded || plot.paused || status.state !== "Idle") return;
    plot.finishing = true; // Claim once before awaiting any transport response.
    if (knownWorkPosition(status) && /\|MPos:/.test(status.raw)) {
      plot.returnTargetMachine = { x: status.mpos.x - status.wpos.x, y: status.mpos.y - status.wpos.y };
    }
    void this.finish(plot, status);
  }

  private async finish(plot: ActivePlot, status: MachineStatus): Promise<void> {
    try {
      const command = async (line: string) => {
        if (this.active !== plot || plot.paused) throw new Error("Safe return interrupted");
        const response = await this.send(line, plot.abortController.signal);
        if (/(?:^|\n)(?:error:|ALARM:)|\[MSG:ERR/i.test(response ?? "")) throw new Error(response);
      };
      // Set known units/distance mode before a configured servo or Z-stepper
      // command. Preserve its G53 prefix and the existing work coordinate system.
      await command("G90 G21 G94");
      for (const line of plot.config.penUpCommand.split(/\r?\n/).filter((line) => line.trim())) {
        await command(line);
      }
      // G4 synchronizes preceding Z motion as well as allowing servo lift time.
      // Queue it after the lift, never before it, even when delay is zero.
      await command(`G4 P${plot.config.penUpDelayMs / 1000}`);
      // The established return destination is work X0 Y0. A generated footer
      // may already have returned there: lift safely but do not move twice.
      if (!atWorkOrigin(status)) await command(`G90 G21 G94 G1 X0 Y0 F${plot.config.jogSpeed}`);
      if (this.active === plot) {
        plot.returnQueued = true;
        this.report("[terraForge] Plot execution complete; pen lifted and return to work origin queued.");
      }
    } catch (error) {
      if (this.active === plot) {
        this.active = null;
        this.report(`[terraForge] Safe plot return stopped: ${String(error)}`);
      }
    }
  }
}
