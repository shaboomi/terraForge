import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
import type { CenterlinePoint,CenterlineStroke,FontOutlineCommand,ProcessedFont } from "../../src/types/fonts";
import { evaluateCubic,fitCenterline } from "../../src/fonts/curveFit";
import { convertOutlineFont,processFont,smoothProcessedFont } from "../../src/fonts/processor";

const arc=(radius:number,start:number,end:number,closed=false):CenterlinePoint[]=> {
  const result:CenterlinePoint[]=[];
  const count=Math.ceil(Math.abs(end-start)*radius*2);
  for(let i=0;i<=count;i++) {
    const angle=start+(end-start)*i/count,p={x:Math.round(radius*Math.cos(angle)),y:Math.round(radius*Math.sin(angle)),width:1+2*i/count};
    if(!result.length||p.x!==result.at(-1)!.x||p.y!==result.at(-1)!.y)result.push(p);
  }
  if(closed)result[result.length-1]={...result[0]};
  return result;
};
function denseGeometry(commands:FontOutlineCommand[]):{x:number;y:number}[] {
  const points:{x:number;y:number}[]=[];let current={x:0,y:0};
  for(const command of commands) {
    if(command.type==="M")current={x:command.x,y:command.y};
    else if(command.type==="L") {
      for(let i=1;i<=1000;i++)points.push({x:current.x+(command.x-current.x)*i/1000,y:current.y+(command.y-current.y)*i/1000});
      current={x:command.x,y:command.y};
    }else if(command.type==="C") {
      for(let i=0;i<=1000;i++)points.push(evaluateCubic(current,{x:command.x1,y:command.y1},{x:command.x2,y:command.y2},command,i/1000));
      current={x:command.x,y:command.y};
    }
  }
  return points;
}

describe("smooth fitted centreline geometry",()=> {
  it("fits a genuinely straight stem as one L and retains interpolated width data",()=> {
    const points=Array.from({length:41},(_,i)=>({x:5,y:i,width:1+i/20}));
    const result=fitCenterline(points,{pixelSize:1});
    expect(result.commands).toEqual([{type:"M",x:5,y:0},{type:"L",x:5,y:40}]);
    expect(result.points[0]).toEqual(points[0]);expect(result.points.at(-1)).toEqual(points.at(-1));
    for(const p of result.points)expect(p.width).toBeCloseTo(1+p.y/20,5);
  });
  it("turns a jagged raster arc into a few true cubics with bounded spatial error",()=> {
    const points=arc(30,0,Math.PI/2),copy=structuredClone(points),result=fitCenterline(points,{pixelSize:1});
    expect(result.commands?.some(command=>command.type==="C")).toBe(true);
    expect(result.commands!.length).toBeLessThan(points.length/3);
    expect(points).toEqual(copy);
    const curve=denseGeometry(result.commands!);
    expect(Math.max(...curve.map(p=>Math.abs(Math.hypot(p.x,p.y)-30)))).toBeLessThan(1.2);
    for(const point of result.points) {
      expect(Math.min(...curve.map(p=>Math.hypot(p.x-point.x,p.y-point.y)))).toBeLessThan(0.05);
      expect(point.width).toBeGreaterThanOrEqual(1);expect(point.width).toBeLessThanOrEqual(3);
    }
  });
  it("keeps meaningful corners and protected junctions at their original coordinates",()=> {
    const corner=[...Array.from({length:31},(_,i)=>({x:i,y:0,width:2})),...Array.from({length:30},(_,i)=>({x:30,y:i+1,width:2}))];
    const result=fitCenterline(corner,{pixelSize:1});
    expect(result.commands).toContainEqual({type:"L",x:30,y:0});
    expect(result.commands!.at(-1)).toEqual({type:"L",x:30,y:30});
    const points=arc(30,0,Math.PI/2),anchor=Math.floor(points.length/2),joined=fitCenterline(points,{pixelSize:1,anchors:[anchor]});
    const preserved=joined.points.find(p=>p.x===points[anchor].x&&p.y===points[anchor].y)!;
    expect(preserved).toBeDefined();expect(preserved.width).toBeCloseTo(points[anchor].width,5);
    expect(joined.commands!.some(command=>command.type!=="Z"&&command.x===points[anchor].x&&command.y===points[anchor].y)).toBe(true);
  });
  it("closes a smooth counter with matching cubic derivatives at the seam",()=> {
    const result=fitCenterline(arc(20,0,2*Math.PI,true),{pixelSize:1});
    expect(result.commands!.at(-1)).toEqual({type:"Z"});
    expect(result.points[0]).toEqual(result.points.at(-1));
    const start=result.commands![0],first=result.commands![1],last=result.commands!.at(-2)!;
    expect(start.type).toBe("M");expect(first.type).toBe("C");expect(last.type).toBe("C");
    if(start.type!=="M"||first.type!=="C"||last.type!=="C")throw new Error("Expected a cubic closed seam");
    expect(first.x1-start.x).toBeCloseTo(last.x-last.x2,5);
    expect(first.y1-start.y).toBeCloseTo(last.y-last.y2,5);
  });
  it("checks the entire fitted curve against the filled-glyph constraint",()=> {
    const result=fitCenterline(arc(30,0,Math.PI/2),{pixelSize:1,contains:(x,y)=>Math.hypot(x,y)>=29&&Math.hypot(x,y)<=31});
    const dense=denseGeometry(result.commands!);
    expect(dense.every(p=>Math.hypot(p.x,p.y)>28.99&&Math.hypot(p.x,p.y)<31.01)).toBe(true);
    expect(result.commands?.some(command=>command.type==="C")).toBe(true);
  });
  it("relaxes a small medial junction bulge while protecting its shared anchor and ink disk",()=> {
    const points=Array.from({length:41},(_,i)=>({x:i>=16&&i<=18?2:i>=22&&i<=24?-2:0,y:i,width:20}));
    const fitted=fitCenterline(points,{pixelSize:1,anchors:[20],contains:(x)=>Math.abs(x)<=3});
    expect(fitted.points).toContainEqual(points[20]);
    expect(Math.max(...fitted.points.map(p=>Math.abs(p.x)))).toBeLessThan(1.5);
    expect(denseGeometry(fitted.commands!).every(p=>Math.abs(p.x)<=3)).toBe(true);
  });
});

