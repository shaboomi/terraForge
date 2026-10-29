/**
 * SVG → G-code Web Worker
 *
 * Full SVG path command support including cubic/quadratic bezier curves,
 * smooth variants, elliptical arcs, and all basic shapes.
 * Flattens everything to polylines for G-code output.
 *
 * Message protocol:
 *   IN  → { type: 'generate', taskId, objects, config, options }
 *   IN  → { type: 'cancel', taskId }
 *   OUT ← { type: 'progress', taskId, percent, stage }
 *   OUT ← { type: 'complete', taskId, gcode }
 *   OUT ← { type: 'error', taskId, error }
 */

import type {
  VectorObject,
  MachineConfig,
  GcodeOptions,
  InkServiceSettings,
  InkServiceStation,
} from "../types";
import { isSolenoidPenType } from "../types";
import {
  flattenToSubpaths,
  clipSubpathsToBed,
  clipSubpathsToRect,
  resolvePageClipRect,
  fmtCoord as fmt,
  tokenizePath,
  toAbsolute,
  transformPt,
  type Subpath,
} from "./gcodeEngine";
import {
  joinSubpathsCooperative,
  nearestNeighbourSortCooperative,
  OperationCancelledError,
} from "./gcodeEngine/stages/pathOptimization";
import { applyVinylCompensation } from "./gcodeEngine/stages/vinylCompensation";
import { applyVinylWeedBorder } from "./gcodeEngine/stages/vinylWeedBorder";
import { brushZ, penFeedrate, transformCenterline, validatePlotPen } from "./gcodeEngine/stages/penProfile";
import type { PenProfile } from "../types/pens";

interface GenerateMessage {
  type: "generate";
  taskId: string;
  objects: VectorObject[];
  config: MachineConfig;
  options: GcodeOptions;
}
interface CancelMessage {
  type: "cancel";
  taskId: string;
}
type InMessage = GenerateMessage | CancelMessage;

const cancelled = new Set<string>();

type GcodeGenerationStage =
  | "preparing"
  | "optimizing"
  | "joining"
  | "postprocessing"
  | "emitting";

function fmtSeconds(n: number): string {
  return n
    .toFixed(3)
    .replace(/\.0+$/, "")
    .replace(/(\.\d*?)0+$/, "$1");
}

interface TravelSubpath {
  penProfile?: PenProfile;
  plotOrder?: number;
  penId?: string;
  points: Subpath;
  layer?: string;
  color?: string;
}

interface TravelPoint {
  penProfile?: PenProfile;
  point: { x: number; y: number };
  layer?: string;
  color?: string;
  repeats: number;
}

interface ToolpathMetadata {
  penId?: string;
  color?: string;
  layer?: string;
  dip?: string;
}

