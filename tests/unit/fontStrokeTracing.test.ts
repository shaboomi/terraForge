import { describe,expect,it } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "opentype.js";
import type { CenterlinePoint,CenterlineStroke } from "../../src/types/fonts";
import { reconnectCenterlineStrokes, traceSkeleton } from "../../src/fonts/skeleton";
import { centerlineFromOutline } from "../../src/fonts/processor";

type Pixel = [number,number];
function fixture(width: number,height: number,lines: Pixel[][],mapPoint?: (x:number,y:number) => CenterlinePoint) {
  const mask = new Uint8Array(width*height), edges = new Set<string>();
  const point = (x:number,y:number) => mapPoint?.(x,y) ?? {x,y,width:1+(x+y)/100};
  const key = (a:CenterlinePoint,b:CenterlinePoint) => [`${a.x},${a.y}`,`${b.x},${b.y}`].sort().join("|");
  for (const line of lines) for (let index=0;index<line.length;index++) {
    const [x,y] = line[index];mask[y*width+x]=1;
    if (index) edges.add(key(point(...line[index-1]),point(x,y)));
  }
  const trace = () => traceSkeleton(mask,width,height,(index) => point(index%width,Math.floor(index/width)));
  const expectExactCoverage = (paths: CenterlineStroke[]) => {
    const actual: string[] = [];
    for (const path of paths) for (let index=1;index<path.points.length;index++) {
      actual.push(key(path.points[index-1],path.points[index]));
    }
    // Comparing arrays also catches duplicate/retraced edges, not just missing
    // ones. Every drawn link must be one of the original skeleton segments.
    expect(actual.sort()).toEqual([...edges].sort());
    for (const path of paths) for (const p of path.points) {
      expect(Number.isFinite(p.width)).toBe(true);
      expect(p.width).toBeGreaterThan(0);
    }
  };
  return { trace,expectExactCoverage };
}
function line(a:Pixel,b:Pixel): Pixel[] {
  const length = Math.max(Math.abs(b[0]-a[0]),Math.abs(b[1]-a[1]));
  return Array.from({length:length+1},(_,i) => [a[0]+Math.sign(b[0]-a[0])*i,a[1]+Math.sign(b[1]-a[1])*i]);
}
function lengths(paths:CenterlineStroke[]): number[] {
  return paths.map((path) => path.points.slice(1).reduce((sum,p,i) => sum+Math.hypot(p.x-path.points[i].x,p.y-path.points[i].y),0));
}