describe("font curve processing integration",()=> {
  it("fits genuine curves for Dancing Script letters F, a, c and s",async()=> {
    const bytes=await readFile(resolve("tests/fixtures/fonts/DancingScript.ttf"));
    const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const outline=processFont(buffer,{id:"dancing-outline",sourceName:"DancingScript.ttf",mode:"outline",characters:"Facs"});
    const selected:ProcessedFont={...outline,glyphs:Object.fromEntries([..."Facs"].map(character=>[character,outline.glyphs[character]]))};
    const font=convertOutlineFont(selected,{id:"dancing-curves"});
    expect(font.processingVersion).toBe(2);
    for(const character of "Facs") {
      expect(font.glyphs[character].paths.length).toBeGreaterThan(0);
      const commands=font.glyphs[character].paths.flatMap(path=>path.commands??[]);
      expect(commands.some(command=>command.type==="C")).toBe(true);
      expect(commands.length).toBeLessThan(font.glyphs[character].paths.reduce((sum,path)=>sum+path.points.length,0)/2);
      for(const path of font.glyphs[character].paths) {
        expect(path.points.every(p=>Number.isFinite(p.x+p.y+p.width)&&p.width>0)).toBe(true);
      }
    }
    expect(font.sourceFontId).toBe(outline.id);
  },30_000);
  it("upgrades existing stored raster polylines without modifying the original library entry",()=> {
    const stroke:CenterlineStroke={points:arc(30,0,Math.PI/2)};
    const legacy:ProcessedFont={version:1,id:"legacy",name:"Existing",sourceName:"existing.ttf",createdAt:"2026-10-30T00:00:00Z",unitsPerEm:192,ascender:150,descender:-42,lineGap:0,glyphs:{c:{advanceWidth:40,paths:[stroke]}},kerning:{},warnings:[]};
    const original=structuredClone(legacy),upgraded=smoothProcessedFont(legacy);
    expect(legacy).toEqual(original);expect(upgraded.id).toBe(legacy.id);expect(upgraded.processingVersion).toBe(2);expect(upgraded.mode).toBe("centerline");
    expect(upgraded.glyphs.c.paths[0].commands?.some(command=>command.type==="C")).toBe(true);
    expect(smoothProcessedFont(upgraded)).toEqual(upgraded);
  });
  it("upgrades the exact stored Dancing Script F into full stem and bar curves without a source file",async()=> {
    const legacy=JSON.parse(await readFile(resolve("tests/fixtures/fonts/DancingScript-legacy-strokes.json"),"utf8")) as ProcessedFont;
    const original=structuredClone(legacy),font=smoothProcessedFont(legacy),strokes=font.glyphs.F.paths;
    expect(legacy).toEqual(original);expect(font.id).toBe(legacy.id);expect(font.sourceFontId).toBeUndefined();
    expect(strokes).toHaveLength(3);
    expect(strokes.some(path=>Math.min(...path.points.map(p=>p.y))<0&&Math.max(...path.points.map(p=>p.y))>650)).toBe(true);
    expect(strokes.some(path=>Math.min(...path.points.map(p=>p.x))<100&&Math.max(...path.points.map(p=>p.x))>400&&path.points.every(p=>p.y>250&&p.y<400))).toBe(true);
    for(const character of "Facs")expect(font.glyphs[character].paths.some(path=>path.commands?.some(command=>command.type==="C"))).toBe(true);
  });
  it("does not mark an empty legacy font as successfully smoothed",()=> {
    const empty:ProcessedFont={version:1,id:"empty",name:"Empty old import",sourceName:"old.ttf",createdAt:"2026-10-30T00:00:00Z",unitsPerEm:1000,ascender:800,descender:-200,lineGap:0,glyphs:{A:{advanceWidth:600,paths:[]}," ":{advanceWidth:250,paths:[]}},kerning:{},warnings:[]};
    expect(()=>smoothProcessedFont(empty)).toThrow(/No centreline geometry.*Import the original font again/);
    expect(empty.processingVersion).toBeUndefined();
  });
});