function encodeMarkerValue(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function metadataKey(meta: ToolpathMetadata): string {
  return [meta.color ?? "", meta.layer ?? "", meta.dip ?? "", meta.penId ?? ""].join("|");
}

function emitTfMarker(lines: string[], meta: ToolpathMetadata): void {
  const tokens = [";@tf", "v=1"];
  if (meta.penId) tokens.push(`pen=${encodeMarkerValue(meta.penId)}`);
  if (meta.color) tokens.push(`color=${encodeMarkerValue(meta.color)}`);
  if (meta.layer) tokens.push(`layer=${encodeMarkerValue(meta.layer)}`);
  if (meta.dip) tokens.push(`dip=${encodeMarkerValue(meta.dip)}`);
  lines.push(tokens.join(" "));
}

function clampNumber(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function distanceMM(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.hypot(dx, dy);
}

function normalizeTopOriginAnchorObject(
  obj: VectorObject,
  config: MachineConfig,
): VectorObject | null {
  if (config.origin !== "top-left" && config.origin !== "top-right") {
    return null;
  }

  const sY = obj.scaleY ?? obj.scale;
  const objHeight = obj.originalHeight * sY;
  if (!Number.isFinite(objHeight) || objHeight === 0) {
    return null;
  }

  // Canvas top-origin placement stores import Y one object-height above the
  // visual top edge. Shift to the actual machine-space top-edge anchor before
  // flattening so generated toolpaths align with canvas placement.
  return {
    ...obj,
    y: obj.y + objHeight,
  };
}

function isPointWithinBounds(
  point: { x: number; y: number },
  config: MachineConfig,
  pageClip?: { widthMM: number; heightMM: number; marginMM: number },
): boolean {
  const bounds = pageClip
    ? resolvePageClipRect(config, pageClip)
    : {
        xMin: config.origin === "center" ? -config.bedWidth / 2 : 0,
        xMax:
          config.origin === "center" ? config.bedWidth / 2 : config.bedWidth,
        yMin: config.origin === "center" ? -config.bedHeight / 2 : 0,
        yMax:
          config.origin === "center" ? config.bedHeight / 2 : config.bedHeight,
      };

  return (
    point.x >= bounds.xMin &&
    point.x <= bounds.xMax &&
    point.y >= bounds.yMin &&
    point.y <= bounds.yMax
  );
}

function isEnabledStation(station: InkServiceStation): boolean {
  return station.enabled !== false;
}

function chooseTriggerDistance(baseMM: number, jitterPct: number): number {
  if (jitterPct <= 0) return baseMM;
  const ratio = jitterPct / 100;
  const scalar = 1 + (Math.random() * 2 - 1) * ratio;
  return Math.max(1, baseMM * scalar);
}

function normalizeDipMapKey(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function colorDipMapKey(color: string | undefined): string | null {
  const normalizedColor = normalizeDipMapKey(color);
  if (!normalizedColor) return null;
  return `color:${normalizedColor}`;
}

function resolvePreferredDipStation(
  layerDipStations: Record<string, string>,
  layer: string | undefined,
  color: string | undefined,
): string | undefined {
  if (layer) {
    const mappedByLayer = layerDipStations[layer];
    if (mappedByLayer) return mappedByLayer;
  }

  const colorKey = colorDipMapKey(color);
  if (colorKey) {
    const mappedByColor = layerDipStations[colorKey];
    if (mappedByColor) return mappedByColor;
  }

  return undefined;
}

function emitRelativeZMove(lines: string[], deltaMM: number): void {
  lines.push("G91 ; Relative mode");
  lines.push(`G0 Z${fmt(deltaMM)}`);
  lines.push("G90 ; Absolute mode");
}

function emitPrimePressAction(
  lines: string[],
  station: InkServiceStation,
  dwellMs: number,
): void {
  const action = station.action;
  if (!action || action.kind !== "prime-press") return;

  const zDepth = Math.max(0, action.zDepthMM);
  const pressCount = Math.max(1, Math.round(action.pressCount));

  lines.push(
    `; Prime action: ${pressCount} press${pressCount === 1 ? "" : "es"}, depth ${fmt(zDepth)} mm`,
  );
  for (let i = 0; i < pressCount; i++) {
    if (zDepth > 0) {
      emitRelativeZMove(lines, -zDepth);
      if (dwellMs > 0) {
        lines.push(`G4 P${fmtSeconds(dwellMs / 1000)} ; Prime press dwell`);
      }
      emitRelativeZMove(lines, zDepth);
    } else if (dwellMs > 0) {
      lines.push(`G4 P${fmtSeconds(dwellMs / 1000)} ; Prime press dwell`);
    }
  }
}

function emitCircularBrushMotion(
  lines: string[],
  station: InkServiceStation,
  repetitions: number,
  radiusMM: number,
): void {
  const segments = 12;
  for (let rep = 0; rep < repetitions; rep++) {
    lines.push(`G1 X${fmt(station.x + radiusMM)} Y${fmt(station.y)}`);
    for (let i = 1; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      lines.push(
        `G1 X${fmt(station.x + radiusMM * Math.cos(theta))} Y${fmt(station.y + radiusMM * Math.sin(theta))}`,
      );
    }
    lines.push(`G1 X${fmt(station.x)} Y${fmt(station.y)}`);
  }
}

function emitBackForthBrushMotion(
  lines: string[],
  station: InkServiceStation,
  repetitions: number,
  distanceMM: number,
): void {
  for (let rep = 0; rep < repetitions; rep++) {
    lines.push(`G1 X${fmt(station.x + distanceMM)} Y${fmt(station.y)}`);
    lines.push(`G1 X${fmt(station.x - distanceMM)} Y${fmt(station.y)}`);
    lines.push(`G1 X${fmt(station.x)} Y${fmt(station.y)}`);
  }
}

function emitBrushMotionAction(
  lines: string[],
  config: MachineConfig,
  station: InkServiceStation,
  dwellMs: number,
): void {
  const action = station.action;
  if (!action || action.kind !== "brush-motion") return;

  const zDepth = Math.max(0, action.zDepthMM);
  const repetitions = Math.max(1, Math.round(action.repetitions));
  const distanceMM = Math.max(0, action.distanceMM);

  lines.push(
    `; Brush action: ${action.pattern}, reps ${repetitions}, distance ${fmt(distanceMM)} mm, depth ${fmt(zDepth)} mm`,
  );

  // Service brush patterns use G1 XY moves, so emit an explicit feedrate
  // before those moves to avoid firmware errors when no F word has appeared yet.
  const serviceFeed = Math.max(1, Number(config.drawSpeed) || 1000);
  lines.push(`G1 F${fmt(serviceFeed)} ; Service feedrate`);

  if (zDepth > 0) {
    emitRelativeZMove(lines, -zDepth);
  }
  if (dwellMs > 0) {
    lines.push(`G4 P${fmtSeconds(dwellMs / 1000)} ; Brush settle dwell`);
  }

  if (action.pattern === "circular") {
    emitCircularBrushMotion(lines, station, repetitions, distanceMM);
  } else {
    emitBackForthBrushMotion(lines, station, repetitions, distanceMM);
  }

  if (dwellMs > 0) {
    lines.push(`G4 P${fmtSeconds(dwellMs / 1000)} ; Brush release dwell`);
  }
  if (zDepth > 0) {
    emitRelativeZMove(lines, zDepth);
  }
}

function emitStationContact(
  lines: string[],
  config: MachineConfig,
  station: InkServiceStation,
): void {
  const dwellMs = Number.isFinite(station.dwellMs)
    ? Math.max(0, station.dwellMs)
    : 0;

  lines.push(
    `G0 X${fmt(station.x)} Y${fmt(station.y)} ; Service move: ${station.type} (${station.name})`,
  );

  if (station.action?.kind === "prime-press") {
    emitPrimePressAction(lines, station, dwellMs);
    return;
  }
  if (station.action?.kind === "brush-motion") {
    emitBrushMotionAction(lines, config, station, dwellMs);
    return;
  }

  lines.push(config.penDownCommand + " ; Service contact");
  if (dwellMs > 0) {
    lines.push(`G4 P${fmtSeconds(dwellMs / 1000)} ; Service dwell`);
  }
  lines.push(config.penUpCommand + " ; Service pen up");
}

function emitPrimeAndWipe(
  lines: string[],
  config: MachineConfig,
  stations: InkServiceStation[],
): boolean {
  const prime = stations.find((s) => s.type === "prime");
  const wipe = stations.find((s) => s.type === "wipe");
  if (!prime && !wipe) return false;
  lines.push("; -- Ink service: prime and wipe --");
  if (prime) emitStationContact(lines, config, prime);
  if (wipe) emitStationContact(lines, config, wipe);
  lines.push("; -- End ink service --");
  lines.push("");
  return true;
}

function emitBrushDip(
  lines: string[],
  config: MachineConfig,
  settings: InkServiceSettings,
  stations: InkServiceStation[],
  dipCursorRef: { value: number },
  dipsSinceWashRef: { value: number },
  currentDipIdRef: { value: string | null },
  preferredDipStationId?: string,
): boolean {
  const dips = stations.filter((s) => s.type === "dip");
  if (dips.length === 0) return false;
  const wash = stations.find((s) => s.type === "wash");

  const mappedDip = preferredDipStationId
    ? dips.find((dip) => dip.id === preferredDipStationId)
    : undefined;
  const selectedDip = mappedDip
    ? mappedDip
    : settings.randomizeDipStation
      ? dips[Math.floor(Math.random() * dips.length)]
      : dips[dipCursorRef.value++ % dips.length];
  let dip = selectedDip;

  const trayChangeRequired =
    currentDipIdRef.value !== null && currentDipIdRef.value !== selectedDip.id;

  lines.push("; -- Ink service: brush dip --");

  // Never change dip trays without washing first. If no wash station exists,
  // stick to the current tray to avoid cross-contamination.
  if (trayChangeRequired) {
    if (wash) {
      lines.push(
        `; Tray change: ${currentDipIdRef.value} -> ${selectedDip.id}, wash first`,
      );
      emitStationContact(lines, config, wash);
      dipsSinceWashRef.value = 0;
    } else {
      const currentDip = dips.find((s) => s.id === currentDipIdRef.value);
      if (currentDip) {
        dip = currentDip;
        lines.push(
          `; Tray change blocked (no wash station), staying on ${currentDip.id}`,
        );
      }
    }
  }

  const washEvery = Math.max(1, settings.washEveryNDips ?? 1);
  const shouldWashBeforeDip =
    settings.includeWashMove && !!wash && dipsSinceWashRef.value >= washEvery;
  if (shouldWashBeforeDip) {
    emitStationContact(lines, config, wash); // Wash first to clean brush
    dipsSinceWashRef.value = 0;
  }

  emitStationContact(lines, config, dip); // Then dip to pick up fresh paint
  currentDipIdRef.value = dip.id;
  dipsSinceWashRef.value += 1;

  lines.push("; -- End ink service --");
  lines.push("");
  return true;
}

function emitInkServiceMove(
  lines: string[],
  config: MachineConfig,
  settings: InkServiceSettings,
  dipCursorRef: { value: number },
  dipsSinceWashRef: { value: number },
  currentDipIdRef: { value: string | null },
  preferredDipStationId?: string,
): boolean {
  const triggerTravelMM = Number.isFinite(settings.triggerTravelMM)
    ? settings.triggerTravelMM
    : 0;
  if (triggerTravelMM <= 0) return false;

  const enabledStations = settings.stations.filter(isEnabledStation);
  if (enabledStations.length === 0) return false;

  lines.push(config.penUpCommand + " ; Pen up for service move");

  if (settings.mode === "prime-wipe") {
    return emitPrimeAndWipe(lines, config, enabledStations);
  }
  return emitBrushDip(
    lines,
    config,
    settings,
    enabledStations,
    dipCursorRef,
    dipsSinceWashRef,
    currentDipIdRef,
    preferredDipStationId,
  );
}

function remapLayerMetadata(
  previous: TravelSubpath[],
  nextPoints: Subpath[],
): TravelSubpath[] {
  if (previous.length === 0) {
    return nextPoints.map((points) => ({ points }));
  }
  const endpoints = new Map<Subpath[number], TravelSubpath>();
  for (const path of previous) {
    if (!endpoints.has(path.points[0])) endpoints.set(path.points[0], path);
    const last = path.points[path.points.length - 1];
    if (!endpoints.has(last)) endpoints.set(last, path);
  }
  return nextPoints.map((points) => {
    const first = points[0];
    const exact = endpoints.get(first);
    if (exact) return { ...exact, points };
    let best = previous[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const candidate of previous) {
      const start = candidate.points[0];
      const end = candidate.points[candidate.points.length - 1];
      const startScore = distanceMM(first, start);
      const endScore = distanceMM(first, end);
      const score = Math.min(startScore, endScore);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return { ...best, points };
  });
}

function approximateObjectSubpaths(
  obj: VectorObject,
  config: MachineConfig,
): Subpath[] {
  const subpaths: Subpath[] = [];
  const abs = toAbsolute(tokenizePath(obj.path));
  let cur: Subpath = [];
  let cx = 0,
    cy = 0,
    startX = 0,
    startY = 0;

  const push = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    cur.push(transformPt(obj, config, x, y));
    cx = x;
    cy = y;
  };

  for (const cmd of abs) {
    const a = cmd.args;
    switch (cmd.type) {
      case "M": {
        if (cur.length > 1) subpaths.push(cur);
        cur = [];
        if (a.length < 2) break;
        cx = a[0];
        cy = a[1];
        startX = cx;
        startY = cy;
        push(cx, cy);
        for (let i = 2; i + 1 < a.length; i += 2) push(a[i], a[i + 1]);
        break;
      }
      case "L":
        for (let i = 0; i + 1 < a.length; i += 2) push(a[i], a[i + 1]);
        break;
      case "H":
        for (let i = 0; i < a.length; i++) push(a[i], cy);
        break;
      case "V":
        for (let i = 0; i < a.length; i++) push(cx, a[i]);
        break;
      case "C":
        for (let i = 0; i + 5 < a.length; i += 6) push(a[i + 4], a[i + 5]);
        break;
      case "S":
        for (let i = 0; i + 3 < a.length; i += 4) push(a[i + 2], a[i + 3]);
        break;
      case "Q":
        for (let i = 0; i + 3 < a.length; i += 4) push(a[i + 2], a[i + 3]);
        break;
      case "T":
        for (let i = 0; i + 1 < a.length; i += 2) push(a[i], a[i + 1]);
        break;
      case "A":
        for (let i = 0; i + 6 < a.length; i += 7) push(a[i + 5], a[i + 6]);
        break;
      case "Z":
        push(startX, startY);
        if (cur.length > 1) subpaths.push(cur);
        cur = [];
        break;
    }
  }

  if (cur.length > 1) subpaths.push(cur);
  return subpaths;
}

/**
 * Process subpaths to implement multiple passes.
 * - 'repeat': adds identical subpaths n times
 * - 'backtrack': alternates forward and backward for each pass
 * - 'penLift': adds identical subpaths n times (pen naturally lifts between)
 */
function applyPassesToSubpaths(
  subpaths: Subpath[],
  passCount: number = 1,
  passMode: string = "repeat",
): Subpath[] {
  if (passCount <= 1) {
    return subpaths;
  }

  const result: Subpath[] = [];

  for (const subpath of subpaths) {
    if (passMode === "backtrack") {
      // For backtrack: draw forward, then backward (without pen lift between)
      // We emit both forward and reverse, but as separate subpaths
      // (the natural pen-up/down cycle provides the backtrack behavior)
      for (let p = 0; p < passCount; p++) {
        // Forward pass
        result.push(subpath);
        // Backward pass - reverse the subpath
        const reversed = [...subpath].reverse();
        result.push(reversed);
      }
    } else {
      // 'repeat' and 'penLift' both just duplicate the subpath
      // penLift mode relies on natural pen up/down between strokes
      for (let p = 0; p < passCount; p++) {
        result.push(subpath);
      }
    }
  }

  return result;
}

self.onmessage = (e: MessageEvent<InMessage>) => {
  const msg = e.data;
  if (msg.type === "cancel") {
    cancelled.add(msg.taskId);
  } else if (msg.type === "generate") {
    generate(msg).catch((err: unknown) => {
      self.postMessage({
        type: "error",
        taskId: msg.taskId,
        error: String(err),
      });
    });
  }
};

// ── G-code generation ─────────────────────────────────────────────────────────

async function generate(msg: GenerateMessage): Promise<void> {
  const { taskId, objects, config, options } = msg;
  const lines: string[] = [];
  let lastProgressPercent = -1;
  let lastProgressStage: GcodeGenerationStage | null = null;

  const postProgress = (
    percent: number,
    stage: GcodeGenerationStage,
    force: boolean = false,
  ): void => {
    const normalized = Number(Math.max(0, Math.min(100, percent)).toFixed(1));
    const stageChanged = lastProgressStage !== stage;
    if (!force && !stageChanged && normalized === lastProgressPercent) {
      return;
    }
    lastProgressPercent = normalized;
    lastProgressStage = stage;
    self.postMessage({
      type: "progress",
      taskId,
      percent: normalized,
      stage,
    });
  };

  const optimise = options?.optimisePaths ?? false;
  const pathDirectionMode = options?.pathDirectionMode ?? "minimize-travel";
  const allowPathReversal = pathDirectionMode === "minimize-travel";
  const orderedOutput = objects.some(object => object.visible && object.plotOrder !== undefined);
  // Never bridge letters or merge different physical pen profiles. The font
  // processor already chooses continuous trails within each glyph.
  const hasPenProfiles = objects.some(object => object.visible && (object.penProfile || object.centerline));
  const doJoin = (options?.joinPaths ?? false) && !orderedOutput && !hasPenProfiles;
  const joinTol = options?.joinTolerance ?? 0.2;
  const liftPenAtEnd = options?.liftPenAtEnd ?? true;
  const returnToHome = options?.returnToHome ?? false;
  const customStartGcode = (options?.customStartGcode ?? "").trim();
  const customEndGcode = (options?.customEndGcode ?? "").trim();
  const inkService = options?.inkService;
  const hasDelayOverride = typeof options?.penDownDelayMsOverride === "number";
  const rawDelayMs = hasDelayOverride
    ? options.penDownDelayMsOverride
    : config.penType === "servo" || isSolenoidPenType(config.penType)
      ? (config.penDownDelayMs ?? 0)
      : 0;
  const penDownDelayMs = Number.isFinite(rawDelayMs)
    ? Math.max(0, rawDelayMs ?? 0)
    : 0;

  const hasUpDelayOverride = typeof options?.penUpDelayMsOverride === "number";
  const rawUpDelayMs = hasUpDelayOverride
    ? options.penUpDelayMsOverride
    : config.penType === "servo" || isSolenoidPenType(config.penType)
      ? (config.penUpDelayMs ?? 0)
      : 0;
  const penUpDelayMs = Number.isFinite(rawUpDelayMs)
    ? Math.max(0, rawUpDelayMs ?? 0)
    : 0;

  lines.push(
    "; -- terraForge G-code ------------------------------------------",
  );
  lines.push(`; Version  : ${options?.terraForgeVersion ?? "unknown"}`);
  lines.push(`; Machine  : ${config.name}`);
  lines.push(`; Firmware : ${options?.firmwareVersion ?? "Not connected"}`);
  lines.push(`; Bed      : ${config.bedWidth} x ${config.bedHeight} mm`);
  lines.push(`; Origin   : ${config.origin}`);
  if (options?.pageClip) {
    const pc = options.pageClip;
    lines.push(
      `; Page clip: ${pc.widthMM} x ${pc.heightMM} mm (${pc.marginMM} mm margin)`,
    );
  }
  lines.push(`; Optimised: ${optimise ? "yes (nearest-neighbour)" : "no"}`);
  lines.push(
    `; Path dir : ${allowPathReversal ? "minimize travel (reversal enabled)" : "respect source direction"}`,
  );
  lines.push(`; Joined   : ${doJoin ? `yes (tolerance ${joinTol} mm)` : "no"}`);
  lines.push(`; Lift end : ${liftPenAtEnd ? "yes" : "no"}`);
  lines.push(`; Ret home : ${returnToHome ? "yes" : "no"}`);
  lines.push(`; Pen delay: ${penDownDelayMs} ms`);
  lines.push(`; Pen up delay: ${penUpDelayMs} ms`);
  if (options?.vinylCutting) {
    lines.push(
      `; Vinyl    : yes (offset ${options.vinylCutting.bladeOffsetMM} mm, threshold ${options.vinylCutting.cornerAngleThresholdDeg} deg, blade rotation offset ${options.vinylCutting.microJogMagnitudeMM} mm)`,
    );
  } else {
    lines.push("; Vinyl    : no");
  }
  if (options?.vinylWeedBorder) {
    lines.push(
      `; Weed bd  : yes (margin ${options.vinylWeedBorder.marginMM} mm)`,
    );
  } else {
    lines.push("; Weed bd  : no");
  }
  if (inkService) {
    lines.push(
      `; Dip svc  : ${inkService.mode}, every ${inkService.triggerTravelMM} mm (jitter +/-${inkService.triggerJitterPct ?? 0}%)`,
    );
  } else {
    lines.push("; Dip svc  : no");
  }
  lines.push(`; Generated: ${new Date().toISOString()}`);
  lines.push(
    "; ---------------------------------------------------------------",
  );
  lines.push("G90      ; Absolute coordinates");
  lines.push("G21      ; Units: mm");
  lines.push(config.penUpCommand + " ; Pen up");
  lines.push("");

  // Inject custom start G-code (if any)
  if (customStartGcode) {
    lines.push(
      "; -- Custom start G-code ----------------------------------------",
    );
    lines.push(customStartGcode);
    lines.push(
      "; ---------------------------------------------------------------",
    );
    lines.push("");
  }

  const visibleObjects = objects.filter((o) => o.visible);
  for (const object of visibleObjects) validatePlotPen(object.penProfile, config);
  if (options?.vinylCutting && visibleObjects.some(object => object.penProfile?.type === "brush")) {
    throw new Error("Brush height control requires pen plotting mode. Disable vinyl cutting before exporting.");
  }
  if (orderedOutput && visibleObjects.some(object => object.pointTap)) {
    throw new Error("Export point-tap artwork separately from ordered CMYK layers so Black remains the final plotted pass.");
  }
  if (visibleObjects.some(object => object.plotOrder !== undefined && !object.penId)) {
    throw new Error("An ordered plugin layer has no configured real pen. Assign its pen in Pens before exporting.");
  }
  if (options?.vinylCutting && visibleObjects.some(object => object.plotOrder !== undefined)) {
    throw new Error("Ordered plugin artwork requires pen plotting mode. Disable vinyl cutting for CMYK output.");
  }
  const pageClipBounds = options?.pageClip
    ? resolvePageClipRect(config, options.pageClip)
    : null;

  // Sort objects by sourceColor to batch by color for pen-swapping workflow
  const colorSortedObjects = visibleObjects.sort((a, b) => {
    const order = (a.plotOrder ?? -1) - (b.plotOrder ?? -1);
    if (order) return order;
    const aColor = a.sourceColor ?? "";
    const bColor = b.sourceColor ?? "";
    return aColor.localeCompare(bColor);
  });

  let skippedObjects = 0;

  // Time-based yield helper — only surrenders to the event loop after a full
  // frame's worth of work (~16 ms), instead of yielding on every iteration.
  // This keeps the worker responsive to cancel messages while eliminating the
  // massive overhead of hundreds-of-thousands of individual setTimeout callbacks.
  const makeYielder = () => {
    let last = Date.now();
    return async () => {
      const now = Date.now();
      if (now - last >= 16) {
        last = now;
        await sleep(0);
      }
    };
  };

  // ── Phase 1: collect all subpaths from all visible objects ────────────────
  const allSubpaths: TravelSubpath[] = [];
  const allPoints: TravelPoint[] = [];
  const yieldPh1 = makeYielder();
  let lastPct1 = -1;
  let lastColor: string | undefined = undefined;
  let colorObjectCount = 0;

  for (let i = 0; i < colorSortedObjects.length; i++) {
    if (cancelled.has(taskId)) {
      cancelled.delete(taskId);
      self.postMessage({ type: "cancelled", taskId });
      return;
    }
    const obj = colorSortedObjects[i];
    const normalizedTopOriginObj = normalizeTopOriginAnchorObject(obj, config);

    // Always flatten using normalized top-origin placement first so G-code
    // matches the import position shown on canvas.
    const flattenCandidate = normalizedTopOriginObj ?? obj;

    // Keep a compatibility fallback for pre-normalized object data by trying
    // both candidates and accepting the first in-bounds point.
    const pointTapCandidates = normalizedTopOriginObj
      ? [flattenCandidate, obj]
      : [obj];

    for (const pointTapObj of pointTapCandidates) {
      if (!pointTapObj.pointTap) continue;
      const transformedPoint = transformPt(
        pointTapObj,
        config,
        pointTapObj.pointTap.x,
        pointTapObj.pointTap.y,
      );
      if (isPointWithinBounds(transformedPoint, config, options?.pageClip)) {
        allPoints.push({
          point: transformedPoint,
          layer: pointTapObj.layer,
          color: pointTapObj.sourceColor,
          repeats: Math.max(1, pointTapObj.passCount ?? 1),
          penProfile: obj.penProfile,
        });
        break;
      }
    }

    // Emit color batch comment when color changes
    if (obj.sourceColor !== lastColor && i > 0) {
      lines.push(
        `; -- Color: ${lastColor ?? "(no color)"} (${colorObjectCount} object${colorObjectCount === 1 ? "" : "s"}) --`,
      );
      colorObjectCount = 0;
    }
    lastColor = obj.sourceColor;
    colorObjectCount++;

    const clipCandidate = (
      candidate: VectorObject,
    ): { clipped: Subpath[]; validGeometry: boolean } => {
      let raw: Subpath[];
      try {
        raw = candidate.centerline ? [transformCenterline(candidate, config)] : flattenToSubpaths(candidate, config);
      } catch {
        if (candidate.centerline) throw new Error("Invalid centreline data. Regenerate the text before exporting.");
        // Fallback to coarse endpoint-only approximation for malformed paths.
        raw = approximateObjectSubpaths(candidate, config);
        if (raw.length === 0) {
          return { clipped: [], validGeometry: false };
        }
      }

      const clipped = pageClipBounds
        ? clipSubpathsToRect(
            raw,
            pageClipBounds.xMin,
            pageClipBounds.xMax,
            pageClipBounds.yMin,
            pageClipBounds.yMax,
          )
        : clipSubpathsToBed(raw, config);

      return { clipped, validGeometry: true };
    };

    const primaryResult = clipCandidate(flattenCandidate);
    let clipped = primaryResult.clipped;
    let validGeometry = primaryResult.validGeometry;

    // Compatibility fallback: if the normalized anchor produces no visible
    // geometry, retry with the raw object coordinates for data that is already
    // stored in top-edge-anchor form.
    if (clipped.length === 0 && normalizedTopOriginObj) {
      const fallbackResult = clipCandidate(obj);
      if (fallbackResult.clipped.length > 0) {
        clipped = fallbackResult.clipped;
      }
      validGeometry = validGeometry || fallbackResult.validGeometry;
    }

    if (!validGeometry) {
      skippedObjects++;
    }

    // Apply passes: if passCount > 1, duplicate subpaths according to passMode
    const passCount = obj.passCount ?? 1;
    const passMode = obj.passMode ?? "repeat";
    const processedSubpaths = applyPassesToSubpaths(
      clipped,
      passCount,
      passMode,
    );

    for (const sp of processedSubpaths) {
      if (sp.length >= 2) {
        allSubpaths.push({
          points: sp,
          layer: obj.layer,
          color: obj.sourceColor,
          plotOrder: obj.plotOrder,
          penId: obj.penId,
          penProfile: obj.penProfile,
        });
      }
    }
    const pct = Math.round(((i + 1) / colorSortedObjects.length) * 40);
    if (pct !== lastPct1) {
      lastPct1 = pct;
      postProgress(pct, "preparing");
    }
    await yieldPh1();
  }

  // Emit final color batch comment
  if (colorSortedObjects.length > 0 && lastColor !== undefined) {
    lines.push(
      `; -- Color: ${lastColor ?? "(no color)"} (${colorObjectCount} object${colorObjectCount === 1 ? "" : "s"}) --`,
    );
  }

  // ── Phase 2: optional nearest-neighbour reorder ────────────────────────────
  let orderedSubpaths = allSubpaths;
  let phase3Progress = 40;
  let phase3Stage: GcodeGenerationStage = "optimizing";
  const hasPreEmitProcessing =
    optimise || doJoin || !!options?.vinylCutting || !!options?.vinylWeedBorder;

  const emitPhase3Progress = (pct: number, force: boolean = false): void => {
    const clamped = Math.max(40, Math.min(95, pct));
    if (force || clamped - phase3Progress >= 0.1) {
      phase3Progress = clamped;
      postProgress(clamped, phase3Stage, force);
    }
  };

  try {
    if (optimise) {
      phase3Stage = "optimizing";
      emitPhase3Progress(phase3Progress, true);
      const batches = new Map<string, TravelSubpath[]>();
      for (const path of allSubpaths) {
        const key = path.plotOrder === undefined
          ? (path.penProfile ? `pen:${path.penId}:${JSON.stringify(path.penProfile)}` : "legacy")
          : `${path.plotOrder}:${path.penId ?? path.color}`;
        const batch = batches.get(key) ?? []; batch.push(path); batches.set(key, batch);
      }
      orderedSubpaths = [];
      let sortedCount = 0;
      for (const batch of batches.values()) {
        const sorted = await nearestNeighbourSortCooperative(
          batch.map((sp) => sp.points),
          {
            allowReverse: allowPathReversal,
            pruneSpatialSearch: batch.some(path => path.plotOrder !== undefined),
            shouldCancel: () => cancelled.has(taskId),
            onProgress: (completed, total) => {
              if (total <= 0) return;
              // Ease-out mapping gives earlier visible movement for very large
              // path counts where linear integer percentages stay flat too long.
              const ratio = Math.max(0, Math.min(1, (sortedCount + completed) / allSubpaths.length));
              const eased = Math.sqrt(ratio);
              const pct = 40 + eased * 50;
              emitPhase3Progress(pct);
            },
          },
        );
        orderedSubpaths = orderedSubpaths.concat(remapLayerMetadata(batch, sorted));
        sortedCount += batch.length;
      }
      emitPhase3Progress(90);
    }

    // ── Phase 3: optional path joining ──────────────────────────────────────
    // Joining is applied after NN sort so that already-adjacent subpaths
    // (which NN sort placed next to each other) get merged where possible.
    if (doJoin) {
      phase3Stage = "joining";
      emitPhase3Progress(phase3Progress, true);
      const joined = await joinSubpathsCooperative(
        orderedSubpaths.map((sp) => sp.points),
        joinTol,
        {
          shouldCancel: () => cancelled.has(taskId),
          onProgress: (completed, total) => {
            if (total <= 0) return;
            const pct = 90 + (completed / total) * 3;
            emitPhase3Progress(pct);
          },
        },
      );
      orderedSubpaths = remapLayerMetadata(orderedSubpaths, joined);
      emitPhase3Progress(93);
    }
  } catch (err: unknown) {
    if (err instanceof OperationCancelledError || cancelled.has(taskId)) {
      cancelled.delete(taskId);
      self.postMessage({ type: "cancelled", taskId });
      return;
    }
    throw err;
  }

  if (options?.vinylCutting && options?.vinylWeedBorder) {
    phase3Stage = "postprocessing";
    emitPhase3Progress(phase3Progress, true);
    orderedSubpaths = remapLayerMetadata(
      orderedSubpaths,
      applyVinylWeedBorder(
        orderedSubpaths.map((sp) => sp.points),
        options.vinylWeedBorder,
      ),
    );
    emitPhase3Progress(94);
  }

  if (options?.vinylCutting) {
    phase3Stage = "postprocessing";
    emitPhase3Progress(phase3Progress, true);
    orderedSubpaths = remapLayerMetadata(
      orderedSubpaths,
      applyVinylCompensation(
        orderedSubpaths.map((sp) => sp.points),
        options.vinylCutting,
      ),
    );
    emitPhase3Progress(95);
  }

  // ── Phase 4: emit G-code ─────────────────────────────────────────────────
  const modeLabel = optimise ? "Optimised" : "Sequential";
  lines.push(
    `; -- ${modeLabel} path (${orderedSubpaths.length} subpaths) -----------`,
  );
  if (allPoints.length > 0) {
    lines.push(
      `; -- Point taps (${allPoints.length} points) ---------------------`,
    );
  }
  if (skippedObjects > 0) {
    lines.push(`; NOTE: skipped ${skippedObjects} invalid path object(s)`);
  }

  const inkTriggerBase = Math.max(0, inkService?.triggerTravelMM ?? 0);
  const inkTriggerJitter = clampNumber(
    inkService?.triggerJitterPct ?? 0,
    0,
    100,
  );
  const dipCursorRef = { value: 0 };
  const dipsSinceWashRef = { value: 0 };
  const currentDipIdRef = { value: null as string | null };
  const layerDipStations = inkService?.layerDipStations ?? {};
  let nextInkServiceAt = chooseTriggerDistance(
    inkTriggerBase,
    inkTriggerJitter,
  );
  let lastMarkerKey: string | null = null;
  let accumulatedDrawTravel = 0;
  const canEmitInkService =
    !!inkService &&
    inkTriggerBase > 0 &&
    inkService.stations.some(isEnabledStation);
  if (canEmitInkService && visibleObjects.some(object => object.penProfile?.type === "brush")) {
    throw new Error("Export brush height-controlled artwork with ink service disabled. Brush service requires a separately calibrated station height.");
  }
  const totalOperations = orderedSubpaths.length + allPoints.length;
  const phase4StartProgress = hasPreEmitProcessing ? 95 : 40;
  // Service patterns also make drawing moves. Use the most restrictive pen
  // limit in a mixed job so a temporary service feed cannot exceed a tip limit.
  const serviceConfig = hasPenProfiles ? { ...config, drawSpeed: visibleObjects.reduce(
    (speed, object) => penFeedrate(speed, object.penProfile), options?.drawSpeedOverride ?? config.drawSpeed,
  ) } : config;

  const emitTriggeredInkService = (preferredDipStationId?: string): void => {
    if (!canEmitInkService || !inkService) return;
    const inserted = emitInkServiceMove(
      lines,
      serviceConfig,
      inkService,
      dipCursorRef,
      dipsSinceWashRef,
      currentDipIdRef,
      preferredDipStationId,
    );
    if (inserted) {
      accumulatedDrawTravel = 0;
      nextInkServiceAt = chooseTriggerDistance(
        inkTriggerBase,
        inkTriggerJitter,
      );
    }
  };

  const yieldPh4 = makeYielder();
  let lastPct4 = -1;

  // Prime/dip before first stroke so paint/ink is loaded before drawing.
  if (canEmitInkService && totalOperations > 0) {
    const firstColor =
      orderedSubpaths[0]?.color ??
      (orderedSubpaths.length === 0 ? allPoints[0]?.color : undefined);
    const firstLayer =
      orderedSubpaths[0]?.layer ??
      (orderedSubpaths.length === 0 ? allPoints[0]?.layer : undefined);
    const preferredFirstDip = resolvePreferredDipStation(
      layerDipStations,
      firstLayer,
      firstColor,
    );
    const firstMeta: ToolpathMetadata = {
      penId: orderedSubpaths[0]?.penId,
      color: firstColor,
      layer: firstLayer,
      dip: preferredFirstDip,
    };
    const firstMetaKey = metadataKey(firstMeta);
    if (firstMetaKey !== lastMarkerKey) {
      emitTfMarker(lines, firstMeta);
      lastMarkerKey = firstMetaKey;
    }
    emitTriggeredInkService(preferredFirstDip);
  }

  for (let i = 0; i < orderedSubpaths.length; i++) {
    if (cancelled.has(taskId)) {
      cancelled.delete(taskId);
      self.postMessage({ type: "cancelled", taskId });
      return;
    }
    const subpath = orderedSubpaths[i].points;
    const currentColor = orderedSubpaths[i].color;
    const currentLayer = orderedSubpaths[i].layer;
    const preferredDipStationId = resolvePreferredDipStation(
      layerDipStations,
      currentLayer,
      currentColor,
    );
    const currentMeta: ToolpathMetadata = {
      color: currentColor,
      layer: currentLayer,
      penId: orderedSubpaths[i].penId,
      dip: preferredDipStationId,
    };
    const currentMetaKey = metadataKey(currentMeta);
    const markerChanged = currentMetaKey !== lastMarkerKey;
    if (markerChanged) {
      emitTfMarker(lines, currentMeta);
      lastMarkerKey = currentMetaKey;
    }

    // Ensure mapped color/layer dip assignments are honored even when the
    // travel trigger is large by forcing a service move on dip-target changes.
    if (
      markerChanged &&
      canEmitInkService &&
      preferredDipStationId &&
      currentDipIdRef.value !== preferredDipStationId
    ) {
      emitTriggeredInkService(preferredDipStationId);
    }

    const first = subpath[0];

    if (orderedSubpaths[i].penProfile?.type === "brush") lines.push("G90 ; Absolute brush coordinates");
    lines.push(`G0 X${fmt(first.x)} Y${fmt(first.y)} ; Rapid travel`);
    const drawSpeed = penFeedrate(
      typeof options?.drawSpeedOverride === "number"
        ? options.drawSpeedOverride
        : config.drawSpeed, orderedSubpaths[i].penProfile);
    lines.push(`F${drawSpeed}`);
    const profile = orderedSubpaths[i].penProfile;
    const startZ = brushZ(profile, first.width);
    lines.push(startZ === undefined ? config.penDownCommand + " ; Pen down" : `G1 Z${fmt(startZ)} ; Brush contact`);
    if (penDownDelayMs > 0) {
      lines.push(`G4 P${fmtSeconds(penDownDelayMs / 1000)} ; Pen settle delay`);
    }
    let currentPoint = first;
    for (let s = 1; s < subpath.length; s++) {
      const targetPoint = subpath[s];
      const targetZ = brushZ(profile, targetPoint.width);
      if (!canEmitInkService || !inkService) {
        lines.push(`G1 X${fmt(targetPoint.x)} Y${fmt(targetPoint.y)}${targetZ === undefined ? "" : ` Z${fmt(targetZ)}`}`);
        currentPoint = targetPoint;
        continue;
      }

      let segmentStart = currentPoint;
      while (true) {
        const remainingDistance = distanceMM(segmentStart, targetPoint);
        if (remainingDistance <= 1e-9) {
          currentPoint = targetPoint;
          break;
        }

        const distanceToTrigger = nextInkServiceAt - accumulatedDrawTravel;
        if (distanceToTrigger <= 1e-9) {
          emitTriggeredInkService(preferredDipStationId);
          continue;
        }

        if (remainingDistance + 1e-9 < distanceToTrigger) {
          lines.push(`G1 X${fmt(targetPoint.x)} Y${fmt(targetPoint.y)}`);
          accumulatedDrawTravel += remainingDistance;
          currentPoint = targetPoint;
          break;
        }

        const splitRatio = distanceToTrigger / remainingDistance;
        const splitPoint = {
          x: segmentStart.x + (targetPoint.x - segmentStart.x) * splitRatio,
          y: segmentStart.y + (targetPoint.y - segmentStart.y) * splitRatio,
        };
        lines.push(`G1 X${fmt(splitPoint.x)} Y${fmt(splitPoint.y)}`);
        accumulatedDrawTravel += distanceToTrigger;
        segmentStart = splitPoint;
        currentPoint = splitPoint;
        emitTriggeredInkService(preferredDipStationId);
      }
    }
    if (penUpDelayMs > 0) {
      lines.push(`G4 P${fmtSeconds(penUpDelayMs / 1000)} ; Pen lift delay`);
    }
    lines.push(config.penUpCommand + " ; Pen up");
    lines.push("");
    const completedOperations = i + 1;
    const pct =
      totalOperations > 0
        ? phase4StartProgress +
          Math.round(
            (completedOperations / totalOperations) *
              (100 - phase4StartProgress),
          )
        : 100;
    if (pct !== lastPct4) {
      lastPct4 = pct;
      postProgress(pct, "emitting");
    }
    await yieldPh4();
  }

  for (let i = 0; i < allPoints.length; i++) {
    if (cancelled.has(taskId)) {
      cancelled.delete(taskId);
      self.postMessage({ type: "cancelled", taskId });
      return;
    }

    const tap = allPoints[i];
    const preferredDipStationId = resolvePreferredDipStation(
      layerDipStations,
      tap.layer,
      tap.color,
    );
    const currentMeta: ToolpathMetadata = {
      color: tap.color,
      layer: tap.layer,
      dip: preferredDipStationId,
    };
    const currentMetaKey = metadataKey(currentMeta);
    const markerChanged = currentMetaKey !== lastMarkerKey;
    if (markerChanged) {
      emitTfMarker(lines, currentMeta);
      lastMarkerKey = currentMetaKey;
    }

    if (
      markerChanged &&
      canEmitInkService &&
      preferredDipStationId &&
      currentDipIdRef.value !== preferredDipStationId
    ) {
      emitTriggeredInkService(preferredDipStationId);
    }

    const drawSpeed = penFeedrate(
      typeof options?.drawSpeedOverride === "number"
        ? options.drawSpeedOverride
        : config.drawSpeed, tap.penProfile);

    for (let rep = 0; rep < tap.repeats; rep++) {
      lines.push(`G0 X${fmt(tap.point.x)} Y${fmt(tap.point.y)} ; Point rapid`);
      lines.push(`F${drawSpeed}`);
      const tapZ = brushZ(tap.penProfile);
      lines.push(tapZ === undefined ? config.penDownCommand + " ; Point tap" : `G1 Z${fmt(tapZ)} ; Brush contact`);
      if (penDownDelayMs > 0) {
        lines.push(
          `G4 P${fmtSeconds(penDownDelayMs / 1000)} ; Pen settle delay`,
        );
      }
      if (penUpDelayMs > 0) {
        lines.push(`G4 P${fmtSeconds(penUpDelayMs / 1000)} ; Pen lift delay`);
      }
      lines.push(config.penUpCommand + " ; Pen up");
      lines.push("");
    }

    const completedOperations = orderedSubpaths.length + i + 1;
    const pct =
      totalOperations > 0
        ? phase4StartProgress +
          Math.round(
            (completedOperations / totalOperations) *
              (100 - phase4StartProgress),
          )
        : 100;
    if (pct !== lastPct4) {
      lastPct4 = pct;
      postProgress(pct, "emitting");
    }
    await yieldPh4();
  }

  const finalWashStation =
    inkService?.mode === "brush-dip"
      ? inkService.stations
          .filter(isEnabledStation)
          .find((station) => station.type === "wash")
      : undefined;
  if (finalWashStation && totalOperations > 0) {
    lines.push("; -- Final ink service: end wash --");
    lines.push(config.penUpCommand + " ; Pen up for final wash");
    emitStationContact(lines, config, finalWashStation);
    lines.push("; -- End final ink service --");
    lines.push("");
  }

  lines.push("; -- End of job -----------------------------------------------");
  if (liftPenAtEnd || returnToHome) {
    lines.push(config.penUpCommand + " ; Pen up - safe");
    const finalLiftDelayMs = hasUpDelayOverride ? penUpDelayMs : config.penUpDelayMs;
    if (returnToHome && Number.isFinite(finalLiftDelayMs) && finalLiftDelayMs > 0) {
      lines.push(`G4 P${fmtSeconds(finalLiftDelayMs / 1000)} ; Pen lift delay`);
    }
  }
  if (returnToHome) {
    lines.push("G0 X0 Y0 ; Return to origin");
  }
  if (customEndGcode) {
    lines.push(
      "; -- Custom end G-code ------------------------------------------",
    );
    lines.push(customEndGcode);
    lines.push(
      "; ---------------------------------------------------------------",
    );
  }
  self.postMessage({ type: "complete", taskId, gcode: lines.join("\n") });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
