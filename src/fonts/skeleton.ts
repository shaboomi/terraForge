import type { CenterlinePoint, CenterlineStroke } from "../types/fonts";

/** Exact squared Euclidean distance to the nearest outside pixel (two 1-D passes). */
export function distanceField(mask: Uint8Array, width: number, height: number): Float64Array {
  const result = new Float64Array(mask.length);
  const temporary = new Float64Array(mask.length);
  const n = Math.max(width, height);
  const f = new Float64Array(n), d = new Float64Array(n);
  const sites = new Int32Array(n), bounds = new Float64Array(n + 1);
  const transform = (length: number) => {
    let k = 0;
    sites[0] = 0; bounds[0] = -Infinity; bounds[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let s = ((f[q] + q * q) - (f[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
      while (s <= bounds[k]) {
        k--;
        s = ((f[q] + q * q) - (f[sites[k]] + sites[k] * sites[k])) / (2 * (q - sites[k]));
      }
      k++; sites[k] = q; bounds[k] = s; bounds[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (bounds[k + 1] < q) k++;
      d[q] = (q - sites[k]) ** 2 + f[sites[k]];
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = mask[y * width + x] ? 1e12 : 0;
    transform(width);
    for (let x = 0; x < width; x++) temporary[y * width + x] = d[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = temporary[y * width + x];
    transform(height);
    for (let y = 0; y < height; y++) result[y * width + x] = d[y];
  }
  return result;
}

/** Zhang–Suen topology-preserving thinning, retaining counters and disconnected marks. */
export function thinMask(source: Uint8Array, width: number, height: number): Uint8Array {
  const mask = source.slice();
  const remove: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let phase = 0; phase < 2; phase++) {
      remove.length = 0;
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const p = [mask[i-width], mask[i-width+1], mask[i+1], mask[i+width+1], mask[i+width], mask[i+width-1], mask[i-1], mask[i-width-1]];
        const count = p.reduce((sum, pixel) => sum + pixel, 0);
        if (count < 2 || count > 6) continue;
        let transitions = 0;
        for (let j = 0; j < 8; j++) if (!p[j] && p[(j + 1) % 8]) transitions++;
        if (transitions !== 1) continue;
        if (phase === 0 ? p[0]*p[2]*p[4] || p[2]*p[4]*p[6] : p[0]*p[2]*p[6] || p[0]*p[4]*p[6]) continue;
        remove.push(i);
      }
      if (remove.length) changed = true;
      for (const i of remove) mask[i] = 0;
    }
  }
  return mask;
}

interface Edge { a: number; b: number; used: boolean }

/**
 * Euler decomposition covers each skeleton edge once with the minimum possible
 * number of continuous trails per connected component (odd vertices / 2).
 * Unlike stopping at every junction, loops become part of the continuous stroke.
 */
export function traceSkeleton(mask: Uint8Array, width: number, height: number, point: (index: number) => CenterlinePoint): CenterlineStroke[] {
  const adjacent = new Map<number, number[]>();
  const edges: Edge[] = [];
  const addEdge = (a: number, b: number) => {
    const id = edges.length; edges.push({ a, b, used: false });
    adjacent.get(a)!.push(id); adjacent.get(b)!.push(id);
  };
  for (let i = 0; i < mask.length; i++) if (mask[i]) adjacent.set(i, []);
  for (const i of adjacent.keys()) {
    const x = i % width, y = Math.floor(i / width);
    for (const [dx, dy] of [[1,0],[0,1],[1,1],[-1,1]]) {
      const nx = x + dx, ny = y + dy, next = ny * width + nx;
      if (nx < 0 || nx >= width || ny >= height || !mask[next]) continue;
      // A diagonal next to a cardinal edge would introduce a triangle and a false junction.
      if (dx && dy && (mask[y * width + nx] || mask[ny * width + x])) continue;
      addEdge(i, next);
    }
  }
  const paths: CenterlineStroke[] = [], seen = new Set<number>();
  for (const start of [...adjacent.keys()]) {
    if (seen.has(start)) continue;
    const component: number[] = [], queue = [start]; seen.add(start);
    for (let q = 0; q < queue.length; q++) {
      const v = queue[q]; component.push(v);
      for (const id of adjacent.get(v)!) {
        const e = edges[id], other = e.a === v ? e.b : e.a;
        if (!seen.has(other)) { seen.add(other); queue.push(other); }
      }
    }
    if (component.length === 1) {
      const p = point(start);
      paths.push({ points: [{ ...p, x: p.x - p.width / 8 }, { ...p, x: p.x + p.width / 8 }] });
      continue;
    }
    const odd = component.filter((v) => adjacent.get(v)!.length % 2);
    const hub = -1;
    adjacent.set(hub, []);
    for (const v of odd) addEdge(hub, v);
    const stack = [odd.length ? hub : start], circuit: number[] = [];
    // Prefer natural edges before virtual hub edges. Hierholzer splices loops
    // into an existing trail rather than lifting at the join.
    while (stack.length) {
      const v = stack[stack.length - 1], ids = adjacent.get(v)!;
      const id = ids.find((id) => !edges[id].used);
      if (id === undefined) { circuit.push(stack.pop()!); continue; }
      edges[id].used = true;
      stack.push(edges[id].a === v ? edges[id].b : edges[id].a);
    }
    circuit.reverse();
    let points: CenterlinePoint[] = [];
    const flush = () => { if (points.length > 1) paths.push({ points }); points = []; };
    for (const v of circuit) {
      if (v === hub) flush();
      else points.push(point(v));
    }
    flush(); adjacent.delete(hub);
  }
  return paths.sort((a, b) => strokeLength(b.points) - strokeLength(a.points));
}

function strokeLength(points: CenterlinePoint[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += Math.hypot(points[i].x-points[i-1].x, points[i].y-points[i-1].y);
  return length;
}

/** Drop straight raster stair-steps while retaining local width variation. */
export function simplifyStroke(points: CenterlinePoint[], tolerance: number): CenterlinePoint[] {
  if (points.length <= 2) return points;
  const kept = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!, a = points[first], b = points[last];
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    let maximum = tolerance, selected = -1;
    for (let i = first + 1; i < last; i++) {
      const p = points[i], t = length2 ? Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/length2)) : 0;
      const deviation = Math.max(Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy), Math.abs(p.width-(a.width+t*(b.width-a.width))) / 2);
      if (deviation > maximum) { maximum = deviation; selected = i; }
    }
    if (selected !== -1) { kept.add(selected); stack.push([first, selected], [selected, last]); }
  }
  return [...kept].sort((a,b) => a-b).map((i) => points[i]);
}
