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

/** A counter edge must never disappear when resolving a thick crossing. */
function bridgeEdges(adjacent: Adjacency, edges: Edge[]): Set<number> {
  const discovery=new Map<number,number>(),low=new Map<number,number>(),parents=new Map<number,number>(),bridges=new Set<number>();
  let time=0;
  for(const root of adjacent.keys()) {
    if(discovery.has(root)) continue;
    discovery.set(root,++time);low.set(root,time);
    const stack=[{vertex:root,next:0}];
    while(stack.length) {
      const frame=stack.at(-1)!,ids=adjacent.get(frame.vertex)!;
      if(frame.next<ids.length) {
        const id=ids[frame.next++];
        if(parents.get(frame.vertex)===id) continue;
        const next=otherEnd(edges[id],frame.vertex);
        if(!discovery.has(next)) {
          parents.set(next,id);discovery.set(next,++time);low.set(next,time);stack.push({vertex:next,next:0});
        } else low.set(frame.vertex,Math.min(low.get(frame.vertex)!,discovery.get(next)!));
      } else {
        stack.pop();
        const id=parents.get(frame.vertex);
        if(id!==undefined) {
          const parent=otherEnd(edges[id],frame.vertex);
          if(low.get(frame.vertex)!>discovery.get(parent)!) bridges.add(id);
          low.set(parent,Math.min(low.get(parent)!,low.get(frame.vertex)!));
        }
      }
    }
  }
  return bridges;
}

/**
 * A thick crossing can thin to two T junctions connected by a tiny shared
 * corridor. Replace only that inscribed junction region with a common centre:
 * both crossing strokes can then continue without drawing the corridor twice.
 */
function reconstructJunctions(adjacent: Adjacency, edges: Edge[], points: Map<number,CenterlinePoint>) {
  const junctions=[...adjacent.keys()].filter((vertex) => adjacent.get(vertex)!.length>=3);
  if(junctions.length<2) return {adjacent,edges,points};
  const bridges=bridgeEdges(adjacent,edges),candidates:{a:number;b:number;vertices:number[];length:number}[]=[];
  for(const a of junctions) for(const id of adjacent.get(a)!) {
    if(!bridges.has(id)) continue;
    const vertices=[a];let previous=id,b=otherEnd(edges[id],a),length=edges[id].length;
    while(adjacent.get(b)!.length===2) {
      vertices.push(b);
      const next=adjacent.get(b)!.find((edge) => edge!==previous)!;
      previous=next;length+=edges[next].length;b=otherEnd(edges[next],b);
    }
    if(b<=a || adjacent.get(b)!.length<3 || length>Math.min(points.get(a)!.width,points.get(b)!.width)*0.75) continue;
    vertices.push(b);candidates.push({a,b,vertices,length});
  }
  if(!candidates.length) return {adjacent,edges,points};
  const owners=new Map<number,number>(),groups=new Map<number,{vertices:Set<number>;junctions:Set<number>;centre:CenterlinePoint}>();
  for(const candidate of candidates.sort((a,b) => a.length-b.length || a.a-b.a)) {
    const a=owners.get(candidate.a),b=owners.get(candidate.b);
    if(a!==undefined && a===b) continue;
    const ga=a===undefined?undefined:groups.get(a),gb=b===undefined?undefined:groups.get(b);
    const vertices=new Set([...candidate.vertices,...(ga?.vertices??[]),...(gb?.vertices??[])]);
    const members=new Set([candidate.a,candidate.b,...(ga?.junctions??[]),...(gb?.junctions??[])]);
    const coordinates=[...members].map((vertex) => points.get(vertex)!);
    const centre={x:coordinates.reduce((sum,p) => sum+p.x,0)/coordinates.length,
      y:coordinates.reduce((sum,p) => sum+p.y,0)/coordinates.length,
      width:[...vertices].reduce((maximum,vertex) => Math.max(maximum,points.get(vertex)!.width),0)};
    // Every displaced point and connecting segment remains inside each local
    // width disk. Only connected junctions qualify; nearby separate ink does not.
    if([...vertices].some((vertex) => {
      const p=points.get(vertex)!;return Math.hypot(p.x-centre.x,p.y-centre.y)>p.width/2;
    })) continue;
    let exits=0;
    for(const vertex of vertices) for(const id of adjacent.get(vertex)!) if(!vertices.has(otherEnd(edges[id],vertex))) exits++;
    if(exits<4 || exits>8) continue;
    const owner=Math.min(...members);
    if(a!==undefined) groups.delete(a);if(b!==undefined) groups.delete(b);
    groups.set(owner,{vertices,junctions:members,centre});
    for(const vertex of vertices) owners.set(vertex,owner);
  }
  if(!groups.size) return {adjacent,edges,points};
  const repairedPoints=new Map<number,CenterlinePoint>(),repairedAdjacent:Adjacency=new Map(),repairedEdges:Edge[]=[];
  for(const [vertex,p]of points) if(!owners.has(vertex)) {repairedPoints.set(vertex,p);repairedAdjacent.set(vertex,[]);}
  for(const [vertex,group]of groups) {repairedPoints.set(vertex,group.centre);repairedAdjacent.set(vertex,[]);}
  for(const edge of edges) {
    const a=owners.get(edge.a)??edge.a,b=owners.get(edge.b)??edge.b;
    if(a===b) continue;
    const pa=repairedPoints.get(a)!,pb=repairedPoints.get(b)!,id=repairedEdges.length;
    repairedEdges.push({a,b,length:Math.hypot(pb.x-pa.x,pb.y-pa.y),used:false});
    repairedAdjacent.get(a)!.push(id);repairedAdjacent.get(b)!.push(id);
  }
  return {adjacent:repairedAdjacent,edges:repairedEdges,points:repairedPoints};
}

