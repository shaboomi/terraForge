import { test, expect } from "@playwright/test";
import { _electron as electron, type ElectronApplication, type Page } from "playwright";
import { Resvg } from "@resvg/resvg-js";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { mockOpenDialog, mockSaveDialog, mockIpcInvoke } from "./helpers";
import type { CanvasLayout, SvgImport } from "../../src/types";

const ROOT = path.resolve(__dirname, "../..");
const PREFIX = "terraforge-cmyk-e2e-";
const EXECUTABLE = process.env.TERRAFORGE_CMYK_EXECUTABLE;
const NAME = "CMYK Circles";
let temporaryRoot: string;
let profile: string;
let pluginDir: string;
let application: ElectronApplication | undefined;
let page: Page;

function sourceLayout(): CanvasLayout {
  // Original, reproducible RGBA artwork: deliberately rectangular with empty margins.
  const bytes = new Resvg('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="64"><path fill="#ff0000" d="M8 8H48V56H8Z"/><path fill="#0000ff" d="M48 8H88V56H48Z"/><circle cx="30" cy="30" r="10" fill="#000000"/><circle cx="68" cy="32" r="12" fill="#ff0000"/></svg>').render().asPng();
  const id = createHash("sha256").update(bytes).digest("hex");
  return { tfVersion: 2, savedAt: new Date().toISOString(), assets: {
    [id]: { id, mimeType: "image/png", widthPx: 96, heightPx: 64, data: Buffer.from(bytes).toString("base64") },
  }, imports: [{ id: "source-image", name: "CMYK source image", kind: "bitmap", assetId: id,
    svgWidth: 96, svgHeight: 64, viewBoxX: 0, viewBoxY: 0, x: 25, y: 25,
    scale: 1, scaleX: 1.1, scaleY: 0.75, rotation: 32, visible: true, opacity: 0.65 }],
    layerGroups: [{ id:"k",name:"Black",color:"#000000",importIds:[] },{ id:"y",name:"Yellow",color:"#ffff00",importIds:[] },{ id:"m",name:"Magenta",color:"#ff00ff",importIds:[] },{ id:"c",name:"Cyan",color:"#00ffff",importIds:[] }], activePenId:"k",
    pageTemplate: { sizeId: "a5", landscape: false, marginMM: 5, color: "#eeeeee" } };
}

async function launch() {
  application = await electron.launch({
    ...(EXECUTABLE ? { executablePath: path.resolve(EXECUTABLE) } : {}),
    args: [`--user-data-dir=${profile}`, ...(EXECUTABLE ? [] : [path.join(ROOT, "out/main/index.js")])], cwd: ROOT,
    env: { ...process.env, NODE_ENV: "test", ELECTRON_RUN_AS_NODE: undefined,
      TERRAFORGE_PLUGIN_DIR: pluginDir },
  });
  const identity = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath("userData") }));
  expect(path.resolve(identity.profile).toLowerCase()).toBe(path.resolve(profile).toLowerCase());
  expect(identity.packaged).toBe(!!EXECUTABLE);
  page = await application.firstWindow();
  await page.getByRole("combobox", { name: "Machine selector" }).waitFor();
}
async function close() {
  if (application) { const running = application; application = undefined; await running.close(); }
}
async function menu(channel: "menu:saveLayout" | "menu:openLayout") {
  const window = await application!.browserWindow(page);
  try { await window.evaluate((main, action) => main.webContents.send(action), channel); }
  finally { await window.dispose(); }
}
async function open(filename: string) { await mockOpenDialog(application!, filename); await menu("menu:openLayout"); }
async function save(filename: string, count: number): Promise<CanvasLayout> {
  const target = path.join(temporaryRoot, filename);
  await mockSaveDialog(application!, target); await menu("menu:saveLayout");
  await expect.poll(() => { try { return JSON.parse(readFileSync(target, "utf8")).imports.length; } catch { return -1; } }).toBe(count);
  return JSON.parse(readFileSync(target, "utf8"));
}
const rows = () => page.locator("span[title='Double-click to rename']").filter({ hasNotText: /^(Black|Yellow|Magenta|Cyan)$/ });
const panel = () => page.getByRole("region", { name: `Plugin: ${NAME}`, exact: true });
const control = (key: string) => panel().locator(`#plugin-control-${key}`);
async function choosePlugin() {
  await page.getByRole("button", { name: "Plugins", exact: true }).click();
  await page.getByRole("menuitem", { name: "Bitmap to Vector", exact: true }).click();
  await page.getByRole("menuitem", { name: NAME, exact: true }).click();
  await expect(page.getByRole("menu", { name: "Plugins", exact: true })).toHaveCount(0);
}
async function setupScene() {
  const layoutPath = path.join(temporaryRoot, "source.tforge");
  writeFileSync(layoutPath, JSON.stringify(sourceLayout()));
  await launch(); await open(layoutPath);
  await expect(rows()).toHaveCount(1);
  await rows().filter({ hasText: /^CMYK source image$/ }).click();
  await choosePlugin();
}
async function preview(action = "Apply artwork") {
  await panel().getByRole("button", { name: "Preview", exact: true }).click();
  await expect(panel().getByRole("button", { name: action, exact: true })).toBeEnabled();
}
async function undo() {
  await page.locator("body").click({ position: { x: 470, y: 350 } });
  await page.keyboard.press("Control+z");
}
async function canvasChecksum() {
  return page.locator("canvas[data-testid='toolpath-canvas']").evaluate((canvas: HTMLCanvasElement) => {
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let index = 0; index < pixels.length; index += 4) {
      hash = Math.imul(hash ^ pixels[index], 16777619);
      hash = Math.imul(hash ^ pixels[index + 1], 16777619);
    }
    return hash >>> 0;
  });
}
function vectors(layout: CanvasLayout) { return layout.imports.filter(item => item.pluginSource) as SvgImport[]; }
function geometry(layout: CanvasLayout) { return vectors(layout).map(item => item.paths.map(p => p.d)); }
async function editResult(name: string) {
  await rows().filter({ hasText: name }).first().click();
  await page.getByRole("button", { name: `Edit with ${NAME}`, exact: true }).click();
}

