import type { BitmapRendererSettings } from "../../../../types";
import { renderToneSpine, TONE_SPINE_ENGINE_VERSION } from "./toneSpine/engine";
import {
  angleField,
  autoLevelsField,
  clipToImageField,
  contrastField,
  DEFAULT_ANGLE_DEG,
  DEFAULT_AUTO_LEVELS,
  DEFAULT_CLIP_TO_IMAGE,
  DEFAULT_CONTRAST,
  DEFAULT_ORIGIN_PCT,
  DEFAULT_PEAK_CLIP_PCT,
  originFields,
  peakClipField,
} from "./sharedFields";
import { waveformField } from "./toneSpine/fields";
import { generateLineFamilyStrands } from "./toneSpine/lineFamily";
import { DEFAULT_WAVEFORM, type WaveformId } from "./toneSpine/waveforms";
import type { BitmapRendererDefinition, RendererContext } from "./types";

export const RASTER_LINES_RENDERER_ID = "raster-lines";

export const rasterLinesDefaults: BitmapRendererSettings = {
  spacingMM: 2,
  toothWidthMM: 3,
  amplitudeMM: 1,
  waveform: DEFAULT_WAVEFORM,
  angleDeg: DEFAULT_ANGLE_DEG,
  originXPct: DEFAULT_ORIGIN_PCT,
  originYPct: DEFAULT_ORIGIN_PCT,
  clipToImage: DEFAULT_CLIP_TO_IMAGE,
  peakClipPct: DEFAULT_PEAK_CLIP_PCT,
  autoLevels: DEFAULT_AUTO_LEVELS,
  contrast: DEFAULT_CONTRAST,
};

/**
 * Parallel lines perpendicular to `angleDeg` (0° = horizontal rows, 90° =
 * vertical columns, anything else = diagonal hatching), spaced evenly and
 * anchored so one line passes exactly through the origin point.
 */
export function generateRasterLinesPath({ source, settings, scale, width, height }: RendererContext): string {
  if (!source || width < 1 || height < 1 || source.values.length === 0) return "";

  const pixelsPerMM = 1 / Math.max(scale, 0.001);
  const spacingMM = Math.max(0.1, Math.min(Number(settings.spacingMM), 50));
  const spacing = Math.max(spacingMM * pixelsPerMM, 0.1);
  const toothWidth = Math.max(0.1, Math.min(Number(settings.toothWidthMM), 50)) * pixelsPerMM;
  const amplitude = Math.max(0, Math.min(Number(settings.amplitudeMM), 50)) * pixelsPerMM;
  const waveform = (settings.waveform as WaveformId) ?? DEFAULT_WAVEFORM;
  const clipToImage = (settings.clipToImage as boolean | undefined) ?? DEFAULT_CLIP_TO_IMAGE;
  const peakClipPct = Number(settings.peakClipPct ?? DEFAULT_PEAK_CLIP_PCT);
  const autoLevels = (settings.autoLevels as boolean | undefined) ?? DEFAULT_AUTO_LEVELS;
  const contrast = Number(settings.contrast ?? DEFAULT_CONTRAST);
  const angleRad = (Number(settings.angleDeg ?? DEFAULT_ANGLE_DEG) * Math.PI) / 180;
  const originX = (Number(settings.originXPct ?? DEFAULT_ORIGIN_PCT) / 100) * source.width;
  const originY = (Number(settings.originYPct ?? DEFAULT_ORIGIN_PCT) / 100) * source.height;
  const targetSegmentLength = toothWidth / 4;

  const strands = generateLineFamilyStrands({
    originX,
    originY,
    angleRad,
    spacing,
    width: source.width,
    height: source.height,
    targetSegmentLength,
  });

  return renderToneSpine(strands, {
    toothWidth,
    amplitude,
    waveform,
    image: source,
    clipToImage,
    peakClipPct,
    autoLevels,
    contrast,
  });
}

export const rasterLinesRenderer: BitmapRendererDefinition = {
  id: RASTER_LINES_RENDERER_ID,
  label: "Row & diagonal lines",
  version: `tone-spine-${TONE_SPINE_ENGINE_VERSION}.1`,
  defaults: rasterLinesDefaults,
  fields: [
    { type: "number", key: "spacingMM", label: "Line spacing (mm)", min: 0.1, max: 50, step: 0.1 },
    { type: "number", key: "toothWidthMM", label: "Tooth width (mm)", min: 0.1, max: 50, step: 0.1 },
    { type: "number", key: "amplitudeMM", label: "Amplitude (mm)", min: 0, max: 50, step: 0.1 },
    waveformField(),
    angleField(),
    ...originFields(),
    clipToImageField(),
    peakClipField(),
    autoLevelsField(),
    contrastField(),
  ],
  render: generateRasterLinesPath,
};
