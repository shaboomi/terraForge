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

interface Edge { a: number; b: number; length: number; used: boolean }
interface TracedTrail { vertices: number[]; length: number }
type Adjacency = Map<number, number[]>;

function otherEnd(edge: Edge, vertex: number): number { return edge.a === vertex ? edge.b : edge.a; }

function treeWalk(start: number, adjacent: Adjacency, edges: Edge[]) {
  const parent = new Map<number, { vertex: number; edge: number }>();
  const queue = [{ vertex:start, previous:-1, distance:0 }];
  let farthest = queue[0];
  for (let q = 0; q < queue.length; q++) {
    const item = queue[q];
    if (item.distance >= farthest.distance) farthest = item;
    for (const id of adjacent.get(item.vertex)!) {
      const edge = edges[id], next = otherEnd(edge,item.vertex);
      if (edge.used || next === item.previous) continue;
      parent.set(next,{ vertex:item.vertex,edge:id });
      queue.push({ vertex:next,previous:item.vertex,distance:item.distance+edge.length });
    }
  }
  return { farthest:farthest.vertex,length:farthest.distance,parent };
}

/** Each tree diameter is a proven longest remaining trail, not just a long ordering. */
function traceTree(start: number, adjacent: Adjacency, edges: Edge[]): TracedTrail[] {
  const pending = [start], trails: TracedTrail[] = [];
  while (pending.length) {
    const seed = pending.pop()!;
    if (!adjacent.get(seed)!.some((id) => !edges[id].used)) continue;
    const from = treeWalk(seed,adjacent,edges).farthest;
    const walk = treeWalk(from,adjacent,edges);
    const vertices = [walk.farthest];
    let current = walk.farthest;
    while (current !== from) {
      const previous = walk.parent.get(current)!;
      edges[previous.edge].used = true;
      current = previous.vertex; vertices.push(current);
    }
    trails.push({ vertices,length:walk.length });
    // A residual tree component can meet the removed diameter at only one
    // vertex, so these seeds cover the remaining branches without duplication.
    for (const vertex of vertices) if (adjacent.get(vertex)!.some((id) => !edges[id].used)) pending.push(vertex);
  }
  return trails;
}

function betterTrails(candidate: TracedTrail[], current: TracedTrail[]): boolean {
  for (let i = 0; i < Math.min(candidate.length,current.length); i++) {
    const tolerance = 1e-9*Math.max(1,candidate[i].length,current[i].length);
    if (candidate[i].length > current[i].length+tolerance) return true;
    if (candidate[i].length < current[i].length-tolerance) return false;
  }
  return false;
}

/** Look through a degree-two corridor once, rather than valuing every branch as one pixel. */
function branchLengths(component: number[], adjacent: Adjacency, edges: Edge[]): Map<number, number> {
  const lengths = new Map<number,number>();
  for (const vertex of component) {
    if (adjacent.get(vertex)!.length <= 2) continue;
    for (const id of adjacent.get(vertex)!) {
      let previous = id, next = otherEnd(edges[id],vertex), length = edges[id].length;
      while (adjacent.get(next)!.length === 2) {
        const following = adjacent.get(next)!.find((edge) => edge !== previous)!;
        length += edges[following].length;
        next = otherEnd(edges[following],next); previous = following;
      }
      // Every corridor has a different oriented edge at its two ends. Its
      // starting edge identifies this orientation without a string-key map.
      lengths.set(id*2+(edges[id].a === vertex ? 0 : 1),length);
    }
  }
  return lengths;
}

function chooseContinuation(vertex: number, stack: number[], adjacent: Adjacency, edges: Edge[],
  points: Map<number,CenterlinePoint>, lengths: Map<number,number>, variant: number): number | undefined {
  const ids = adjacent.get(vertex)!.filter((id) => !edges[id].used);
  if (ids.length < 2 || variant === 0 || vertex === -1) return ids[0];
  // Leave a virtual hub only after all real continuation choices are exhausted.
  const real = ids.filter((id) => edges[id].a !== -1 && edges[id].b !== -1);
  if (!real.length) return ids[0];
  const origin = points.get(vertex)!;
  let previous: CenterlinePoint | undefined;
  for (let i = stack.length-2; i >= Math.max(0,stack.length-5); i--) {
    if (stack[i] === -1) break;
    previous = points.get(stack[i]);
  }
  const headingX = previous ? origin.x-previous.x : 0, headingY = previous ? origin.y-previous.y : 0;
  const headingLength = Math.hypot(headingX,headingY);
  const scores = (id: number) => {
    const next = points.get(otherEnd(edges[id],vertex))!;
    const alignment = headingLength ? ((next.x-origin.x)*headingX+(next.y-origin.y)*headingY)/(edges[id].length*headingLength) : 0;
    const length = lengths.get(id*2+(edges[id].a === vertex ? 0 : 1)) ?? edges[id].length;
    return variant % 2 ? [length,alignment] : [alignment,length];
  };
  let selected = real[0], best = scores(selected);
  for (const id of real.slice(1)) {
    const score = scores(id);
    if (score[0] > best[0]+1e-9 || Math.abs(score[0]-best[0]) <= 1e-9 && score[1] > best[1]+1e-9) { selected=id;best=score; }
  }
  return selected;
}