/** Look beyond a single raster stair-step when estimating a branch's direction. */
function branchDirection(vertex: number, id: number, adjacent: Adjacency, edges: Edge[], points: Map<number,CenterlinePoint>) {
  const origin = points.get(vertex)!;
  const first = points.get(otherEnd(edges[id],vertex))!;
  const minimumEdge = Math.min(...adjacent.get(vertex)!.map((edge) => edges[edge].length));
  const reach = Math.max(origin.width*0.75,minimumEdge*3);
  let previous = id, next = otherEnd(edges[id],vertex), length = edges[id].length;
  const firstRatio=Math.min(1,reach/length);
  let tangent={...first,x:origin.x+(first.x-origin.x)*firstRatio,y:origin.y+(first.y-origin.y)*firstRatio};
  const visited = new Set([vertex]);
  // Corridors end at another real junction. Looking through that junction
  // would guess its stroke identity before its own branches have been paired.
  while (!visited.has(next)) {
    visited.add(next);
    const p = points.get(next)!;
    if (length <= reach) tangent=p;
    if (adjacent.get(next)!.length !== 2) break;
    const following = adjacent.get(next)!.find((edge) => edge !== previous)!;
    const step = edges[following].length;
    const target = points.get(otherEnd(edges[following],next))!;
    if (length < reach && length+step >= reach) {
      const ratio = (reach-length)/step;
      tangent={...p,x:p.x+(target.x-p.x)*ratio,y:p.y+(target.y-p.y)*ratio};
    }
    length+=step; next=otherEnd(edges[following],next); previous=following;
  }
  let dx=tangent.x-origin.x,dy=tangent.y-origin.y;
  let norm=Math.hypot(dx,dy);
  if (norm < 1e-12) { dx=first.x-origin.x;dy=first.y-origin.y;norm=Math.hypot(dx,dy); }
  return {id,x:dx/norm,y:dy/norm,length};
}

