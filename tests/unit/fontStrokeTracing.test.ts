import { describe,expect,it } from "vitest";
import type { CenterlinePoint,CenterlineStroke } from "../../src/types/fonts";
import { traceSkeleton } from "../../src/fonts/skeleton";

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

describe("longest-first skeleton stroke tracing",() => {
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
  it("measures the longest stroke in physical coordinates rather than pixel count",() => {
    const sample = fixture(25,25,[line([10,1],[10,21]),line([10,11],[12,11])],(x,y) => ({x:x*10,y,width:2}));
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([30,10]);sample.expectExactCoverage(paths);
  });
  it("keeps a dominant stroke through an even-degree junction and covers residual branches once",() => {
    const sample = fixture(25,25,[line([10,1],[10,21]),line([8,11],[12,11])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([20,4]);sample.expectExactCoverage(paths);
  });
  it("splices a complete counter loop and its tail into one continuous trail",() => {
    const sample = fixture(12,12,[line([2,2],[8,2]),line([8,2],[8,8]),line([8,8],[2,8]),line([2,8],[2,2]),line([0,5],[2,5])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([26]);sample.expectExactCoverage(paths);
  });
  it("keeps a pure closed loop intact without connecting across its counter",() => {
    const sample = fixture(12,12,[line([2,2],[8,2]),line([8,2],[8,8]),line([8,8],[2,8]),line([2,8],[2,2])]);
    const paths = sample.trace();
    expect(lengths(paths)).toEqual([24]);expect(paths[0].points[0]).toEqual(paths[0].points.at(-1));
    sample.expectExactCoverage(paths);
  });
  it("prioritizes a long loop-and-stem trail while retaining the minimum cyclic trail count",() => {
    const sample = fixture(21,21,[line([4,4],[12,4]),line([12,4],[12,12]),line([12,12],[4,12]),line([4,12],[4,4]),
      line([8,1],[8,4]),line([8,12],[8,17]),line([1,8],[4,8]),line([12,8],[18,8])]);
    const paths = sample.trace();
    expect(paths).toHaveLength(4); // Four odd junctions and four odd endpoints.
    expect(lengths(paths)[0]).toBe(38); // All 32 loop edges plus the six-edge arm.
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
});
