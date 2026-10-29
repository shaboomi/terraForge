import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Font, Glyph, Path, parse, type PathCommand } from "opentype.js";
import { centerlineFromOutline, processFont, rasterizeContours } from "../../src/fonts/processor";
import { distanceField, thinMask, traceSkeleton } from "../../src/fonts/skeleton";

const rectangle: PathCommand[] = [{type:"M",x:0,y:0},{type:"L",x:100,y:0},{type:"L",x:100,y:700},{type:"L",x:0,y:700},{type:"Z"}];
const identity = { id:"test-font",sourceName:"Test.otf",createdAt:"2026-10-29T00:00:00.000Z" };

describe("centreline extraction",() => {
  it("turns a rectangular stem into one continuous stroke with its local width",() => {
    const paths = centerlineFromOutline(rectangle,1000);
    expect(paths).toHaveLength(1);
    const points = paths[0].points;
    expect(Math.max(...points.map((p) => p.y))-Math.min(...points.map((p) => p.y))).toBeGreaterThan(580);
    expect(points.every((p) => Math.abs(p.x-50)<6)).toBe(true);
    expect(points.every((p) => p.width > 85 && p.width < 110)).toBe(true);
  });
  it("preserves a counter as a closed, continuous centreline",() => {
    const outer = [{x:0,y:0},{x:600,y:0},{x:600,y:700},{x:0,y:700}];
    const inner = [{x:100,y:100},{x:100,y:600},{x:500,y:600},{x:500,y:100}];
    const raster = rasterizeContours([outer,inner],0.192);
    const centerX = Math.floor((300-raster.minX)/raster.unit), centerY = Math.floor((350-raster.minY)/raster.unit);
    expect(raster.mask[centerY*raster.width+centerX]).toBe(0);
    const skeleton = thinMask(raster.mask,raster.width,raster.height);
    const paths = traceSkeleton(skeleton,raster.width,raster.height,(i) => ({x:i%raster.width,y:Math.floor(i/raster.width),width:1}));
    expect(paths).toHaveLength(1);
    expect(paths[0].points[0]).toEqual(paths[0].points.at(-1));
  });
  it("covers every branch without lifting at each junction",() => {
    const width = 9,height = 9, mask = new Uint8Array(width*height);
    for (let i=1;i<8;i++) { mask[4*width+i]=1; mask[i*width+4]=1; }
    const paths = traceSkeleton(mask,width,height,(i) => ({x:i%width,y:Math.floor(i/width),width:1}));
    expect(paths).toHaveLength(2); // Four odd endpoints: minimum possible is two trails.
    const drawnEdges = paths.reduce((sum,path) => sum+path.points.length-1,0);
    expect(drawnEdges).toBe(12);
  });
  it("keeps the long stem continuous after rasterizing a branched font outline",() => {
    const branch: PathCommand[] = [{type:"M",x:450,y:0},{type:"L",x:550,y:0},{type:"L",x:550,y:450},
      {type:"L",x:650,y:450},{type:"L",x:650,y:550},{type:"L",x:550,y:550},{type:"L",x:550,y:1000},{type:"L",x:450,y:1000},{type:"Z"}];
    const paths = centerlineFromOutline(branch,1000);
    expect(paths).toHaveLength(2);
    const main = paths[0].points;
    expect(Math.max(...main.map((point) => point.y))-Math.min(...main.map((point) => point.y))).toBeGreaterThan(850);
    expect(paths[1].points.every((point) => point.y > 400 && point.y < 600)).toBe(true);
  });
  it("measures Euclidean distance to the unfilled edge",() => {
    const mask = new Uint8Array(49);
    for (let y=1;y<6;y++) for (let x=1;x<6;x++) mask[y*7+x]=1;
    const field = distanceField(mask,7,7);
    expect(field[3*7+3]).toBe(9);
    expect(field[1*7+1]).toBe(1);
  });
});

