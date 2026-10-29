import { describe, expect, it } from "vitest";
import { safeGcodeFilenameBase, assertRunnableFilePath } from "../../src/types/gcodeFileNames";

describe("FluidNC G-code filename compatibility",()=>{
  it.each([
    ["CMYK Cyan — Cyan","CMYK_Cyan_Cyan"],
    ["Café – Blue!","Cafe_Blue"],
    ["Black","Black"],
    ["1-Cyan_opt.gcode","1-Cyan_opt.gcode"],
    ["plot?~!","plot"],
    ["   ","untitled"],
  ])("generates a command-compatible name from %s",(name,expected)=>{
    expect(safeGcodeFilenameBase(name)).toBe(expected);
    expect(()=>assertRunnableFilePath('/'+expected+'.gcode')).not.toThrow();
  });
  it.each(["/CMYK Cyan — Cyan_opt.gcode","/Café.gcode","/job!.gcode","/job?.gcode","/job~1.gcode","/job\nG0X10.gcode"])("rejects an incompatible existing path without rewriting it: %s",path=>{
    expect(()=>assertRunnableFilePath(path)).toThrow(/Rename the file.*upload it again.*refresh/i);
  });
  it.each(["/CMYK Cyan Cyan_opt.gcode","/jobs/1-Cyan_opt.gcode"])("preserves a compatible existing path: %s",path=>{
    expect(()=>assertRunnableFilePath(path)).not.toThrow();
  });
});