/** Exact small matching: raster junctions have at most eight incident edges. */
function pairJunction(vertex: number, adjacent: Adjacency, edges: Edge[], points: Map<number,CenterlinePoint>): Map<number,number> {
  const ids=adjacent.get(vertex)!;
  if (ids.length === 2) return new Map([[ids[0],ids[1]],[ids[1],ids[0]]]);
  if (ids.length < 2) return new Map();
  if (ids.length > 12) throw new Error("Font junction has too many overlapping branches. Reimport the original font to repair it.");
  const branches=ids.map((id) => branchDirection(vertex,id,adjacent,edges,points));
  let bestCost=Infinity,bestPairs: [number,number][]=[],bestLengths: number[]=[];
  const compareLengths=(a:number[],b:number[]) => {
    for(let i=0;i<Math.min(a.length,b.length);i++) if(Math.abs(a[i]-b[i])>1e-9) return a[i]-b[i];
    return 0;
  };
  const search=(remaining:number[],canSkip:boolean,cost:number,pairs:[number,number][]) => {
    if(cost>bestCost+1e-4) return;
    if(!remaining.length) {
      const lengths=pairs.map(([a,b]) => branches[a].length+branches[b].length).sort((a,b) => b-a);
      // Continuity wins over raw length. Physical lengths resolve practically
      // equal tangent choices; tiny raster zigzags cannot split a clear stem.
      if(cost<bestCost-1e-4 || Math.abs(cost-bestCost)<=1e-4 && compareLengths(lengths,bestLengths)>0) {
        bestCost=cost;bestPairs=pairs.slice();bestLengths=lengths;
      }
      return;
    }
    const [first,...rest]=remaining;
    if(canSkip) search(rest,false,cost,pairs);
    for(let i=0;i<rest.length;i++) {
      const second=rest[i],a=branches[first],b=branches[second];
      const turn=1+Math.max(-1,Math.min(1,a.x*b.x+a.y*b.y));
      search(rest.filter((_,index) => index!==i),canSkip,cost+turn*turn,[...pairs,[first,second]]);
    }
  };
  search(branches.map((_,i) => i),branches.length%2===1,0,[]);
  const paired=new Map<number,number>();
  for(const [a,b]of bestPairs) { paired.set(branches[a].id,branches[b].id);paired.set(branches[b].id,branches[a].id); }
  return paired;
}

function traceGraph(adjacent: Adjacency, edges: Edge[], points: Map<number,CenterlinePoint>): CenterlineStroke[] {
  ({adjacent,edges,points}=reconstructJunctions(adjacent,edges,points));
  const paired=new Map<number,Map<number,number>>();
  for(const vertex of adjacent.keys()) paired.set(vertex,pairJunction(vertex,adjacent,edges,points));
  const trails: TracedTrail[]=[];
  const walk=(start:number,firstEdge:number) => {
    const vertices=[start];let vertex=start,id=firstEdge,length=0;
    while(!edges[id].used) {
      const edge=edges[id];edge.used=true;length+=edge.length;
      vertex=otherEnd(edge,vertex);vertices.push(vertex);
      const next=paired.get(vertex)!.get(id);
      if(next===undefined) break;
      id=next;
    }
    if(vertices.length>1) trails.push({vertices,length});
  };
  // Begin at all unpaired branch ends, then cover any remaining closed loops.
  // An X therefore stays two crossing strokes, rather than an Euler detour
  // that turns off the stem simply to reduce the number of pen lifts.
  for(const [vertex,ids]of adjacent) for(const id of ids) {
    if(!edges[id].used && !paired.get(vertex)!.has(id)) walk(vertex,id);
  }
  for(let id=0;id<edges.length;id++) if(!edges[id].used) walk(edges[id].a,id);
  const paths=trails.sort((a,b) => b.length-a.length).map((trail) => ({points:trail.vertices.map((vertex) => points.get(vertex)!)}));
  for(const [vertex,ids]of adjacent) if(!ids.length) {
    const p=points.get(vertex)!;
    paths.push({points:[{...p,x:p.x-p.width/8},{...p,x:p.x+p.width/8}]});
  }
  return paths.sort((a,b) => strokeLength(b.points)-strokeLength(a.points));
}