function traceEuler(start: number, adjacent: Adjacency, edges: Edge[], points: Map<number,CenterlinePoint>,
  lengths: Map<number,number>, variant: number): TracedTrail[] {
  const stack = [start], circuit: number[] = [];
  while (stack.length) {
    const vertex = stack[stack.length-1];
    const id = chooseContinuation(vertex,stack,adjacent,edges,points,lengths,variant);
    if (id === undefined) { circuit.push(stack.pop()!); continue; }
    edges[id].used = true; stack.push(otherEnd(edges[id],vertex));
  }
  circuit.reverse();
  const trails: TracedTrail[] = [];
  let vertices: number[] = [], length = 0;
  const flush = () => { if (vertices.length > 1) trails.push({ vertices,length }); vertices=[];length=0; };
  for (const vertex of circuit) {
    if (vertex === -1) { flush();continue; }
    if (vertices.length) {
      const a = points.get(vertices.at(-1)!)!, b = points.get(vertex)!;
      length += Math.hypot(b.x-a.x,b.y-a.y);
    }
    vertices.push(vertex);
  }
  flush();
  return trails.sort((a,b) => b.length-a.length);
}

function traceCyclic(component: number[], ids: number[], adjacent: Adjacency, edges: Edge[],
  points: Map<number,CenterlinePoint>): TracedTrail[] {
  const odd = component.filter((vertex) => adjacent.get(vertex)!.length%2);
  const lengths = branchLengths(component,adjacent,edges);
  const firstVirtual = edges.length;
  const virtual = odd.map((vertex) => {
    const id = edges.length;edges.push({a:-1,b:vertex,length:0,used:false});adjacent.get(vertex)!.push(id);return id;
  });
  // A hub joins odd vertices solely while computing the Euler tour. Splitting
  // at the hub yields exactly odd/2 real trails; no virtual edge is plotted.
  adjacent.set(-1,virtual);
  const candidates = odd.length > 2 ? Math.min(16,Math.max(2,Math.floor(120_000/ids.length))) : 1;
  const prioritized = [...virtual].sort((a,b) => {
    const rank = (id: number) => Math.max(...adjacent.get(edges[id].b)!.filter((edge) => edge < firstVirtual)
      .map((edge) => lengths.get(edge*2+(edges[edge].a === edges[id].b ? 0 : 1)) ?? edges[edge].length));
    return rank(b)-rank(a) || edges[a].b-edges[b].b;
  });
  let best: TracedTrail[] = [];
  for (let variant = 0; variant < candidates; variant++) {
    for (const id of ids) edges[id].used=false;
    for (const id of virtual) edges[id].used=false;
    if (variant) {
      const seeds = Math.ceil((candidates-1)/2);
      const offset = Math.floor(Math.floor((variant-1)/2)*prioritized.length/seeds);
      adjacent.set(-1,[...prioritized.slice(offset),...prioritized.slice(0,offset)]);
    }
    const candidate = traceEuler(odd.length ? -1 : component[0],adjacent,edges,points,lengths,variant);
    if (!best.length || betterTrails(candidate,best)) best=candidate;
  }
  for (const vertex of odd) adjacent.get(vertex)!.pop();
  adjacent.delete(-1); edges.length=firstVirtual;
  return best;
}

/**
 * Cover every skeleton edge exactly once, with the minimum possible number of
 * trails per component, and prioritize the longest physical strokes first.
 * Trees use exact weighted diameters. Cyclic graphs retain the best of at most
 * 16 deterministic Euler decompositions: this is a bounded longest-first
 * heuristic, not a claim to solve the general longest-trail problem optimally.
 */
export function traceSkeleton(mask: Uint8Array, width: number, height: number, point: (index: number) => CenterlinePoint): CenterlineStroke[] {
  const adjacent = new Map<number, number[]>();
  const edges: Edge[] = [];
  const points = new Map<number,CenterlinePoint>();
  const addEdge = (a: number, b: number) => {
    const pa=points.get(a)!,pb=points.get(b)!;
    const id = edges.length; edges.push({ a,b,length:Math.hypot(pb.x-pa.x,pb.y-pa.y),used:false });
    adjacent.get(a)!.push(id); adjacent.get(b)!.push(id);
  };
  for (let i = 0; i < mask.length; i++) if (mask[i]) { adjacent.set(i, []);points.set(i,point(i)); }
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
      const p = points.get(start)!;
      paths.push({ points: [{ ...p, x: p.x - p.width / 8 }, { ...p, x: p.x + p.width / 8 }] });
      continue;
    }
    const ids = component.flatMap((vertex) => adjacent.get(vertex)!.filter((id) => edges[id].a === vertex));
    const trails = ids.length === component.length-1 ? traceTree(start,adjacent,edges) : traceCyclic(component,ids,adjacent,edges,points);
    for (const trail of trails) paths.push({points:trail.vertices.map((vertex) => points.get(vertex)!)});
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