describe("TTF and CFF/OTF processing",() => {
  it("parses an actual TrueType font, retains spaces and widths, and keeps the O counter",async () => {
    const bytes = await readFile(resolve("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
    const font = processFont(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),identity);
    expect(font.name).toBe("Liberation Sans");
    expect(font.mode).toBe("centerline");
    expect(font.glyphs[" "].advanceWidth).toBeGreaterThan(0);
    expect(font.glyphs[" "].paths).toEqual([]);
    expect(font.glyphs.O.paths).toHaveLength(1);
    expect(font.glyphs.O.paths[0].points[0]).toEqual(font.glyphs.O.paths[0].points.at(-1));
    expect(Object.keys(font.glyphs).length).toBeGreaterThan(200);
    expect(font.glyphs.A.paths.flatMap((path) => path.points).every((p) => p.width > 0 && Number.isFinite(p.width))).toBe(true);
    expect(font.kerning.AV).toBeLessThan(0);
  },30_000);
  it("processes serialized CFF/OTF curves and advance metrics",() => {
    const path = new Path();
    path.moveTo(0,0); path.lineTo(100,0); path.curveTo(160,200,160,500,100,700); path.lineTo(0,700); path.curveTo(60,500,60,200,0,0); path.close();
    const original = new Font({familyName:"TerraForge Test",styleName:"Regular",unitsPerEm:1000,ascender:800,descender:-200,glyphs:[
      new Glyph({name:".notdef",advanceWidth:500,path:new Path()}),new Glyph({name:"space",unicode:32,advanceWidth:250,path:new Path()}),new Glyph({name:"I",unicode:73,advanceWidth:300,path}),
    ]});
    const bytes = original.toArrayBuffer();
    expect(new DataView(bytes).getUint32(0)).toBe(0x4f54544f);
    const font = processFont(bytes,identity);
    expect(font.glyphs.I.advanceWidth).toBe(300);
    expect(font.glyphs.I.paths).toHaveLength(1);
    expect(font.glyphs.I.paths[0].points.length).toBeGreaterThan(3);
    expect(font.glyphs[" "].paths).toHaveLength(0);
  });
  it("rejects unsupported signatures before parsing",() => {
    expect(() => processFont(new ArrayBuffer(32),identity)).toThrow(/TTF or OTF/);
  });
  it("preserves TrueType quadratic outlines and counter contours without centreline conversion",async () => {
    const bytes = await readFile(resolve("node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
    const buffer = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
    const original = parse(buffer), font = processFont(buffer,{...identity,mode:"outline"});
    expect(font.mode).toBe("outline");
    expect(font.glyphs.O.paths).toEqual([]);
    expect(font.glyphs.O.outline).toEqual(original.charToGlyph("O").path.commands);
    expect(font.glyphs.O.outline?.filter((command) => command.type === "M")).toHaveLength(2);
    expect(font.glyphs.O.outline?.filter((command) => command.type === "Z")).toHaveLength(2);
    expect(font.glyphs.O.outline?.some((command) => command.type === "Q")).toBe(true);
    expect(font.glyphs[" "].outline).toEqual([]);
    expect(font.glyphs[" "].advanceWidth).toBeGreaterThan(0);
    expect(font.kerning.AV).toBeLessThan(0);
    expect(font.warnings.join(" ")).not.toMatch(/raster|192 pixels/);
    expect(font.warnings.join(" ")).toContain("shaping");
  },30_000);
  it("preserves CFF/OTF cubic curves and hole winding exactly",() => {
    const path = new Path();
    path.moveTo(0,350);path.curveTo(0,0,600,0,600,350);path.curveTo(600,700,0,700,0,350);path.close();
    path.moveTo(100,350);path.curveTo(100,600,500,600,500,350);path.curveTo(500,100,100,100,100,350);path.close();
    const original = new Font({familyName:"Outline Test",styleName:"Regular",unitsPerEm:1000,ascender:800,descender:-200,glyphs:[
      new Glyph({name:".notdef",advanceWidth:500,path:new Path()}),new Glyph({name:"O",unicode:79,advanceWidth:650,path}),
    ]});
    const buffer = original.toArrayBuffer(), parsed = parse(buffer);
    const font = processFont(buffer,{...identity,mode:"outline"});
    expect(font.glyphs.O.paths).toEqual([]);
    expect(font.glyphs.O.outline).toEqual(parsed.charToGlyph("O").path.commands);
    expect(font.glyphs.O.outline?.filter((command) => command.type === "C")).toHaveLength(4);
    expect(font.glyphs.O.outline?.filter((command) => command.type === "Z")).toHaveLength(2);
    expect(font.glyphs.O.advanceWidth).toBe(650);
  });
  it("supports non-Latin cmap entries and prioritizes requested symbols in large fonts",() => {
    const path = new Path(); path.moveTo(0,0);path.lineTo(100,0);path.lineTo(100,700);path.lineTo(0,700);path.close();
    const glyphs = [new Glyph({name:".notdef",advanceWidth:500,path:new Path()})];
    for (let index=0;index<770;index++) glyphs.push(new Glyph({name:`uni${(0x4e00+index).toString(16)}`,unicode:0x4e00+index,advanceWidth:1000,path}));
    glyphs.push(new Glyph({name:"Omega",unicode:0x3a9,advanceWidth:700,path}));
    const original = new Font({familyName:"Symbols Test",styleName:"Regular",unitsPerEm:1000,ascender:800,descender:-200,glyphs});
    const font = processFont(original.toArrayBuffer(),{...identity,characters:"Ω儁"});
    expect(font.glyphs["Ω"].paths).toHaveLength(1);
    expect(font.glyphs["儁"].paths).toHaveLength(1);
    expect(Object.keys(font.glyphs)).toHaveLength(768);
    expect(font.warnings.join(" ")).toContain("768-character limit");
  },30_000);
});
