import { normalizeHexColor } from "./colorUtils";

export const PEN_TYPES = ["fineliner", "ballpoint", "marker", "brush", "other"] as const;
export type DrawingPenType = typeof PEN_TYPES[number];
export const PEN_TYPE_LABELS: Record<DrawingPenType, string> = {
  fineliner: "Fineliner", ballpoint: "Ballpoint", marker: "Marker", brush: "Brush", other: "Other",
};

/** Physical tip measurements, separate from the machine's lift mechanism. */
export interface PenProfile {
  id: string;
  name: string;
  color: string;
  type: DrawingPenType;
  tipWidthMM: number;
  /** Highest drawing feed measured during calibration, in mm/min. */
  maxDrawSpeedMMMin?: number;
  brush?: {
    minWidthMM: number;
    maxWidthMM: number;
    /** Absolute work Z at the minimum measured width (mm). */
    minZ: number;
    /** Absolute work Z at the maximum measured width (mm). May be below minZ. */
    maxZ: number;
  };
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function finite(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

/** Validate every boundary: stored library, layout import, and G-code generation. */
export function parsePenProfile(value: unknown): PenProfile {
  const pen = record(value, "Pen specification");
  if (typeof pen.id !== "string" || !pen.id.trim() || pen.id.length > 256 || /[\u0000-\u001f]/.test(pen.id)) throw new Error("Pen ID is invalid.");
  if (typeof pen.name !== "string" || !pen.name.trim() || pen.name.length > 80) throw new Error("Pen name must contain 1–80 characters.");
  const color = typeof pen.color === "string" ? normalizeHexColor(pen.color) : null;
  if (!color) throw new Error("Choose a valid pen colour.");
  if (!PEN_TYPES.includes(pen.type as DrawingPenType)) throw new Error("Choose a valid pen type.");
  const result: PenProfile = {
    id: pen.id, name: pen.name.trim(), color, type: pen.type as DrawingPenType,
    tipWidthMM: finite(pen.tipWidthMM, "Tip width (mm)", 0.001, 100),
  };
  if (pen.maxDrawSpeedMMMin !== undefined) result.maxDrawSpeedMMMin = finite(pen.maxDrawSpeedMMMin, "Maximum drawing speed (mm/min)", 1, 1000000);
  if (result.type === "brush") {
    const brush = record(pen.brush, "Brush measurements");
    result.brush = {
      minWidthMM: finite(brush.minWidthMM, "Minimum brush width (mm)", 0.001, 100),
      maxWidthMM: finite(brush.maxWidthMM, "Maximum brush width (mm)", 0.001, 100),
      minZ: finite(brush.minZ, "Z at minimum width (mm)", -1000, 1000),
      maxZ: finite(brush.maxZ, "Z at maximum width (mm)", -1000, 1000),
    };
    if (result.brush.maxWidthMM <= result.brush.minWidthMM) throw new Error("Maximum brush width must exceed minimum brush width.");
    if (result.brush.minZ === result.brush.maxZ) throw new Error("Brush measurements need two different Z heights.");
  }
  return result;
}

/** Invalid stored entries are discarded individually so the rest of a library survives. */
export function readPenLibrary(value: unknown): PenProfile[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  const result: PenProfile[] = [];
  for (const entry of value.slice(0, 500)) {
    try {
      const pen = parsePenProfile(entry);
      if (!ids.has(pen.id)) { ids.add(pen.id); result.push(pen); }
    } catch { /* Corrupt entries cannot become machine motion settings. */ }
  }
  return result;
}
