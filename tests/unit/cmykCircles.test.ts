import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PluginContext, PluginInput, PluginParameters, PluginResult, PluginOutputItem } from "../../src/types";
import { parsePluginSource, validatePluginParameters, validatePluginResult, validatePluginRunRequest } from "../../src/types/pluginValidation";
import { preparePluginArtwork } from "../../src/renderer/src/features/plugins/pluginProcessing";
import { vectorObjectsForImports } from "../../src/renderer/src/store/canvasStore/services/vectorObjects";
import { suggestedPluginPen } from "../../src/renderer/src/features/plugins/pluginPens";
import { useCanvasStore } from "../../src/renderer/src/store/canvasStore";
import { parseCanvasLayout } from "../../src/types/layoutValidation";

const source = readFileSync(resolve("docs/examples/cmyk-circles.tf-plugin.js"), "utf8");
const manifest = parsePluginSource(source);
const run = new Function(source.replace(/export default function run/, "return function run"))() as
  (input: PluginInput, p: PluginParameters, context: PluginContext) => PluginResult;
const palette = [
  { id: "real-c", name: "Cyan", color: "#00ffff", importIds: [] as string[] },
  { id: "real-m", name: "Magenta", color: "#ff00ff", importIds: [] as string[] },
  { id: "real-y", name: "Yellow", color: "#ffff00", importIds: [] as string[] },
  { id: "real-k", name: "Black", color: "#000000", importIds: [] as string[] },
];
const defaults = validatePluginParameters(manifest, { cyanPen: "real-c", magentaPen: "real-m", yellowPen: "real-y", blackPen: "real-k" });
type Pixel = [number, number, number, number];
type Vector = Extract<PluginOutputItem, { kind: "vector" }>;
function bitmap(width = 80, height = 56, pixel: (x: number, y: number) => Pixel = () => [40, 120, 200, 255]): Extract<PluginInput, { kind: "bitmap" }> {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), (y * width + x) * 4);
  return { kind: "bitmap", sourceId: "source", page: { widthMM: 420, heightMM: 297 }, palette: palette.map(({id,name,color})=>({id,name,color})), width, height, widthPx: width, heightPx: height, data,
    placement: { x: 21, y: 24, scale: 0.3, scaleX: 0.8, scaleY: 0.5, rotation: 31 } };
}
function generate(input = bitmap(), changes: PluginParameters = {}, ctx?: PluginContext) {
  const parameters = validatePluginParameters(manifest, { ...defaults, ...changes });
  const context = ctx ?? { runId: "cmyk-test", signal: new AbortController().signal, progress: vi.fn(), seed: 99 };
  const request = validatePluginRunRequest({ runId: context.runId, pluginId: manifest.id, input, parameters });
  const result = validatePluginResult(run(request.input, parameters, context), request, manifest);
  if (!("items" in result)) throw Error("Expected four structured layers");
  return { result, items: result.items as Vector[], parameters, context };
}
const count = (item: Vector) => item.paths.reduce((sum, path) => sum + path.points.length, 0);
function segments(item: Vector) { return item.paths.flatMap(path => path.points.slice(1).map((b, i) => [path.points[i], b] as const)); }
const length = (item: Vector) => segments(item).reduce((sum, [a, b]) => sum + Math.hypot(a.x - b.x, a.y - b.y), 0);

