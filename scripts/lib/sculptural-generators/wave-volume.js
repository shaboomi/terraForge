// Original height-field volume with orthographic projection and real strands.
export default async function run(input, p, context) {
  const e = sculptureEnvironment(input, p, context, "Wave Volume", "Increase Strand spacing, reduce Footprint width/depth or Surface complexity, or increase Sampling tolerance.");
  if (!Number.isInteger(p.complexity)) throw new Error("Surface complexity must be an integer.");
  if (!p.upper && !p.lower && !p.strands) throw new Error("Enable an upper surface, lower surface or connecting strands.");
  const tau = Math.PI * 2, phase = e.phases(0, 12), az = p.azimuth * Math.PI / 180, el = p.elevation * Math.PI / 180;
  const ca = Math.cos(az), sa = Math.sin(az), ce = Math.cos(el), se = Math.sin(el);
  const halfW = p.footprintWidth / 2, halfD = p.footprintDepth / 2;
  const amplitude = Math.min(p.amplitude, p.separation * 0.6);
  const shift = p.phaseDifference * Math.PI / 180;
  function field(x, y, delta) {
    const kx = tau * x / p.wavelength, ky = tau * y / p.wavelength;
    let sum = 0, weight = 0;
    for (let i = 0; i < p.complexity; i++) {
      const w = 1 / (1 + i * 1.6), f = 1 + i * 0.43;
      sum += w * Math.sin(kx * f * (i % 2 ? -0.56 : 0.92) + ky * f * (i % 2 ? 0.94 : 0.42) + phase[i] + delta * (1 + i * 0.19));
      weight += w;
    }
    return sum / weight;
  }
  function surface(x, y, upper) {
    const common = p.amplitude * 0.4 * field(x * 0.67, y * 0.67, 0);
    // Both fields lie in [-1,1]. Gap >= separation - 1.5*amplitude
    // >= 10% of separation, even at the most extreme phase difference.
    const z = common + (upper ? p.separation / 2 + amplitude * 0.55 * field(x, y, 0)
      : -p.separation / 2 + amplitude * 0.95 * field(x, y, shift));
    return e.transform(ca * x - sa * y, se * (sa * x + ca * y) - ce * z);
  }
  const nx = Math.max(2, Math.ceil(p.footprintWidth / p.spacing)), ny = Math.max(2, Math.ceil(p.footprintDepth / p.spacing));
  const hole = p.opening / 100, hx = halfW * hole, hy = halfD * hole;
  const holeCount = hole ? Math.max(12, Math.ceil(Math.PI * (hx + hy) / p.spacing)) : 0;
  const total = (nx + ny + 2) * (Number(p.upper) + Number(p.lower)) + (p.strands ? nx + ny + 1 + holeCount : 0);
  // A hole may split each surface curve in two.
  e.preflight(total * (hole ? 2 : 1) + (p.border ? 1 : 0));
  const upperInk = e.style(), lowerInk = p.penMode === "families" ? e.style(e.penAt(p.surfacePenIndex, e.penAt(p.penIndex))) : upperInk;
  let done = 0;
  const base = Math.max(16, Math.ceil(Math.max(p.footprintWidth, p.footprintDepth) / p.wavelength * (20 + p.complexity * 8)));
  function spans(fixed, fixedRadius, varyingRadius, halfExtent) {
    if (!hole || Math.abs(fixed) >= fixedRadius) return [[-halfExtent, halfExtent]];
    const edge = varyingRadius * Math.sqrt(1 - (fixed / fixedRadius) ** 2);
    return [[-halfExtent, -edge], [edge, halfExtent]];
  }
  for (const upper of [true, false]) {
    if (upper ? !p.upper : !p.lower) continue;
    const ink = upper ? upperInk : lowerInk;
    for (let i = 0; i <= ny; i++) {
      const y = -halfD + p.footprintDepth * i / ny;
      for (const [a, b] of spans(y, hy, hx, halfW)) e.emit(e.sample(x => surface(x, y, upper), a, b, base), false, ink);
      await e.checkpoint(++done, total);
    }
    for (let i = 0; i <= nx; i++) {
      const x = -halfW + p.footprintWidth * i / nx;
      for (const [a, b] of spans(x, hx, hy, halfD)) e.emit(e.sample(y => surface(x, y, upper), a, b, base), false, ink);
      await e.checkpoint(++done, total);
    }
  }
  if (p.strands) {
    const ink = p.penMode === "families" ? e.style(e.penAt(p.strandPenIndex, e.penAt(p.penIndex))) : upperInk;
    const strand = (x, y) => e.emit([surface(x, y, true), surface(x, y, false)], false, ink);
    // The two camera-facing sides. Exclude one shared corner to avoid a repeated stroke.
    const frontX = sa >= 0 ? halfW : -halfW, frontY = ca >= 0 ? halfD : -halfD;
    for (let i = 0; i <= nx; i++) { strand(-halfW + p.footprintWidth * i / nx, frontY); await e.checkpoint(++done, total); }
    for (let i = 0; i <= ny; i++) {
      const y = -halfD + p.footprintDepth * i / ny;
      if (Math.abs(y - frontY) < 1e-9) continue;
      strand(frontX, y); await e.checkpoint(++done, total);
    }
    for (let i = 0; i < holeCount; i++) {
      const theta = tau * i / holeCount;
      strand(hx * Math.cos(theta), hy * Math.sin(theta)); await e.checkpoint(++done, total);
    }
  }
  return e.finish();
}
