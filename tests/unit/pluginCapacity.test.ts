import {describe,expect,it} from "vitest";
import {PLUGIN_LIMITS,pluginExecutionLimits,validatePluginResult,validatePluginRunRequest} from "../../src/types/pluginValidation";
import type {PluginRunRequest} from "../../src/types";
const request:PluginRunRequest={runId:"capacity",pluginId:"test.generator",input:{kind:"none",page:{widthMM:420,heightMM:594}},parameters:{}};
const path={points:[{x:0,y:0},{x:1,y:1}]};
describe("explicit plugin artwork capacity",()=>{
  it("keeps the original default and grants exactly sixfold capacity only on request",()=>{
    expect(pluginExecutionLimits()).toEqual({paths:10000,points:100000,executionMs:30000});
    expect(pluginExecutionLimits("extended")).toEqual({paths:60000,points:600000,executionMs:180000});
    expect(validatePluginRunRequest({...request,detailBudget:"extended"}).detailBudget).toBe("extended");
    for(const detailBudget of ["unlimited",7,null,{}])expect(()=>validatePluginRunRequest({...request,detailBudget})).toThrow(/capacity/);
  });
  it("uses the selected capacity at validation boundaries and rejects excess output",()=>{
    const output={width:1,height:1,paths:Array(PLUGIN_LIMITS.paths+1).fill(path)};
    expect(()=>validatePluginResult(output,request)).toThrow(/paths/);
    expect(validatePluginResult(output,{...request,detailBudget:"extended"})).toMatchObject({width:1,height:1});
    const points=Array.from({length:100001},()=>({x:0,y:0}));
    expect(()=>validatePluginResult({width:1,height:1,paths:[{points}]},request)).toThrow(/points/);
    expect(()=>validatePluginResult({width:1,height:1,paths:[{points}]},{...request,detailBudget:"extended"})).not.toThrow();
    expect(()=>validatePluginResult({...output,paths:Array(60001).fill(path)},{...request,detailBudget:"extended"})).toThrow(/60000/);
    expect(()=>validatePluginResult({width:1,height:1,paths:[{points:Array(600001).fill({x:0,y:0})}]},{...request,detailBudget:"extended"})).toThrow(/600000/);
  });
});