/** Resolve local thick crossings, then pair smooth continuations before ranking by length. */
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
  return traceGraph(adjacent,edges,points);
}

/** Repair an older decomposition using its actual shared junctions, never nearest paths. */
export function reconnectCenterlineStrokes(paths: CenterlineStroke[], tolerance: number): CenterlineStroke[] {
  if(!Number.isFinite(tolerance) || tolerance<=0) throw new Error("Font junction repair needs a positive numerical tolerance.");
  const adjacent: Adjacency=new Map(),edges:Edge[]=[],points=new Map<number,CenterlinePoint>(),byCoordinate=new Map<string,number>();
  let count=0;
  const vertex=(p:CenterlinePoint) => {
    if(![p.x,p.y,p.width].every(Number.isFinite) || p.width<=0) throw new Error("Saved font contains an invalid centreline point.");
    const key=`${p.x},${p.y}`,found=byCoordinate.get(key);
    if(found!==undefined) {
      const shared=points.get(found)!;
      if(p.width>shared.width) points.set(found,{...shared,width:p.width});
      return found;
    }
    const id=points.size;points.set(id,{...p});adjacent.set(id,[]);byCoordinate.set(key,id);return id;
  };
  const ids=paths.map((path) => {
    count+=path.points.length;
    if(count>600_000) throw new Error("Saved font junction repair exceeds its geometry limit. Reimport the original font.");
    if(path.points.length<2) throw new Error("Saved font contains an incomplete centreline stroke.");
    return path.points.map(vertex);
  });
  const endpointIds=new Set(ids.flatMap((path) => [path[0],path.at(-1)!]));
  const endpoints=[...endpointIds].map((id) => ({id,...points.get(id)!})).sort((a,b) => a.x-b.x || a.y-b.y);
  const lowerBound=(x:number) => {
    let low=0,high=endpoints.length;
    while(low<high) { const mid=(low+high)>>>1;if(endpoints[mid].x<x) low=mid+1;else high=mid; }
    return low;
  };
  const addEdge=(a:number,b:number) => {
    if(a===b) return;
    const pa=points.get(a)!,pb=points.get(b)!,id=edges.length;
    edges.push({a,b,length:Math.hypot(pb.x-pa.x,pb.y-pa.y),used:false});adjacent.get(a)!.push(id);adjacent.get(b)!.push(id);
  };
  let checks=0;
  for(const path of ids) for(let i=1;i<path.length;i++) {
    const a=points.get(path[i-1])!,b=points.get(path[i])!,dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
    if(!length2) continue;
    const cuts=[{id:path[i-1],t:0},{id:path[i],t:1}];
    const maxX=Math.max(a.x,b.x)+tolerance,minY=Math.min(a.y,b.y)-tolerance,maxY=Math.max(a.y,b.y)+tolerance;
    for(let j=lowerBound(Math.min(a.x,b.x)-tolerance);j<endpoints.length && endpoints[j].x<=maxX;j++) {
      if(++checks>4_000_000) throw new Error("Saved font junction repair is too complex. Reimport the original font to repair its strokes.");
      const p=endpoints[j];
      if(p.id===path[i-1] || p.id===path[i] || p.y<minY || p.y>maxY) continue;
      const t=((p.x-a.x)*dx+(p.y-a.y)*dy)/length2;
      if(t<=1e-9 || t>=1-1e-9) continue;
      if(Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=tolerance) cuts.push({id:p.id,t});
    }
    cuts.sort((a,b) => a.t-b.t || a.id-b.id);
    for(let j=1;j<cuts.length;j++) addEdge(cuts[j-1].id,cuts[j].id);
  }
  return traceGraph(adjacent,edges,points);
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
