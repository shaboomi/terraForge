import type { RendererSource } from "../../../../../types";
import { clipLineToRect } from "./lineFamily";
import { luminanceAt, toneRangeOf } from "./sampling";
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
  /**
   * When true (the default when omitted), a displaced point is clamped back
   * into the image bounds. When false, the wobble can push geometry past the
   * image edge by (at most) the amplitude setting. Either way, a base point
   * outside the image breaks the path rather than drawing through it: the
   * spine generators deliberately reach the image's farthest corner, so
   * drawing it outside the image would add whole areas of unmodulated
   * geometry beyond the picture, not just an amplitude's worth of overflow. There's a real trade-off either way — clamping can flatten a
   * sharp waveform peak (most visible on sawtooth) into a flat edge right
   * where the render reaches the image boundary, which every circular/
   * spiral renderer's outer edge does by design — so this is exposed as a
   * user setting rather than picked once for every renderer.
   */
  clipToImage?: boolean;
  /**
   * Waveform peak clipping, as a percentage (1–100; 100 — the default when
   * omitted — is unclipped). A different feature from `clipToImage`: this
   * shapes the waveform itself, independent of the image boundary, the way
   * audio clipping/distortion does — below 100 the peak reaches full height
   * sooner (the ramp gets proportionally steeper) and then holds flat there
   * instead of coming to a point, so e.g. a sawtooth's tip reads as chopped
   * rather than sharp. Applied as `clamp(value / (pct / 100), -1, 1)` to the
   * waveform's bipolar (-1..1) value before it's scaled by tone and
   * amplitude, so at 100% `value / 1` is already in range and clamping is a
   * no-op — today's exact shape.
   */
  peakClipPct?: number;
  /**
   * When true (default `false` — preserves today's output for existing
   * saved renders), tone is rescaled to this image's own actual darkest/
   * lightest sampled pixel rather than the flat 0–255 assumption: a photo
   * whose darkest pixel isn't true black otherwise never reaches full tone-
   * darkness anywhere, so `amplitude` silently never reaches its own dial
   * regardless of how high it's set. A perfectly flat image (no range to
   * stretch) is left unscaled rather than painted fully dark or fully light.
   */
  autoLevels?: boolean;
  /**
   * Multiplier pushing tone-darkness away from (above 1) or toward (below 1,
   * down to 0) mid-grey, applied after `autoLevels` if that's also on.
   * Default `1` is neutral — today's exact output.
   */
  contrast?: number;
}