describe("continuous skeleton stroke tracing",() => {
  it("preserves the complete long stem instead of splitting it into two balanced strokes",() => {
    const sample = fixture(25,25,[line([10,1],[10,21]),line([10,11],[12,11])]);
    const paths = sample.trace();
    // The former arbitrary hub traversal yielded [12,10] on this same graph.
    expect(lengths(paths)).toEqual([20,2]);
    expect(paths).toHaveLength(2); // Four odd vertices, the minimum is two trails.
    sample.expectExactCoverage(paths);
  });
  it("makes the same longest-first choice for rotated and reflected branch geometry",() => {
    for (const transform of [([x,y]:Pixel):Pixel => [24-y,x],([x,y]:Pixel):Pixel => [24-x,24-y],([x,y]:Pixel):Pixel => [y,24-x]]) {
      const sample = fixture(25,25,[line([10,1],[10,21]).map(transform),line([10,11],[12,11]).map(transform)]);
      const paths = sample.trace();
      expect(lengths(paths)).toEqual([20,2]);sample.expectExactCoverage(paths);
    }
  });
  it("keeps a straight stem intact even when a physical scaling makes its side branch longer",() => {
    const sample = fixture(25,25,[line([10,1],[10,21]),line([10,11],[12,11])],(x,y) => ({x:x*10,y,width:2}));
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([20,20]);sample.expectExactCoverage(paths);
  });
  it("keeps a dominant stroke through an even-degree junction and covers residual branches once",() => {
    const sample = fixture(25,25,[line([10,1],[10,21]),line([8,11],[12,11])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([20,4]);sample.expectExactCoverage(paths);
  });
  it("keeps a counter continuous instead of turning out into its crossing tail",() => {
    const sample = fixture(12,12,[line([2,2],[8,2]),line([8,2],[8,8]),line([8,8],[2,8]),line([2,8],[2,2]),line([0,5],[2,5])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([24,2]);sample.expectExactCoverage(paths);
  });
  it("keeps a pure closed loop intact without connecting across its counter",() => {
    const sample = fixture(12,12,[line([2,2],[8,2]),line([8,2],[8,8]),line([8,8],[2,8]),line([2,8],[2,2])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([24]);expect(paths[0].points[0]).toEqual(paths[0].points.at(-1));
    sample.expectExactCoverage(paths);
  });
  it("keeps a closed counter and crossing arms separate when an Euler tour would break their continuations",() => {
    const sample = fixture(21,21,[line([4,4],[12,4]),line([12,4],[12,12]),line([12,12],[4,12]),line([4,12],[4,4]),
      line([8,1],[8,4]),line([8,12],[8,17]),line([1,8],[4,8]),line([12,8],[18,8])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([32,6,5,3,3]);
    sample.expectExactCoverage(paths);
  });
  it("traces diagonal edges without substituting straight links between branches",() => {
    const sample = fixture(17,17,[line([2,2],[14,14]),line([8,8],[10,6])]);
    const paths = sample.trace();
    expect(paths).toHaveLength(2);
    expect(lengths(paths)[0]).toBeCloseTo(12*Math.SQRT2);
    sample.expectExactCoverage(paths);
  });
  it("is deterministic and orders disconnected component strokes by length",() => {
    const sample = fixture(35,25,[line([10,1],[10,21]),line([10,11],[12,11]),
      line([26,3],[30,3]),line([30,3],[30,7]),line([30,7],[26,7]),line([26,7],[26,3])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([20,16,2]);expect(sample.trace()).toEqual(paths);
    sample.expectExactCoverage(paths);
  });
  it("keeps the complete F stem through unequal crossbars instead of chasing a longer bar at either junction",() => {
    const stem=line([8,2],[8,26]),arms=[line([8,6],[28,6]),line([8,13],[25,13])];
    for(const transform of [([x,y]:Pixel):Pixel => [x,y],([x,y]:Pixel):Pixel => [31-y,x],([x,y]:Pixel):Pixel => [31-x,31-y]]) {
      const fullStem=stem.map(transform),sample=fixture(32,32,[fullStem,...arms.map((arm) => arm.map(transform))]);
      const paths=sample.trace();
      expect(paths.some((path) => {
        const actual=path.points.map((p) => [p.x,p.y]);
        return JSON.stringify(actual)===JSON.stringify(fullStem) || JSON.stringify(actual)===JSON.stringify([...fullStem].reverse());
      })).toBe(true);
      expect(lengths(paths)).toEqual([24,20,17]);
      sample.expectExactCoverage(paths);
    }
  });
  it("recognizes a slanted raster stem with curved serif ends through a much longer bar",() => {
    const stem:Pixel[]=[[4,1],[5,1],[6,2],...Array.from({length:25},(_,i):Pixel => [6+Math.floor(i/4),i+3]),[12,28],[11,29],[10,29]];
    const junction=stem.find(([_,y]) => y===15)!;
    const bar=line(junction,[30,junction[1]]),sample=fixture(34,34,[stem,bar]);
    const paths=sample.trace();
    const expected=new Set(stem.map(([x,y]) => `${x},${y}`));
    expect(paths.some((path) => path.points.filter((p) => expected.has(`${p.x},${p.y}`)).length===stem.length)).toBe(true);
    sample.expectExactCoverage(paths);
  });
  it("traces an X as two complete crossing strokes without turning onto the other diagonal",() => {
    const diagonals=[line([2,2],[26,26]),line([2,26],[26,2])],sample=fixture(29,29,diagonals);
    const paths=sample.trace();
    expect(paths).toHaveLength(2);
    for(const diagonal of diagonals) {
      expect(paths.some((path) => JSON.stringify(path.points.map((p) => [p.x,p.y]))===JSON.stringify(diagonal)
        || JSON.stringify(path.points.map((p) => [p.x,p.y]))===JSON.stringify([...diagonal].reverse()))).toBe(true);
    }
    sample.expectExactCoverage(paths);
  });
  it("reconstructs a thick crossing represented by two nearby T junctions without retracing their shared corridor",() => {
    const lower=line([8,2],[8,12]),upper=line([12,12],[12,26]);
    const sample=fixture(32,32,[lower,line([2,12],[28,12]),upper],(x,y) => ({x,y,width:12}));
    const paths=sample.trace();
    expect(paths).toHaveLength(2);
    const outerStem=new Set([...lower.slice(0,-1),...upper.slice(1)].map(([x,y]) => `${x},${y}`));
    expect(paths.some((path) => path.points.filter(({x,y}) => outerStem.has(`${x},${y}`)).length===outerStem.size)).toBe(true);
    expect(paths.some((path) => path.points.every(({y}) => y===12))).toBe(true);
    const edges=paths.flatMap((path) => path.points.slice(1).map((point,i) => [`${point.x},${point.y}`,`${path.points[i].x},${path.points[i].y}`].sort().join("|")));
    expect(new Set(edges).size).toBe(edges.length);
    const shared=paths[0].points.filter((p) => paths[1].points.some((q) => q.x===p.x && q.y===p.y));
    expect(shared).toEqual([{x:10,y:12,width:12}]);
  });
  it("preserves every counter edge even when nearby junctions lie inside wide local width disks",() => {
    const sample=fixture(17,17,[line([4,4],[12,4]),line([12,4],[12,12]),line([12,12],[4,12]),line([4,12],[4,4]),
      line([0,8],[4,8]),line([8,0],[8,4])],(x,y) => ({x,y,width:12}));
    sample.expectExactCoverage(sample.trace());
  });
  it("keeps the actual Dancing Script F stem and its crossing bar each in one continuous stroke",async () => {
    const bytes=await readFile(resolve("tests/fixtures/fonts/DancingScript.ttf"));
    const font=parse(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const paths=centerlineFromOutline(font.charToGlyph("F").path.commands,font.unitsPerEm);
    expect(paths).toHaveLength(3);
    const stem=paths.find((path) => Math.min(...path.points.map((p) => p.y))<-50 && Math.max(...path.points.map((p) => p.y))>650);
    expect(stem).toBeDefined();
    const bar=paths.find((path) => Math.min(...path.points.map((p) => p.x))<100 && Math.max(...path.points.map((p) => p.x))>400
      && Math.max(...path.points.map((p) => p.y))-Math.min(...path.points.map((p) => p.y))<100);
    expect(bar).toBeDefined();
    expect(stem).not.toBe(bar);
    expect(stem!.points.some((point) => bar!.points.some((other) => Math.hypot(point.x-other.x,point.y-other.y)<1e-6))).toBe(true);
  });
});

describe("repairing previously split centreline strokes",() => {
  const p=(x:number,y:number,width=2):CenterlinePoint => ({x,y,width});
  it("reconstructs the complete F stem and splits a simplified segment only at the existing bar endpoint",() => {
    const source:CenterlineStroke[]=[{points:[p(8,2),p(8,13),p(25,13)]},{points:[p(8,13),p(8,26)]},{points:[p(8,6),p(28,6)]}];
    const before=JSON.stringify(source),paths=reconnectCenterlineStrokes(source,0.01);
    expect(JSON.stringify(source)).toBe(before);
    expect(paths).toHaveLength(3);
    expect(paths.some((path) => JSON.stringify(path.points.map(({x,y}) => [x,y]))===JSON.stringify([[8,2],[8,6],[8,13],[8,26]]))).toBe(true);
    expect(lengths(paths)).toEqual([24,20,17]);
    const edges=paths.flatMap((path) => path.points.slice(1).map((point,i) => [`${point.x},${point.y}`,`${path.points[i].x},${path.points[i].y}`].sort().join("|")));
    expect(edges.sort()).toEqual(["8,2|8,6","8,13|8,6","8,13|8,26","25,13|8,13","28,6|8,6"].sort());
  });
  it("keeps the two diagonals crossing through an existing shared internal point",() => {
    const paths=reconnectCenterlineStrokes([{points:[p(0,0),p(10,10),p(20,20)]},{points:[p(0,20),p(10,10),p(20,0)]}],0.01);
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.points.length===3)).toBe(true);
    expect(paths.some((path) => path.points.every((point) => point.x===point.y))).toBe(true);
    expect(paths.some((path) => path.points.every((point) => point.x+point.y===20))).toBe(true);
  });
  it("keeps nearby disconnected strokes separate instead of bridging to the nearest segment",() => {
    const source=[{points:[p(0,0),p(20,0)]},{points:[p(10,0.2),p(10,10)]}];
    const paths=reconnectCenterlineStrokes(source,0.01);
    expect(paths).toHaveLength(2);
    expect(lengths(paths).reduce((sum,value) => sum+value,0)).toBeCloseTo(29.8);
    expect(paths.flatMap((path) => path.points)).toEqual(expect.arrayContaining(source.flatMap((path) => path.points)));
  });
  it("keeps the maximum physical width at a shared junction without changing other samples",() => {
    const paths=reconnectCenterlineStrokes([{points:[p(0,0,1),p(0,10,2),p(0,20,1)]},{points:[p(0,10,4),p(10,10,3)]}],0.01);
    expect(paths.flatMap((path) => path.points).filter((point) => point.x===0 && point.y===10).every((point) => point.width===4)).toBe(true);
    expect(paths.flatMap((path) => path.points)).toEqual(expect.arrayContaining([p(0,0,1),p(0,20,1),p(10,10,3)]));
  });
  it("repairs a legacy split thick F crossing while retaining its outside stem and bar endpoints",() => {
    const source=[{points:[p(8,2,12),p(8,12,12)]},{points:[p(12,12,12),p(12,26,12)]},
      {points:[p(2,12,12),p(8,12,12),p(12,12,12),p(28,12,12)]}];
    const paths=reconnectCenterlineStrokes(source,0.01);
    expect(paths).toHaveLength(2);
    expect(paths.some((path) => path.points.some(({x,y}) => x===8 && y===2) && path.points.some(({x,y}) => x===12 && y===26))).toBe(true);
    expect(paths.some((path) => path.points.some(({x,y}) => x===2 && y===12) && path.points.some(({x,y}) => x===28 && y===12))).toBe(true);
  });
  it("repairs the user's actual saved Dancing Script F into one stem and one crossing bar",async () => {
    const font=JSON.parse(await readFile(resolve("tests/fixtures/fonts/DancingScript-legacy-strokes.json"),"utf8")) as {unitsPerEm:number;glyphs:Record<string,{paths:CenterlineStroke[]}>};
    const original=font.glyphs.F.paths,before=JSON.stringify(original);
    expect(original).toHaveLength(4);
    const paths=reconnectCenterlineStrokes(original,font.unitsPerEm/192*0.05);
    expect(JSON.stringify(original)).toBe(before);
    expect(paths).toHaveLength(3);
    const stem=paths.find((path) => Math.min(...path.points.map((p) => p.y))<0 && Math.max(...path.points.map((p) => p.y))>650);
    const bar=paths.find((path) => Math.min(...path.points.map((p) => p.x))<100 && Math.max(...path.points.map((p) => p.x))>400
      && Math.max(...path.points.map((p) => p.y))-Math.min(...path.points.map((p) => p.y))<100);
    expect(stem).toBeDefined();expect(bar).toBeDefined();expect(stem).not.toBe(bar);
    expect(stem!.points.some((point) => bar!.points.some((other) => Math.hypot(point.x-other.x,point.y-other.y)<1e-6))).toBe(true);
  });
  it("rejects invalid or excessive legacy geometry with an actionable error",() => {
    expect(() => reconnectCenterlineStrokes([{points:[p(0,0),p(1,1)]}],0)).toThrow(/positive numerical tolerance/);
    expect(() => reconnectCenterlineStrokes([{points:[p(0,0),p(NaN,1)]}],0.01)).toThrow(/invalid centreline/);
    expect(() => reconnectCenterlineStrokes([{points:Array(600_001).fill(p(0,0))}],0.01)).toThrow(/geometry limit.*Reimport/i);
  });
});
