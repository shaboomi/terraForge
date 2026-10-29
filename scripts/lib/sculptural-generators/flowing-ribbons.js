// Original parametric ribbon surfaces; no photograph tracing or artist code.
export default async function run(input, p, context) {
  const e = sculptureEnvironment(input, p, context, "Flowing Ribbons", "Increase Line spacing, reduce Ribbon count/Crossweave, or increase Sampling tolerance.");
  if (!Number.isInteger(p.ribbonCount)) throw new Error("Ribbon count must be an integer.");
  const tau = Math.PI * 2, braid = p.preset === "braid", length = p.height - 2 * p.margin - p.ribbonWidth * 0.55;
  if (length <= 1) throw new Error("Increase Artwork height or reduce Ribbon width/Margin.");
  const longitudinal = Math.max(2, Math.ceil(p.ribbonWidth / p.spacing));
  const transverse = p.crossweave === 0 ? 0 : Math.max(2, Math.ceil(length * p.crossweave * (braid ? 0.28 : 1) / p.spacing));
  const total = p.ribbonCount * (longitudinal + 1 + transverse);
  e.preflight(total + (p.border ? 1 : 0));
  if (p.penMode === "ribbons" && !e.palette.length) throw new Error("Pens by ribbon needs configured pens. Add pens or choose Single pen/colour.");
  // Each ribbon has an independent seeded stream; adding density or another
  // ribbon never consumes the phase values of an existing component.
  const surface = Array.from({ length: p.ribbonCount }, (_, index) => {
    const phase = e.phases(index), offset = index - (p.ribbonCount - 1) / 2;
    return (u, t) => {
      const s = (t - 0.5) * length, k = tau * s / p.wavelength;
      const between = index * p.phaseVariation;
      const smooth = p.irregularity * p.variation * (0.7 * Math.sin(tau * s / p.irregularityScale + phase[3]) + 0.3 * Math.sin(tau * s / (p.irregularityScale * 1.73) + phase[4]));
      const bend = p.bend * (Math.sin(k * 0.67 + between + phase[0] * 0.25) + 0.32 * Math.sin(k * 1.17 - between + phase[1] * 0.25));
      const twist = braid
        ? p.twist * (k * 0.34 + between * 1.7 + phase[2] * 0.2)
        : p.twist * (0.9 * Math.sin(k * 0.8 + between + phase[2] * 0.2) + 0.25 * Math.sin(k * 1.7 + phase[5] * 0.2));
      const envelope = 0.91 + 0.09 * Math.sin(k * 0.91 + between);
      const centre = braid
        ? offset * p.separation * 0.55 + bend * 1.55 + p.ribbonWidth * 0.67 * Math.sin(k * 0.43 + between * 2.1)
        : offset * (p.ribbonWidth + p.separation) + bend + smooth;
      const x = centre + u * p.ribbonWidth * 0.5 * envelope * Math.cos(twist)
        + (braid ? smooth : 0) + p.ribbonWidth * 0.085 * Math.sin(Math.PI * u) * Math.sin(k + between);
      const y = s + u * p.ribbonWidth * 0.31 * Math.sin(twist)
        + p.ribbonWidth * 0.11 * (1 - u * u) * Math.sin(k * 1.2 + 2.2 * u + phase[6] * 0.15);
      return e.transform(x, y);
    };
  });
  const base = Math.max(24, Math.ceil(length / p.wavelength * (24 + p.twist * 12)), Math.ceil(length / p.irregularityScale * 20));
  let done = 0;
  for (let index = 0; index < p.ribbonCount; index++) {
    const ink = p.penMode === "ribbons" ? e.style(e.palette[index % e.palette.length].id) : e.style();
    const crossInk = p.penMode === "families" ? e.style(e.penAt(p.crossPenIndex, e.penAt(p.penIndex))) : ink;
    for (let line = 0; line <= longitudinal; line++) {
      const u = -1 + 2 * line / longitudinal;
      e.emit(e.sample(t => surface[index](u, t), 0, 1, base), false, ink);
      await e.checkpoint(++done, total);
    }
    // Sample at cell centres: avoid drawing the same boundary twice.
    for (let line = 0; line < transverse; line++) {
      const t = (line + 0.5) / transverse;
      e.emit(e.sample(u => surface[index](u, t), -1, 1, 8), false, crossInk);
      await e.checkpoint(++done, total);
    }
  }
  return e.finish();
}
