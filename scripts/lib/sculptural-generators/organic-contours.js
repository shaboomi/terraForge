// Original nested sculpture. Every deformation below is invertible: radial
// scaling, positive pinch, polar swirl and two triangular Cartesian shears.
export default async function run(input, p, context) {
  const e = sculptureEnvironment(input, p, context, "Organic Contours", "Reduce Contour count/Lobes/Warp scale or increase Sampling tolerance.");
  if (!Number.isInteger(p.count) || !Number.isInteger(p.lobes)) throw new Error("Contour count and Lobes must be integers.");
  e.preflight(p.count + (p.border ? 1 : 0));
  const phase = e.phases(0), tau = 2 * Math.PI;
  function deform(r, theta) {
    const radial = Math.exp(p.lobeStrength * 0.32 * Math.cos(p.lobes * theta + phase[0]) + p.variation * 0.06 * Math.sin(2 * theta + phase[1]));
    let x = r * radial * Math.cos(theta), y = r * radial * Math.sin(theta);
    x *= 1 - p.pinch * 0.88 * Math.exp(-(((y - p.pinchPosition) / 0.32) ** 2));
    const radius = Math.hypot(x, y), angle = Math.atan2(y, x) + p.twist * 1.3 * radius * radius;
    x = radius * Math.cos(angle); y = radius * Math.sin(angle);
    x += p.warp * (0.28 * Math.sin(p.warpScale * y + phase[2]) + 0.09 * Math.sin(p.warpScale * y * 1.79 + phase[3]));
    y += p.warp * 0.22 * Math.sin(p.warpScale * x + phase[4]);
    return { x, y };
  }
  // Fixed outer-boundary measurement is independent of contour density and
  // sampling tolerance. A 1.5% guard keeps the default outer path off the frame.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < 4096; i++) {
    if (i % 512 === 0) e.check();
    const v = deform(1, tau * i / 4096);
    minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
  }
  const artW = p.width - 2 * p.margin, artH = p.height - 2 * p.margin;
  // Final positive affine stretch makes Base aspect ratio predictable even
  // when a strong shear has changed the unscaled field's bounding rectangle.
  const scaleX = Math.min(artW, artH * p.aspect) / (maxX - minX) * 0.985;
  const scaleY = Math.min(artH, artW / p.aspect) / (maxY - minY) * 0.985;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, ink = e.style();
  const base = Math.max(64, p.lobes * 12, Math.ceil(p.warpScale * 16 + Math.abs(p.twist) * 32));
  for (let i = 0; i < p.count; i++) {
    const s = i / (p.count - 1), radius = p.opening / 100 + (1 - p.opening / 100) * s ** Math.exp(p.bias * 1.5);
    e.emit(e.sample(theta => {
      const v = deform(radius, theta);
      return e.transform((v.x - cx) * scaleX, (v.y - cy) * scaleY);
    }, 0, tau, base), true, ink);
    await e.checkpoint(i + 1, p.count);
  }
  return e.finish();
}
