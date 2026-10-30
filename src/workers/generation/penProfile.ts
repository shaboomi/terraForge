import type { MachineConfig } from "../../types";
import { parsePenProfile, type PenProfile } from "../../types/pens";

export function penFeedrate(requested: number, profile?: PenProfile): number {
  if (!Number.isFinite(requested) || requested <= 0) throw new Error("Drawing speed must be a positive finite number.");
  return Math.min(requested, profile?.maxDrawSpeedMMMin ?? requested);
}

export function brushZ(profile?: PenProfile): number | undefined {
  if (profile?.type !== "brush") return undefined;
  const brush = profile.brush!;
  const ratio = Math.max(0, Math.min(1, (profile.tipWidthMM - brush.minWidthMM) / (brush.maxWidthMM - brush.minWidthMM)));
  return brush.minZ + ratio * (brush.maxZ - brush.minZ);
}

export function validatePlotPen(profile: PenProfile | undefined, config: MachineConfig): void {
  if (!profile) return;
  const pen = parsePenProfile(profile);
  if (pen.type !== "brush") return;
  if (config.penType !== "stepper") throw new Error("Brush height control requires a stepper Z machine.");
  const command = config.penUpCommand.replace(/\([^)]*\)|;[^\n]*/g, "").replace(/\s+/g, "");
  const lift = /^(?:G90)?G0?([01])Z([-+]?(?:\d+\.?\d*|\.\d+))(?:F\d+(?:\.\d+)?)?$/i.exec(command);
  if (!lift || Number(lift[2]) <= Math.max(pen.brush!.minZ, pen.brush!.maxZ)) {
    throw new Error("Brush plotting needs an absolute work-Z pen-up command above both calibrated heights (for example G0 Z5). Positive Z must lift the brush.");
  }
}
