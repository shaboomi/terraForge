import type { RendererSource } from "../../../../../types";
import { luminanceAt } from "./sampling";
import { waveformAt, type WaveformId } from "./waveforms";

/** A point on a spine's unmodulated base curve, plus the outward unit normal
 * amplitude is displaced along at that point. */
export interface SpineSample {
  x: number;
  y: number;
  nx: number;
  ny: number;
}

/** One continuous stroke of a spine — a spiral is a single strand; rings,
 * raster rows, and box loops each contribute one strand per line/ring/box. */
export type SpineStrand = SpineSample[];

export interface ToneModulationOptions {
  /** Arc-length (in the same units as the sample coordinates) of one waveform cycle. */
  toothWidth: number;
  /** Peak displacement along the normal, before scaling by tone and the waveform. */
  amplitude: number;
  waveform: WaveformId;
  image: RendererSource;
}

function format(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * Baseline waveform samples per tone-width cycle. Multiplied by
 * `1 + FREQUENCY_GAIN` below to stay adequate even where local darkness is
 * pushing the phase rate to its fastest.
 */
const SAMPLES_PER_CYCLE: Record<WaveformId, number> = {
  triangle: 4,
  square: 4,
  sawtooth: 4,
  sine: 24,
};

/**
 * Phases within a cycle where a waveform jumps rather than varies smoothly.
 * `waveformAt` is right-continuous at each of these (see its square/sawtooth
 * cases), so sampling it exactly at the phase gives the value just *after*
 * the jump, and sampling an instant earlier gives the value just *before* —
 * emitting both, at (as near as makes no visual difference) the same
 * position, renders a sharp vertical edge instead of a diagonal blurred
 * across however many regular samples happen to span it.
 */
const DISCONTINUITY_PHASES: Record<WaveformId, number[]> = {
  triangle: [],
  sine: [],
  sawtooth: [0],
  square: [0, 0.5],
};

/**
 * How much faster the waveform cycles in fully-dark areas than fully-light
 * ones — tone now drives both amplitude (always has) and frequency, so a
 * dark region reads as busier/denser rather than just bigger, closer to how
 * organic hand-engraved tone lines behave. An internal tuning constant
 * rather than a user field, to keep this a quality fix rather than new
 * configuration surface.
 */
const FREQUENCY_GAIN = 2;

/** A safety net mirroring the original spiral renderer's own point cap, now
 * shared by every spine — sub-sampling for a smooth waveform multiplies a
 * spine's point count, so this bounds the output regardless of shape. */
const MAX_STRAND_POINTS = 200_000;

const DISCONTINUITY_EPSILON = 1e-4;

function interpolateSample(a: SpineSample, b: SpineSample, t: number): SpineSample {
  const nx = a.nx + (b.nx - a.nx) * t;
  const ny = a.ny + (b.ny - a.ny) * t;
  const length = Math.hypot(nx, ny) || 1;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    nx: nx / length,
    ny: ny / length,
  };
}

function isInsideBounds(x: number, y: number, width: number, height: number): boolean {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

/** Discontinuity phase boundaries (`n + offset` for integer `n`) strictly
 * after `phaseBefore` and at or before `phaseAfter` — a waveform with a jump
 * at one of these needs a doubled point inserted there. Phase now advances
 * at a tone-dependent, path-history-dependent rate rather than a closed-form
 * function of arc length, so crossings are found reactively per sub-step
 * instead of precomputed in advance. */
function discontinuityCrossings(phaseBefore: number, phaseAfter: number, offsets: number[]): number[] {
  const crossings: number[] = [];
  for (const offset of offsets) {
    let n = Math.floor(phaseBefore - offset) + 1;
    let boundary = n + offset;
    while (boundary <= phaseAfter) {
      crossings.push(boundary);
      n++;
      boundary = n + offset;
    }
  }
  return crossings.sort((a, b) => a - b);
}

/**
 * Walks one strand's base points, sub-sampling between them densely enough
 * for the chosen waveform, and continuously samples source tone at every
 * sub-sample — rather than once per cycle — so tone can drive the
 * waveform's phase rate as well as its amplitude: a darker point both
 * displaces more and oscillates faster, the "busier where it's darker" look
 * a fixed-frequency wobble can't produce. A point outside the image's own
 * bounds is skipped (phase stays frozen while invisible, so the wobble
 * resumes smoothly on re-entry) and breaks the path into a new `M`, rather
 * than ever displacing geometry past the image edge; a point that is inside
 * has its displaced position clamped back into bounds as a cheap safety net
 * against the wobble itself pushing it back out. Returns one
 * `M...L L L...` path substring (with possible internal `M` breaks), or ""
 * for a strand too short to draw.
 */
export function modulateStrand(points: SpineStrand, options: ToneModulationOptions): string {
  if (points.length === 0) return "";
  const { toothWidth, amplitude, waveform, image } = options;
  const safeToothWidth = Math.max(toothWidth, 1e-6);
  // Sized for the fastest phase rate darkness can produce, not just the
  // baseline rate — otherwise the densest (darkest) regions would be
  // under-sampled relative to how fast their phase is actually moving.
  const maxSubStep = safeToothWidth / ((SAMPLES_PER_CYCLE[waveform] ?? 4) * (1 + FREQUENCY_GAIN));
  const discontinuityOffsets = DISCONTINUITY_PHASES[waveform];

  const commands: string[] = [];
  let broken = true;
  let phase = 0;

  const pushPoint = (base: SpineSample, toneDark: number, atPhase: number) => {
    const displacement = amplitude * toneDark * waveformAt(waveform, atPhase);
    const x = Math.min(image.width, Math.max(0, base.x + displacement * base.nx));
    const y = Math.min(image.height, Math.max(0, base.y + displacement * base.ny));
    commands.push(`${broken ? "M" : "L"}${format(x)} ${format(y)}`);
    broken = false;
  };

  /** Visits one base sample; returns false once the strand's point budget is spent. */
  const visit = (base: SpineSample, subArcLength: number): boolean => {
    if (!isInsideBounds(base.x, base.y, image.width, image.height)) {
      broken = true;
      return true;
    }
    const toneDark = 1 - luminanceAt(image, base.x, base.y) / 255;
    const phaseBefore = phase;
    phase += (subArcLength / safeToothWidth) * (1 + FREQUENCY_GAIN * toneDark);
    for (const boundary of discontinuityCrossings(phaseBefore, phase, discontinuityOffsets)) {
      pushPoint(base, toneDark, boundary - DISCONTINUITY_EPSILON);
      if (commands.length >= MAX_STRAND_POINTS) return false;
    }
    pushPoint(base, toneDark, phase);
    return commands.length < MAX_STRAND_POINTS;
  };

  if (!visit(points[0], 0)) return commands.join(" ");

  outer: for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    const segmentLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (segmentLength === 0) continue;

    const subStepCount = Math.max(1, Math.ceil(segmentLength / maxSubStep));
    const subArcLength = segmentLength / subStepCount;
    for (let step = 1; step <= subStepCount; step++) {
      const sample = interpolateSample(previous, point, step / subStepCount);
      if (!visit(sample, subArcLength)) break outer;
    }
  }

  return commands.join(" ");
}

/** Modulates every strand and joins the results into one multi-subpath `d`. */
export function renderToneSpine(strands: Iterable<SpineStrand>, options: ToneModulationOptions): string {
  const segments: string[] = [];
  for (const strand of strands) {
    const segment = modulateStrand(strand, options);
    if (segment) segments.push(segment);
  }
  return segments.join(" ");
}