describe("CMYK Circles distributable", () => {
  it("declares bitmap-to-vector output, source-pixel units and no plotter speed controls", () => {
    expect(manifest).toMatchObject({ category: "bitmap-processor", input: "bitmap", outputs: ["vector"] });
    expect(defaults).toMatchObject({ diameter: 8, gap: 1, fillSpacing: 1, cyanAngle: 15, magentaAngle: 75, yellowAngle: 0, blackAngle: 45, border: false });
    expect(manifest.controls!.length).toBeLessThanOrEqual(32);
    expect(manifest.controls!.some(c => /speed|feed|velocity/i.test(c.key))).toBe(false);
  });
  it.each([
    ["white", [255, 255, 255, 255], []], ["black", [0, 0, 0, 255], [3]],
    ["cyan", [0, 255, 255, 255], [0]], ["magenta", [255, 0, 255, 255], [1]], ["yellow", [255, 255, 0, 255], [2]],
    ["red", [255, 0, 0, 255], [1, 2]], ["green", [0, 255, 0, 255], [0, 2]], ["blue", [0, 0, 255, 255], [0, 1]],
  ])("separates %s into the subtractive ink channels", (_name, rgb, expected) => {
    const { items } = generate(bitmap(64, 48, () => rgb as Pixel));
    expect(items.map((item, i) => item.paths.length ? i : -1).filter(i => i >= 0)).toEqual(expected);
    expect(items.map(item => item.plotOrder)).toEqual([0, 1, 2, 3]);
    expect(items.map(item => item.penId)).toEqual(palette.map(pen => pen.id));
  });
  it("creates intersecting red M/Y circle geometry instead of choosing one pen", () => {
    const { items } = generate(bitmap(64, 48, () => [255, 0, 0, 255]), { style: "outline" });
    const edges = [segments(items[1]), segments(items[2])];
    const cross = (a: {x:number;y:number}, b: {x:number;y:number}, c: {x:number;y:number}) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
    expect(edges[0].some(([a,b]) => edges[1].some(([c,d]) => cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0))).toBe(true);
  });
  it("suggests only a unique exact configured colour and retains missing saved IDs", () => {
    const control = manifest.controls![0];
    expect(suggestedPluginPen(control, "", palette)).toBe("real-c");
    expect(suggestedPluginPen(control, "deleted", palette)).toBe("deleted");
    expect(suggestedPluginPen(control, "", [palette[3]])).toBe("");
    expect(suggestedPluginPen(control, "", [...palette, { ...palette[0], id: "duplicate" }])).toBe("");
    expect(() => generate({ ...bitmap(), palette: [] })).toThrow(/four distinct real pens/i);
    expect(() => generate(bitmap(), { cyanPen: "invented" })).toThrow(/available real pens/i);
    expect(() => generate(bitmap(), { cyanPen: "real-k" })).toThrow(/four distinct pen IDs/i);
  });
  it("applies black generation and undercolour removal to neutrals", () => {
    const input = bitmap(64, 48, () => [128, 128, 128, 255]);
    expect(generate(input).items.map(item => !!item.paths.length)).toEqual([false, false, false, true]);
    expect(generate(input, { blackGeneration: 0 }).items.map(item => !!item.paths.length)).toEqual([true, true, true, false]);
    expect(generate(input, { blackGeneration: 50 }).items.every(item => item.paths.length)).toBe(true);
  });
  it("tones increase circle area or equal-size circle population deterministically", () => {
    const solid = (v: number) => bitmap(100, 72, () => [v, v, v, 255]);
    const settings = { blackAngle: 0, samples: 1, style: "outline" };
    const dark = generate(solid(0), settings).items[3], grey = generate(solid(190), settings).items[3];
    expect(length(dark)).toBeGreaterThan(length(grey) * 1.6);
    const uniformDark = generate(solid(0), { ...settings, toneMode: "number" }).items[3];
    const uniformGrey = generate(solid(190), { ...settings, toneMode: "number" }).items[3];
    expect(uniformDark.paths.length).toBeGreaterThan(uniformGrey.paths.length * 2);
    expect(generate(solid(190), { ...settings, toneMode: "number" }).items[3]).toEqual(uniformGrey);
    const gradient = generate(bitmap(96, 56, x => [x*255/95, x*255/95, x*255/95, 255]), settings).items[3];
    const halves = [0, 0];
    for (const [a,b] of segments(gradient)) halves[(a.x+b.x)/2 < 48 ? 0 : 1] += Math.hypot(a.x-b.x,a.y-b.y);
    expect(halves[0]).toBeGreaterThan(halves[1]);
  });
  it("fills with additional concentric toolpaths and makes fill spacing meaningful", () => {
    const input = bitmap(64, 48, () => [0,0,0,255]);
    const outline = generate(input, { style: "outline" }).items[3];
    const filled = generate(input).items[3];
    expect(filled.paths.length).toBeGreaterThan(outline.paths.length * 2);
    expect(length(filled)).toBeGreaterThan(length(outline));
    expect(count(generate(input, { fillSpacing: 0.5 }).items[3])).toBeGreaterThan(count(filled));
    expect(filled.paths.every(path => path.points.length >= 2)).toBe(true);
  });
  it("rotates the grid and offsets only the chosen layer, with staggered rows", () => {
    const input = bitmap(96, 64, () => [0,0,255,255]);
    const base = generate(input, { style: "outline", cyanAngle: 0, samples: 1 });
    expect(generate(input, { style: "outline", cyanAngle: 0, samples: 1, cyanX: 2 }).items[0]).not.toEqual(base.items[0]);
    expect(generate(input, { style: "outline", cyanAngle: 0, samples: 1, cyanX: 2 }).items[1]).toEqual(base.items[1]);
    expect(generate(input, { style: "outline", cyanAngle: 30, samples: 1 }).items[0]).not.toEqual(base.items[0]);
    const centres = base.items[0].paths.filter(path => path.points.length===13 && Math.abs(path.points[0].x-path.points[12].x)<1e-7)
      .map(path => ({ x: path.points[0].x-4, y: path.points[0].y }));
    expect(centres.some(a => centres.some(b => Math.abs(Math.abs(a.y-b.y)-9*Math.sqrt(3)/2)<1e-6 && Math.abs(Math.abs(a.x-b.x)-4.5)<1e-6))).toBe(true);
  });
  it("composites partial alpha over white, excludes transparency and every white slit", () => {
    const partial = generate(bitmap(64, 48, () => [0,0,0,128]));
    expect(partial.items).toEqual(generate(bitmap(64, 48, () => [127,127,127,255])).items);
    expect(generate(bitmap(64, 48, () => [255,0,255,0])).items.every(item => !item.paths.length)).toBe(true);
    for (const slit of [[0,0,0,0], [255,255,255,255]] as Pixel[]) {
      const { items } = generate(bitmap(96, 41, x => x===47 ? slit : [0,0,0,255]), { diameter: 18 });
      for (const [a,b] of segments(items[3])) expect(Math.min(a.x,b.x)<47.1 && Math.max(a.x,b.x)>47.9).toBe(false);
      for (const item of items) for (const path of item.paths) for (const point of path.points) {
        expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(96);
        expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(41);
      }
    }
  });
  it("draws a real inset border band only with K and keeps transparent edges empty", () => {
    const input = bitmap(64, 40, () => [255,255,255,255]);
    const { items } = generate(input, { border: true, borderWidth: 3, fillSpacing: 1 });
    expect(items.slice(0,3).every(item => !item.paths.length)).toBe(true);
    expect(items[3].paths).toHaveLength(4);
    expect(items[3].paths.map(path => path.points[0])).toEqual([0,1,2,3].map(v => ({x:v,y:v})));
    expect(generate(bitmap(64,40,()=>[0,0,0,0]), { border:true }).items[3].paths).toHaveLength(0);
    expect(() => generate(input, { border:true, borderWidth:20 })).toThrow(/less than half/i);
  });
  it("retains the full frame and never mutates source bytes, palette or placement", () => {
    const input = bitmap(97, 41, (x,y) => x>20 && x<70 && y>10 && y<30 ? [0,0,0,255] : [0,0,0,0]);
    const before = JSON.stringify({...input,data:Array.from(input.data)}), output = generate(input);
    expect(JSON.stringify({...input,data:Array.from(input.data)})).toEqual(before);
    expect(output.items.every(item => item.width===97 && item.height===41)).toBe(true);
    expect(generate({ ...input, placement:{x:-50,y:13,scale:1,scaleX:3,scaleY:0.2,rotation:120} }).items).toEqual(output.items);
  });
  it("rejects excessive work, honours cancellation and reports completion", () => {
    expect(() => generate(bitmap(1000,1000), { diameter:0.5, gap:0 })).toThrow(/detail budget/i);
    const controller = new AbortController(); controller.abort();
    expect(() => generate(bitmap(), {}, {runId:"abort", signal:controller.signal, progress:vi.fn(), seed:1})).toThrow(/cancelled/i);
    const { context } = generate(); expect(context.progress).toHaveBeenCalledWith(0); expect(context.progress).toHaveBeenLastCalledWith(100);
  });
  it("preserves four layers, real pens, transforms and settings through atomic history and layout validation", async () => {
    const input = bitmap(); const { result, parameters } = generate(input, { border:true });
    const original = { id:"source", name:"source",kind:"vector" as const, paths:[],svgWidth:80,svgHeight:56,viewBoxX:0,viewBoxY:0,visible:true,opacity:1,...input.placement };
    const prepared = await preparePluginArtwork(result,manifest,parameters,input.page,undefined,original,99,{palette});
    expect(prepared.items).toHaveLength(4);
    expect(prepared.items.map(item=>item.pluginSource!.plotOrder)).toEqual([0,1,2,3]);
    expect(prepared.items.every(item=>item.x===21 && item.scaleX===0.8 && item.scaleY===0.5 && item.rotation===31)).toBe(true);
    useCanvasStore.setState({ imports:[original],assets:{},layerGroups:structuredClone(palette),activePenId:"real-y",undoStack:[],redoStack:[] });
    useCanvasStore.getState().commitPluginResult(prepared);
    const applied = structuredClone(useCanvasStore.getState().imports);
    expect(applied).toHaveLength(5); expect(applied[0]).toEqual(original);
    expect(useCanvasStore.getState().layerGroups.map(pen=>pen.id)).toEqual(palette.map(pen=>pen.id));
    const objects = vectorObjectsForImports(applied,useCanvasStore.getState().layerGroups);
    expect(objects.every(object=>object.penId && object.plotOrder!==undefined)).toBe(true);
    useCanvasStore.getState().undo(); expect(useCanvasStore.getState().imports).toEqual([original]);
    useCanvasStore.getState().redo(); expect(useCanvasStore.getState().imports).toEqual(applied);
    // Validate vector-only portable result; the actual bitmap asset is exercised by Electron tests.
    const saved=parseCanvasLayout(JSON.stringify({tfVersion:2,savedAt:new Date().toISOString(),imports:applied.slice(1),layerGroups:useCanvasStore.getState().layerGroups,activePenId:"real-y"}));
    expect(saved.imports.map(item=>item.pluginSource)).toEqual(applied.slice(1).map(item=>item.pluginSource));
  });
  it("validates ordered output metadata and retains empty channels through preparation",async()=>{
    const input=bitmap(32,24,()=>[255,255,255,255]);const {result,parameters}=generate(input);
    const request=validatePluginRunRequest({runId:"metadata",pluginId:manifest.id,input,parameters});
    const items=(result as {items:Vector[]}).items;
    const validate=(item:unknown)=>validatePluginResult({items:[item]},request,manifest);
    expect(()=>validate({...items[0],plotOrder:-1})).toThrow();
    expect(()=>validate({...items[0],plotOrder:16})).toThrow();
    expect(()=>validate({...items[0],plotOrder:0.5})).toThrow();
    expect(()=>validate({...items[0],penId:"missing"})).toThrow(/palette/i);
    expect(()=>validate({...items[0],penId:undefined})).toThrow(/paths/i);
    expect(()=>validate({...items[0],paths:[{points:[{x:1,y:1},{x:2,y:2}],penId:"real-k"}]})).toThrow(/declared output pen/i);
    const original={id:"source",name:"source",kind:"vector" as const,paths:[],svgWidth:32,svgHeight:24,viewBoxX:0,viewBoxY:0,visible:true,...input.placement};
    const prepared=await preparePluginArtwork(result,manifest,parameters,input.page,undefined,original,1,{palette});
    expect(prepared.items).toHaveLength(4);expect(Object.values(prepared.penAssignments)).toEqual(palette.map(p=>p.id));
    expect(prepared.items.every(item=>item.kind!=="bitmap"&&item.paths.length===0)).toBe(true);
  });

  it("cancels during generation and enforces its internal time deadline",()=>{
    const controller=new AbortController();const progress=vi.fn((value:number|null)=>{if(value!==null&&value>=24)controller.abort();});
    expect(()=>generate(bitmap(),{},{runId:"mid-cancel",signal:controller.signal,progress,seed:1})).toThrow(/cancelled/i);
    const now=vi.spyOn(Date,"now").mockReturnValueOnce(0).mockReturnValue(26001);
    try {expect(()=>generate()).toThrow(/time budget/i);} finally {now.mockRestore();}
  });

  it("fits a 620x800 image as complete layers and reports the actual circle settings",()=>{
    const input=bitmap(620,800,(x,y)=>[Math.round(x*255/619),Math.round(y*255/799),180,255]);
    input.placement.scaleX=92.579/620;input.placement.scaleY=119.457/800;
    expect(()=>generate(input)).toThrow(/100,000 points detail budget.*620 x 800 px.*Fit complete image/i);
    const fitted=generate(input,{fitToBudget:true,border:true,cyanX:2,magentaY:-1});
    expect(fitted.items.map(item=>item.plotOrder)).toEqual([0,1,2,3]);
    expect(fitted.items.every(item=>item.width===620&&item.height===800&&item.paths.length>0)).toBe(true);
    expect(fitted.items.reduce((n,item)=>n+count(item),0)).toBeLessThanOrEqual(100000);
    expect(fitted.items.reduce((n,item)=>n+item.paths.length,0)).toBeLessThanOrEqual(10000);
    expect(fitted.result.warnings![0]).toMatch(/4x circle settings: diameter 32, gap 4, fill spacing 4, chord error 0.8/);
    expect(fitted.items).toEqual(generate(input,{diameter:32,gap:4,fillSpacing:4,tolerance:0.8,border:true,cyanX:2,magentaY:-1}).items);
    expect(generate(input,{fitToBudget:true,border:true,cyanX:2,magentaY:-1}).items).toEqual(fitted.items);
    const progress=(fitted.context.progress as ReturnType<typeof vi.fn>).mock.calls.map(call=>call[0] as number);
    expect(progress[0]).toBe(0);expect(progress.at(-1)).toBe(100);expect(progress).toEqual([...progress].sort((a,b)=>a-b));
  });
  it("keeps requested geometry when it fits and never fits invalid pens or cancellation",()=>{
    const input=bitmap();const exact=generate(input),fitted=generate(input,{fitToBudget:true});
    expect(fitted.items).toEqual(exact.items);expect(fitted.result.warnings).toEqual(exact.result.warnings);
    expect(()=>generate(input,{fitToBudget:true,cyanPen:"real-k"})).toThrow(/four distinct pen IDs/i);
    const controller=new AbortController();controller.abort();
    expect(()=>generate(input,{fitToBudget:true},{runId:"fit-abort",signal:controller.signal,progress:vi.fn(),seed:1})).toThrow(/cancelled/i);
  });

});