test.skip(process.platform !== "win32", "The sandboxed plugin workflow is currently verified on Windows.");
test.beforeEach(() => {
  temporaryRoot = mkdtempSync(path.join(tmpdir(), PREFIX)); profile = path.join(temporaryRoot, "user-data");
  pluginDir = EXECUTABLE ? path.join(profile, "plugins") : path.join(temporaryRoot, "plugins");
  mkdirSync(pluginDir, { recursive: true });
  copyFileSync(path.join(ROOT, "docs/examples/cmyk-circles.tf-plugin.js"), path.join(pluginDir, "cmyk-sawtooth.tf-plugin.js"));
});
test.afterEach(async () => {
  await close();
  const resolved = path.resolve(temporaryRoot);
  if (path.dirname(resolved).toLowerCase() !== path.resolve(tmpdir()).toLowerCase() || !path.basename(resolved).startsWith(PREFIX)) throw new Error("Refusing cleanup outside the cmyk test directory.");
  rmSync(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
});


test("CMYK source, previews, grouped apply/update, undo, reopen and real K-last optimized export", async () => {
  test.setTimeout(150_000);
  await setupScene();
  await expect(control("cyanPen")).toHaveValue("c");
  await expect(control("blackPen")).toHaveValue("k");
  await control("diameter").fill("10");
  await control("cyanX").fill("2");
  await control("yellowAngle").fill("8");
  await control("border").check();
  const originalPixels=await canvasChecksum();
  await preview();
  await expect.poll(canvasChecksum).not.toBe(originalPixels);
  await expect(rows()).toHaveCount(1);
  await expect(page.getByRole("button",{name:"Generate G-code",exact:true})).toBeDisabled();
  const before=await save("preview-only.tforge",1);
  expect(before.imports).toEqual(sourceLayout().imports);expect(before.assets).toEqual(sourceLayout().assets);
  await panel().getByRole("button",{name:"Minimise plugin panel"}).click();
  await panel().getByRole("button",{name:"Expand plugin panel"}).click();
  await expect(control("diameter")).toHaveValue("10");
  await expect(panel().getByRole("button",{name:"Apply artwork",exact:true})).toBeEnabled();
  await page.screenshot({path:test.info().outputPath("cmyk-preview.png")});
  await panel().getByRole("button",{name:"Close plugin panel"}).click();
  await expect(panel()).toHaveCount(0);expect((await save("closed.tforge",1)).imports).toEqual(before.imports);
  await choosePlugin();await preview();
  await panel().getByRole("button",{name:"Apply artwork",exact:true}).click();
  const applied=await save("applied.tforge",5);
  expect(applied.imports[0]).toEqual(before.imports[0]);expect(applied.assets).toEqual(before.assets);
  expect(applied.layerGroups!.map(p=>p.id)).toEqual(before.layerGroups!.map(p=>p.id));expect(applied.activePenId).toBe("k");
  expect(vectors(applied).map(item=>item.pluginSource!.plotOrder)).toEqual([0,1,2,3]);
  expect(new Set(vectors(applied).map(item=>item.pluginSource!.outputGroupId)).size).toBe(1);
  for(const [i,item] of vectors(applied).entries()) {
    expect(item).toMatchObject({x:25,y:25,scaleX:1.1,scaleY:0.75,rotation:32,svgWidth:96,svgHeight:64,
      pluginSource:{sourceId:"source-image",parameters:{diameter:10,cyanX:2,yellowAngle:8,cyanPen:"c",magentaPen:"m",yellowPen:"y",blackPen:"k",border:true}}});
    expect(applied.layerGroups!.find(p=>p.importIds.includes(item.id))!.id).toBe(["c","m","y","k"][i]);
    expect(item.paths.every(path=>path.svgSource.includes('fill="none"'))).toBe(true);
  }
  await undo();await expect(rows()).toHaveCount(1);await page.keyboard.press("Control+y");await expect(rows()).toHaveCount(5);
  await panel().getByRole("button",{name:"Close plugin panel"}).click();await editResult(vectors(applied)[0].name);
  await expect(control("diameter")).toHaveValue("10");await control("diameter").fill("12");await preview("Update artwork");
  expect((await save("during-update.tforge",5)).imports).toEqual(applied.imports);
  await panel().getByRole("button",{name:"Update artwork",exact:true}).click();
  const updated=await save("updated.tforge",5);
  expect(updated.imports.map(item=>item.id)).toEqual(applied.imports.map(item=>item.id));expect(geometry(updated)).not.toEqual(geometry(applied));
  await undo();expect((await save("undo-update.tforge",5)).imports).toEqual(applied.imports);
  await page.keyboard.press("Control+y");expect((await save("redo-update.tforge",5)).imports).toEqual(updated.imports);
  await close();await launch();await open(path.join(temporaryRoot,"updated.tforge"));await editResult(vectors(updated)[0].name);
  await expect(control("diameter")).toHaveValue("12");await expect(control("cyanPen")).toHaveValue("c");
  await preview("Update artwork");await panel().getByRole("button",{name:"Update artwork",exact:true}).click();
  const reopened=await save("reopened.tforge",5);expect(geometry(reopened)).toEqual(geometry(updated));expect(reopened.imports[0]).toEqual(before.imports[0]);
  await panel().getByRole("button",{name:"Close plugin panel"}).click();
  const output=path.join(temporaryRoot,"cmyk-optimized.gcode");
  await page.getByRole("button",{name:"Generate G-code",exact:true}).click();
  await page.getByRole("tab",{name:/^paths$/i}).click();await page.getByLabel("Optimise paths",{exact:false}).check();
  await page.getByRole("tab",{name:/^output$/i}).click();await page.getByLabel("Save to computer",{exact:false}).check();
  await mockSaveDialog(application!,output);await page.getByRole("button",{name:"Generate",exact:true}).click();
  await expect.poll(()=>{try{return readFileSync(output,"utf8")}catch{return ""}},{timeout:30_000}).toContain("pen=k");
  const gcode=readFileSync(output,"utf8");
  expect([...gcode.matchAll(/^;@tf .*pen=([^\s]+)/gm)].map(match=>match[1])).toEqual(["c","m","y","k"]);
  await page.screenshot({path:test.info().outputPath("cmyk-reopened.png")});
  const split=path.join(temporaryRoot,"per-pen");mkdirSync(split,{recursive:true});
  await mockIpcInvoke(application!,"fs:chooseDirectory",split);
  await page.getByRole("button",{name:"Generate G-code",exact:true}).click();
  await page.getByRole("tab",{name:/^output$/i}).click();
  await page.getByLabel("Split output into separate files",{exact:true}).check();
  await page.getByLabel("Export one file per group",{exact:true}).check();
  await page.getByRole("button",{name:"Generate",exact:true}).click();
  for(const [i,name]of ["Cyan","Magenta","Yellow","Black"].entries()) {
    const filename=path.join(split,(i+1)+"-"+name+"_opt.gcode");
    await expect.poll(()=>{try{return readFileSync(filename,"utf8")}catch{return ""}},{timeout:30_000}).toContain("pen="+["c","m","y","k"][i]);
  }

});

test("duplicate assignments fail without applying partial layers",async()=>{
  await setupScene();await control("cyanPen").selectOption("k");
  await panel().getByRole("button",{name:"Preview",exact:true}).click();
  await expect(panel().getByRole("alert")).toContainText("four distinct pen IDs");
  expect((await save("invalid.tforge",1)).imports).toEqual(sourceLayout().imports);
  await expect(panel().getByRole("button",{name:"Apply artwork",exact:true})).toHaveCount(0);
});
