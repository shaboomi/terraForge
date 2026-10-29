import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFontLibrary, validateProcessedFont } from "../../src/main/fonts/library";
import type { ProcessedFont } from "../../src/types/fonts";

const directories: string[] = [];
const sample: ProcessedFont = {version:1,id:"test-font",name:"Test",sourceName:"Test.ttf",createdAt:"2026-10-29T00:00:00.000Z",unitsPerEm:1000,ascender:800,descender:-200,lineGap:0,glyphs:{I:{advanceWidth:300,paths:[{points:[{x:50,y:0,width:100},{x:50,y:700,width:100}]}]}},kerning:{},warnings:[]};
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory,{recursive:true,force:true}); });

describe("processed font library",() => {
  it("persists processed geometry for a fresh library instance and deletes by id",async () => {
    const directory = await mkdtemp(join(tmpdir(),"terraforge-font-library-")); directories.push(directory);
    const library = createFontLibrary(directory);
    await library.save(sample);
    expect(JSON.parse(await readFile(join(directory,"test-font.json"),"utf8"))).toEqual(sample);
    expect(await createFontLibrary(directory).list()).toEqual([sample]);
    await library.remove("test-font");
    expect(await library.list()).toEqual([]);
  });
  it("serializes concurrent save/list operations and rejects traversal",async () => {
    const directory = await mkdtemp(join(tmpdir(),"terraforge-font-library-")); directories.push(directory);
    const library = createFontLibrary(directory);
    const saved = library.save(sample), listed = library.list();
    await saved;
    expect(await listed).toEqual([sample]);
    await expect(library.remove("../other")).rejects.toThrow(/identifier/);
  });
  it("rejects corrupt persisted width metadata",async () => {
    const directory = await mkdtemp(join(tmpdir(),"terraforge-font-library-")); directories.push(directory);
    const invalid = structuredClone(sample); invalid.glyphs.I.paths[0].points[0].width = -1;
    expect(() => validateProcessedFont(invalid)).toThrow(/width/);
    await writeFile(join(directory,"test-font.json"),JSON.stringify(invalid));
    await expect(createFontLibrary(directory).list()).rejects.toThrow(/width/);
  });
});