function format(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * How many samples per cycle sine — the only genuinely curved waveform —
 * needs to look smooth rather than faceted. Nothing else uses this: see
 * `BREAKPOINT_PHASES` below for why every other waveform needs no regular
 * sampling at all.
 */
const SINE_SAMPLES_PER_CYCLE = 24;

/**
 * Phases within a cycle where a waveform's *value* jumps rather than
 * varying smoothly. `waveformAt` is right-continuous at each of these (see
 * its square/sawtooth cases), so sampling it exactly at the phase gives the
 * value just *after* the jump, and sampling an instant earlier gives the
 * value just *before* — emitting both, at (as near as makes no visual
 * difference) the same position, renders a sharp vertical edge instead of a
 * diagonal.
 */
const JUMP_PHASES: Record<WaveformId, number[]> = {
  triangle: [],
  sine: [],
  sawtooth: [0],
  square: [0, 0.5],
};

/**
 * Phases within a cycle where a waveform's *slope* changes but its value
 * stays continuous — triangle's corners. Together with `JUMP_PHASES`, these
 * are the points where every piecewise-linear waveform (everything except
 * sine) needs an exact drawn point; between consecutive points of either
 * kind the waveform is perfectly linear, so the engine draws one straight
 * line connecting them instead of following however many points the base
 * spine happens to produce along the way (see the `isPiecewiseLinear`
 * branch in `modulateStrand`) — without that, a long straight-seeming ramp
 * (sawtooth's especially, since its one ramp spans a full cycle) gets drawn
 * as several intermediate points, each displaced along its own
 * locally-rotating normal, visibly bowing what should read as one straight
 * tooth wherever the base spine curves tightly (a spiral's centre, a small
 * circular ring). Both empty for sine: it has no breakpoints at all, so it
 * always falls through to regular dense sampling instead.
 */
const SLOPE_PHASES: Record<WaveformId, number[]> = {
  triangle: [0, 0.25, 0.5, 0.75],
  sine: [],
  sawtooth: [],
  square: [],
};

/**
 * Each piecewise-linear waveform's breakpoints as `{ phase, value }` pairs
 * spanning exactly one cycle (0 to 1) — used only to derive the *extra*
 * breakpoints peak-clipping needs (see `peakClipBreakpointPhases` below).
 * Square is omitted: its value never leaves ±1, so there's no intermediate
 * value for peak-clipping to ever saturate — it was already a no-op for
 * square before piecewise-linear drawing, and stays one now.
 */
const BREAKPOINT_VALUES: Partial<Record<WaveformId, { phase: number; value: number }[]>> = {
  triangle: [
    { phase: 0, value: 0 },
    { phase: 0.25, value: 1 },
    { phase: 0.5, value: 0 },
    { phase: 0.75, value: -1 },
    { phase: 1, value: 0 },
  ],
  sawtooth: [
    { phase: 0, value: -1 },
    { phase: 1, value: 1 },
  ],
};

/**
 * The exact phases, within one cycle, where peak-clipping (`drive < 1`)
 * makes a piecewise-linear waveform's ramp first reach ±1 and flatten.
 * Without these as real breakpoints, peak-clipping would have nothing left
 * to visibly affect: it only ever changed *intermediate* waveform values,
 * and piecewise-linear waveforms now draw only at their own breakpoints —
 * which for triangle are exactly 0 and ±1 already, and for sawtooth are a
 * single value jump — so peak-clipping needs to introduce new breakpoints
 * of its own to have anywhere left to act. Each is a slope change, not a
 * value jump: the clipped shape is still continuous there, just bends.
 * Found by linear interpolation within each known breakpoint-to-breakpoint
 * segment, since every segment here is a straight line between two known
 * values. Returns `[]` at `drive >= 1` (unclipped) or for a waveform with
 * no entry in `BREAKPOINT_VALUES` (square, sine).
 */
function peakClipBreakpointPhases(waveform: WaveformId, drive: number): number[] {
  if (drive >= 1) return [];
  const segments = BREAKPOINT_VALUES[waveform];
  if (!segments) return [];
  const phases: number[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segments[i];
    const b = segments[i + 1];
    for (const threshold of [drive, -drive]) {
      if ((threshold - a.value) * (threshold - b.value) < 0) {
        const t = (threshold - a.value) / (b.value - a.value);
        phases.push(a.phase + (b.phase - a.phase) * t);
      }
    }
  }
  return phases;
}

/**
 * How much faster the waveform cycles in fully-dark areas than fully-light
 * ones — tone now drives both amplitude (always has) and frequency, so a
 * dark region reads as busier/denser rather than just bigger, closer to how
 * organic hand-engraved tone lines behave. An internal tuning constant
 * rather than a user field, to keep this a quality fix rather than new
 * configuration surface.
 */
const FREQUENCY_GAIN = 2;

/**
 * How much weight each new tone sample gets against the running average
 * (0–1; lower is smoother). Tone is now sampled continuously at every
 * sub-step rather than once per cycle, which also means fine per-pixel
 * noise in the source — water texture, grain, compression artifacts — now
 * feeds straight into displacement and phase rate instead of being damped
 * out by the old once-per-cycle bucketing. This exponential moving average
 * restores that damping without reintroducing the bucketing itself, so a
 * genuine tonal gradient is still tracked, just not single-pixel jitter.
 */
const TONE_SMOOTHING = 0.2;

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

/** Fraction (0–1) of the way from `outside` to `inside` at which the segment
 * between them enters the `[0,width] x [0,height]` image rectangle. */
function entryFraction(outside: SpineSample, inside: SpineSample, width: number, height: number): number {
  const range = clipLineToRect(outside, { x: inside.x - outside.x, y: inside.y - outside.y }, width, height);
  return range ? Math.max(0, Math.min(1, range[0])) : 0;
}

/** Fraction (0–1) of the way from `inside` to `outside` at which the segment
 * between them leaves the `[0,width] x [0,height]` image rectangle. */
function exitFraction(inside: SpineSample, outside: SpineSample, width: number, height: number): number {
  const range = clipLineToRect(inside, { x: outside.x - inside.x, y: outside.y - inside.y }, width, height);
  return range ? Math.max(0, Math.min(1, range[1])) : 0;
}

/** Breakpoint phases (`n + offset` for integer `n`, for each `offset` in
 * `phases`) strictly after `phaseBefore` and at or before `phaseAfter`.
 * Phase advances at a tone-dependent, path-history-dependent rate rather
 * than a closed-form function of arc length, so crossings are found
 * reactively per visit instead of precomputed in advance. */
function breakpointCrossings(phaseBefore: number, phaseAfter: number, phases: number[]): number[] {
  const crossings: number[] = [];
  for (const offset of phases) {
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
 * Walks one strand's base points and continuously samples source tone at
 * every visited point — rather than once per cycle — so tone can drive the
 * waveform's phase rate as well as its amplitude: a darker point both
 * displaces more and oscillates faster, the "busier where it's darker" look
 * a fixed-frequency wobble can't produce. A base point outside the image's
 * own bounds is skipped (phase stays frozen while invisible, so the wobble
 * resumes smoothly on re-entry) and breaks the path into a new `M`. When
 * `options.clipToImage` is true, a point that is inside also has its
 * displaced position clamped back into bounds, so the wobble itself never
 * pushes geometry past the image edge; when false, it may overflow by up to
 * the amplitude — see `ToneModulationOptions.clipToImage`.
 *
 * For a piecewise-linear waveform (triangle/square/sawtooth —
 * `JUMP_PHASES`/`SLOPE_PHASES`, plus any extra phases peak-clipping adds),
 * only breakpoints and the points where the stroke starts, enters or leaves
 * the image, and ends are ever drawn: every base
 * point in between is still visited (so tone/phase tracking stays
 * continuous), just not drawn, so consecutive breakpoints are connected by
 * one straight line rather than however many points the base spine happens
 * to produce along the way. Sine (no breakpoints) keeps the dense regular
 * sub-sampling below instead, since it's the one waveform that's genuinely
 * curved rather than straight between fixed points.
 *
 * Returns one `M...L L L...` path substring (with possible internal `M`
 * breaks), or "" for a strand too short to draw.
 */
export function modulateStrand(points: SpineStrand, options: ToneModulationOptions): string {
  if (points.length === 0) return "";
  const {
    toothWidth,
    amplitude,
    waveform,
    image,
    clipToImage = true,
    peakClipPct = 100,
    autoLevels = false,
    contrast = 1,
  } = options;
  const toneRange = autoLevels ? toneRangeOf(image) : null;
  const hasToneRange = !!toneRange && toneRange.max > toneRange.min;
  // 1–100%: dividing by a smaller drive pushes the raw -1..1 waveform value
  // past ±1 sooner, so the subsequent clamp flattens it there instead of
  // letting it reach a point — the audio-clipping-style shaping described
  // on `ToneModulationOptions.peakClipPct`.
  const peakClipDrive = Math.max(0.01, Math.min(1, peakClipPct / 100));
  const safeToothWidth = Math.max(toothWidth, 1e-6);
  const jumpPhases = JUMP_PHASES[waveform] ?? [];
  // Peak-clipping's own breakpoints are always slope changes (the shape
  // stays continuous there, just bends), merged alongside the waveform's
  // own slope breakpoints — never the jump list, regardless of waveform.
  const slopePhases = [...(SLOPE_PHASES[waveform] ?? []), ...peakClipBreakpointPhases(waveform, peakClipDrive)];
  const isPiecewiseLinear = jumpPhases.length > 0 || slopePhases.length > 0;
  // Only relevant for sine: every other waveform draws solely at its own
  // breakpoints (see the doc comment above), so this sub-stepping is never
  // reached for them.
  const maxSubStep = safeToothWidth / SINE_SAMPLES_PER_CYCLE;

  const commands: string[] = [];
  let broken = true;
  let phase = 0;
  let smoothedToneDark: number | null = null;

  const pushPoint = (base: SpineSample, toneDark: number, atPhase: number) => {
    const shapedValue = Math.max(-1, Math.min(1, waveformAt(waveform, atPhase) / peakClipDrive));
    const displacement = amplitude * toneDark * shapedValue;
    const rawX = base.x + displacement * base.nx;
    const rawY = base.y + displacement * base.ny;
    const x = clipToImage ? Math.min(image.width, Math.max(0, rawX)) : rawX;
    const y = clipToImage ? Math.min(image.height, Math.max(0, rawY)) : rawY;
    commands.push(`${broken ? "M" : "L"}${format(x)} ${format(y)}`);
    broken = false;
  };

  /**
   * Visits one base sample; returns false once the strand's point budget is
   * spent. `segmentStart` is the previous sample the walk is coming from
   * (a base point, or for sine a sub-step). It locates where a stroke
   * re-enters the image, and for a piecewise-linear waveform places each
   * breakpoint crossing at its
   * actual fractional position along the segment (by phase, which advances
   * linearly across it) rather than at `base` itself — without that, a
   * segment spanning several waveform cycles (coarse spine spacing relative
   * to `toothWidth`, e.g. a grid renderer's cell edges) would draw every one
   * of those cycles' breakpoints on top of `base`, fanning them out into a
   * zigzag star instead of tracing separate teeth along the segment. `null`
   * for the strand's very first sample, which has no preceding point.
   */
  const visit = (
    segmentStart: SpineSample | null,
    base: SpineSample,
    subArcLength: number,
    isFinal: boolean,
  ): boolean => {
    // The image is the extent of the picture, so a base point outside it is
    // never drawn, whatever `clipToImage` says — see that option.
    if (!isInsideBounds(base.x, base.y, image.width, image.height)) {
      if (!broken && segmentStart) {
        // Leaving the image: finish the stroke exactly at the edge rather than
        // at the last sample inside it, which can fall up to a whole segment
        // short. Clamped so rounding can never put the exit point outside and
        // send it back through this branch.
        const fraction = exitFraction(segmentStart, base, image.width, image.height);
        const exit = interpolateSample(segmentStart, base, fraction);
        exit.x = Math.min(image.width, Math.max(0, exit.x));
        exit.y = Math.min(image.height, Math.max(0, exit.y));
        if (!visit(segmentStart, exit, subArcLength * fraction, true)) return false;
      }
      broken = true;
      return true;
    }
    const sampledLuminance = luminanceAt(image, base.x, base.y);
    const scaledLuminance =
      hasToneRange && toneRange
        ? Math.max(0, Math.min(255, ((sampledLuminance - toneRange.min) / (toneRange.max - toneRange.min)) * 255))
        : sampledLuminance;
    const levelsToneDark = 1 - scaledLuminance / 255;
    const rawToneDark = Math.max(0, Math.min(1, (levelsToneDark - 0.5) * contrast + 0.5));
    smoothedToneDark =
      smoothedToneDark === null
        ? rawToneDark
        : smoothedToneDark + (rawToneDark - smoothedToneDark) * TONE_SMOOTHING;
    const toneDark = smoothedToneDark;
    let walkedFrom = segmentStart;
    let walkedLength = subArcLength;
    if (broken && (isPiecewiseLinear || segmentStart)) {
      // A piecewise-linear waveform otherwise draws nothing until its first
      // breakpoint — up to a whole tooth for sawtooth — leaving every strand
      // short at its start and every closed ring with a gap. So the point the
      // stroke (re)starts from is drawn explicitly: the strand's first point,
      // or, re-entering the image, where this segment crosses into it. (Sine
      // already draws every sample, so it only needs the re-entry point.)
      let startPoint = base;
      if (segmentStart) {
        const fraction = entryFraction(segmentStart, base, image.width, image.height);
        startPoint = interpolateSample(segmentStart, base, fraction);
        walkedFrom = startPoint;
        walkedLength = subArcLength * (1 - fraction);
      }
      pushPoint(startPoint, toneDark, phase);
      if (commands.length >= MAX_STRAND_POINTS) return false;
    }
    const phaseBefore = phase;
    phase += (walkedLength / safeToothWidth) * (1 + FREQUENCY_GAIN * toneDark);
    const phaseSpan = phase - phaseBefore;
    const crossings = [
      ...breakpointCrossings(phaseBefore, phase, jumpPhases).map((boundary) => ({ boundary, isJump: true })),
      ...breakpointCrossings(phaseBefore, phase, slopePhases).map((boundary) => ({ boundary, isJump: false })),
    ].sort((a, b) => a.boundary - b.boundary);
    for (const crossing of crossings) {
      const t = phaseSpan > 0 ? Math.max(0, Math.min(1, (crossing.boundary - phaseBefore) / phaseSpan)) : 1;
      const position = walkedFrom ? interpolateSample(walkedFrom, base, t) : base;
      if (crossing.isJump) {
        pushPoint(position, toneDark, crossing.boundary - DISCONTINUITY_EPSILON);
        if (commands.length >= MAX_STRAND_POINTS) return false;
      }
      pushPoint(position, toneDark, crossing.boundary);
      if (commands.length >= MAX_STRAND_POINTS) return false;
    }
    if (!isPiecewiseLinear || isFinal) {
      pushPoint(base, toneDark, phase);
    }
    return commands.length < MAX_STRAND_POINTS;
  };

  if (!visit(null, points[0], 0, points.length === 1)) return commands.join(" ");

  outer: for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    const segmentLength = Math.hypot(point.x - previous.x, point.y - previous.y);
    if (segmentLength === 0) continue;
    const isLastSegment = index === points.length - 1;

    if (isPiecewiseLinear) {
      // One visit per base segment is enough: a breakpoint crossing is
      // placed at its exact fractional position along this segment (see
      // `visit`'s `segmentStart` param) regardless of how coarse this outer
      // step is — only the *drawn* resolution depends on sub-stepping, and a
      // piecewise-linear waveform draws nothing extra between breakpoints
      // anyway.
      if (!visit(previous, point, segmentLength, isLastSegment)) break outer;
    } else {
      const subStepCount = Math.max(1, Math.ceil(segmentLength / maxSubStep));
      const subArcLength = segmentLength / subStepCount;
      let subStart = previous;
      for (let step = 1; step <= subStepCount; step++) {
        const sample = interpolateSample(previous, point, step / subStepCount);
        if (!visit(subStart, sample, subArcLength, isLastSegment && step === subStepCount)) break outer;
        subStart = sample;
      }
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
