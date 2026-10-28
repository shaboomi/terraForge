import { v4 as uuid } from "uuid";
import type {
  BitmapAsset, BitmapAssetTable, CanvasItem, MachineConfig, PluginInput,
  PluginManifest, PluginParameters, PluginPen, PluginPolyline, PluginResult,
  SvgImport,
} from "../../../../types";
import { isBitmapImport } from "../../../../types";
import { BITMAP_LIMITS } from "../../../../types/bitmapValidation";
import { PLUGIN_LIMITS, validatePluginResult } from "../../../../types/pluginValidation";
import { tokenizePath, toAbsolute } from "../../../../workers/gcodeEngine/stages/pathParsing";
import { arcToBeziers, cubicBezier, quadBezier } from "../../../../workers/gcodeEngine/stages/geometryFlattening";
import type { CanvasState } from "../../store/canvasStore/types";
import { vectorObjectsForImport } from "../../store/canvasStore/services/vectorObjects";
import { normalizeSvgColor } from "../imports/services/svgImportHelpers";

type Page = { widthMM: number; heightMM: number };
export interface PreparedPluginArtwork {
  items: CanvasItem[];
  assets: BitmapAssetTable;
  penAssignments: Record<string, string>;
  groupId: string;
  groupName: string;
}
export interface ExistingPluginGroup {
  groupId?: string;
  groupName?: string;
  palette?: PluginPen[];
}

function cancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Plugin cancelled.", "AbortError");
}

/** Editing a result resolves its saved source instead of treating the result as a new input. */
export function selectedPluginSource(
  manifest: PluginManifest,
  canvas: CanvasState,
  editingImportId?: string | null,
): CanvasItem | undefined {
  if (manifest.input === "none") return undefined;
  let source: CanvasItem | undefined;
  if (editingImportId) {
    const target = canvas.imports.find((item) => item.id === editingImportId);
    if (!target) throw new Error("The generated artwork no longer exists.");
    const sourceId = target.pluginSource?.sourceId;
    source = canvas.imports.find((item) => item.id === sourceId);
    if (!source) throw new Error("The original source artwork is missing. The saved result is still usable; select a source and open the plugin to create a new result.");
  } else {
    if (canvas.allImportsSelected || canvas.selectedGroupId || canvas.selectedPathId || !canvas.selectedImportId) {
      throw new Error(`Select one ${manifest.input} to use this plugin.`);
    }
    source = canvas.imports.find((item) => item.id === canvas.selectedImportId);
  }
  if (!source || (manifest.input === "bitmap") !== isBitmapImport(source)) {
    throw new Error(`Select one ${manifest.input} to use this plugin.`);
  }
  return source;
}

export async function sourceRevision(source: CanvasItem): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(source));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function paletteFor(canvas: CanvasState): PluginPen[] {
  return canvas.layerGroups.map(({ id, name, color }) => ({ id, name: name.slice(0, 120), color: normalizeSvgColor(color) }));
}

async function bitmapPixels(asset: BitmapAsset, signal?: AbortSignal): Promise<Uint8Array> {
  if (asset.widthPx > BITMAP_LIMITS.dimensionPx || asset.heightPx > BITMAP_LIMITS.dimensionPx ||
      asset.widthPx * asset.heightPx > BITMAP_LIMITS.decodedPixels) throw new Error("The bitmap exceeds the plugin input pixel limit.");
  cancelled(signal);
  const binary = atob(asset.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes.buffer], { type: "image/png" }), {
    imageOrientation: "none", premultiplyAlpha: "none", colorSpaceConversion: "default",
  });
  const canvas = document.createElement("canvas");
  try {
    cancelled(signal);
    if (image.width !== asset.widthPx || image.height !== asset.heightPx) throw new Error("The decoded bitmap dimensions do not match its asset.");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!context) throw new Error("Bitmap processing is unavailable on this system.");
    context.drawImage(image, 0, 0);
    const pixels = new Uint8Array(context.getImageData(0, 0, image.width, image.height, { colorSpace: "srgb" }).data);
    // Canvas supplies straight RGBA. Fully transparent pixels have a defined RGB value.
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] === 0) pixels[index] = pixels[index + 1] = pixels[index + 2] = 0;
    }
    cancelled(signal);
    return pixels;
  } finally {
    image.close();
    canvas.width = canvas.height = 0;
  }
}

/** Reuse the plotter's SVG parser/curve approximation, checking the budget after each segment. */
function boundedLocalPaths(d: string, source: SvgImport, budget: { points: number; paths: number }) {
  if (d.length > 2 * 1024 * 1024) throw new Error("The vector is too detailed for a plugin input. Simplify it first.");
  const paths: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  let x = 0, y = 0, startX = 0, startY = 0, controlX = 0, controlY = 0, previous = "";
  const finish = () => {
    if (current.length > 1) {
      if (++budget.paths > PLUGIN_LIMITS.paths) throw new Error("The vector exceeds the plugin input path limit. Simplify it first.");
      paths.push(current);
    }
    current = [];
  };
  const push = (rawX: number, rawY: number) => {
    if (++budget.points > PLUGIN_LIMITS.points) throw new Error("The vector exceeds the plugin input point limit. Simplify it first.");
    const localX = rawX - source.viewBoxX, localY = rawY - source.viewBoxY, epsilon = 1e-7;
    if (!Number.isFinite(localX) || !Number.isFinite(localY) || localX < -epsilon || localY < -epsilon ||
        localX > source.svgWidth + epsilon || localY > source.svgHeight + epsilon) {
      throw new Error("The vector contains paths outside its declared frame. Adjust the source before processing it.");
    }
    current.push({ x: Math.max(0, Math.min(source.svgWidth, localX)), y: Math.max(0, Math.min(source.svgHeight, localY)) });
    x = rawX; y = rawY;
  };
  const curve = (points: { x: number; y: number }[], endX: number, endY: number) => {
    if (!points.length) push(endX, endY);
    else for (const point of points) push(point.x, point.y);
  };
  for (const { type, args: a } of toAbsolute(tokenizePath(d))) {
    if (a.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9)) throw new Error("The source vector has unsupported coordinates.");
    if ((type === "S" && previous !== "C" && previous !== "S") || (type === "T" && previous !== "Q" && previous !== "T")) {
      controlX = x; controlY = y;
    }
    if (type !== "M" && type !== "Z" && current.length === 0) push(x, y);
    switch (type) {
      case "M":
        finish();
        startX = a[0]; startY = a[1];
        for (let index = 0; index < a.length; index += 2) push(a[index], a[index + 1]);
        controlX = x; controlY = y;
        break;
      case "L":
        for (let index = 0; index < a.length; index += 2) push(a[index], a[index + 1]);
        controlX = x; controlY = y;
        break;
      case "H":
        for (const value of a) push(value, y);
        controlX = x; controlY = y;
        break;
      case "V":
        for (const value of a) push(x, value);
        controlX = x; controlY = y;
        break;
      case "Z":
        push(startX, startY); finish();
        controlX = x; controlY = y;
        break;
      case "C":
        for (let index = 0; index < a.length; index += 6) {
          curve(cubicBezier(x, y, a[index], a[index + 1], a[index + 2], a[index + 3], a[index + 4], a[index + 5]), a[index + 4], a[index + 5]);
          controlX = a[index + 2]; controlY = a[index + 3];
        }
        break;
      case "S":
        for (let index = 0; index < a.length; index += 4) {
          curve(cubicBezier(x, y, 2 * x - controlX, 2 * y - controlY, a[index], a[index + 1], a[index + 2], a[index + 3]), a[index + 2], a[index + 3]);
          controlX = a[index]; controlY = a[index + 1];
        }
        break;
      case "Q":
        for (let index = 0; index < a.length; index += 4) {
          curve(quadBezier(x, y, a[index], a[index + 1], a[index + 2], a[index + 3]), a[index + 2], a[index + 3]);
          controlX = a[index]; controlY = a[index + 1];
        }
        break;
      case "T":
        for (let index = 0; index < a.length; index += 2) {
          const reflectedX = 2 * x - controlX, reflectedY = 2 * y - controlY;
          curve(quadBezier(x, y, reflectedX, reflectedY, a[index], a[index + 1]), a[index], a[index + 1]);
          controlX = reflectedX; controlY = reflectedY;
        }
        break;
      case "A":
        for (let index = 0; index < a.length; index += 7) {
          curve(arcToBeziers(x, y, a[index], a[index + 1], a[index + 2], a[index + 3], a[index + 4], a[index + 5], a[index + 6]), a[index + 5], a[index + 6]);
          controlX = x; controlY = y;
        }
        break;
    }
    previous = type;
  }
  finish();
  return paths;
}

function vectorPixels(source: SvgImport, canvas: CanvasState): PluginPolyline[] {
  const pen = canvas.layerGroups.find((group) => group.importIds.includes(source.id));
  const objects = vectorObjectsForImport(source, pen?.color);
  const paths: PluginPolyline[] = [];
  const budget = { paths: 0, points: 0 };
  for (const object of objects) {
    for (const normalized of boundedLocalPaths(object.path, source, budget)) {
      const color = object.sourceColor && /^#[0-9a-f]{6}$/i.test(object.sourceColor) ? object.sourceColor : "#000000";
      paths.push({ points: normalized, color, ...(pen ? { penId: pen.id } : {}) });
    }
  }
  if (!paths.length) throw new Error("The selected vector has no visible paths to process.");
  return paths;
}

/** All processor coordinates remain source-local; machine transforms are never sent to algorithms. */
export async function buildPluginInput(
  manifest: PluginManifest,
  canvas: CanvasState,
  page: Page,
  source?: CanvasItem,
  signal?: AbortSignal,
): Promise<PluginInput> {
  const palette = paletteFor(canvas);
  cancelled(signal);
  if (manifest.input === "none") return { kind: "none", page: { ...page }, palette };
  if (!source || (manifest.input === "bitmap") !== isBitmapImport(source)) throw new Error(`Select one ${manifest.input} to use this plugin.`);
  const common = {
    page: { ...page }, palette, sourceId: source.id, width: source.svgWidth, height: source.svgHeight,
    placement: { x: source.x, y: source.y, scale: source.scale, rotation: source.rotation,
      ...(source.scaleX === undefined ? {} : { scaleX: source.scaleX }),
      ...(source.scaleY === undefined ? {} : { scaleY: source.scaleY }) },
  };
  if (isBitmapImport(source)) {
    const asset = canvas.assets[source.assetId];
    if (!asset) throw new Error("The selected bitmap's embedded asset is missing.");
    return { ...common, kind: "bitmap", widthPx: asset.widthPx, heightPx: asset.heightPx,
      data: await bitmapPixels(asset, signal) };
  }
  const paths = vectorPixels(source, canvas);
  cancelled(signal);
  return { ...common, kind: "vector", paths };
}

function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return btoa(chunks.join(""));
}

async function pixelAsset(widthPx: number, heightPx: number, data: Uint8Array): Promise<BitmapAsset> {
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  try {
    const context = canvas.getContext("2d", { colorSpace: "srgb" });
    if (!context) throw new Error("Bitmap output is unavailable on this system.");
    const owned = new Uint8ClampedArray(data.length);
    owned.set(data);
    context.putImageData(new ImageData(owned, widthPx, heightPx, { colorSpace: "srgb" }), 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
      if (value) resolve(value); else reject(new Error("The plugin bitmap could not be encoded for saving."));
    }, "image/png"));
    if (blob.size > BITMAP_LIMITS.encodedAssetBytes) throw new Error("The plugin bitmap exceeds the encoded asset limit.");
    const buffer = await blob.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    const id = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return { id, mimeType: "image/png", widthPx, heightPx, data: base64(new Uint8Array(buffer)) };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

function generatorPlacement(width: number, height: number, machine?: MachineConfig): Pick<CanvasItem, "x" | "y" | "scale" | "scaleX" | "scaleY" | "rotation"> {
  const origin = machine?.origin ?? "bottom-left";
  const right = origin === "bottom-right" || origin === "top-right";
  const top = origin === "top-left" || origin === "top-right";
  return { x: right ? (machine?.bedWidth ?? 220) - width : 0, y: top ? -height : 0,
    scale: 1, rotation: 0 };
}

export async function preparePluginArtwork(
  rawResult: PluginResult,
  manifest: PluginManifest,
  parameters: PluginParameters,
  page: Page,
  machine?: MachineConfig,
  source?: CanvasItem,
  seed = 1,
  existingGroup: ExistingPluginGroup = {},
): Promise<PreparedPluginArtwork> {
  const palette = existingGroup.palette ?? [];
  const validationInput: PluginInput = source ? { kind: "vector", page, palette, sourceId: source.id,
    width: source.svgWidth, height: source.svgHeight, paths: [], placement: { x: source.x, y: source.y,
      scale: source.scale, scaleX: source.scaleX, scaleY: source.scaleY, rotation: source.rotation } }
    : { kind: "none", page, palette };
  const result = validatePluginResult(rawResult, { runId: "prepare", pluginId: manifest.id,
    input: validationInput, parameters, seed }, manifest);
  const outputs = "items" in result ? result.items : [{ ...result, kind: "vector" as const }];
  const items: CanvasItem[] = [];
  const assets: Record<string, BitmapAsset> = {};
  const penAssignments: Record<string, string> = {};
  const groupId = existingGroup.groupId ?? uuid();
  const groupName = (existingGroup.groupName ?? `${manifest.name} output`).slice(0, 120);
  const revision = source ? await sourceRevision(source) : undefined;
  for (const [rawOutputIndex, output] of outputs.entries()) {
    if (!manifest.outputs.includes(output.kind)) throw new Error("The plugin returned an undeclared output kind.");
    if (source && (output.width !== source.svgWidth || output.height !== source.svgHeight)) throw new Error("Processor output must preserve the complete source frame.");
    if (!source && (output.width > page.widthMM || output.height > page.heightMM)) throw new Error("The artwork is larger than the page. Reduce its dimensions and run the plugin again.");
    const placement = source ? {
      x: source.x, y: source.y, scale: source.scale, scaleX: source.scaleX, scaleY: source.scaleY,
      rotation: source.rotation,
    } : generatorPlacement(output.width, output.height, machine);
    const provenance = (outputKey: string) => ({ pluginId: manifest.id, pluginVersion: manifest.version,
      parameters: { ...parameters }, apiVersion: 1 as const, seed, outputGroupId: groupId,
      outputGroupName: groupName, outputIndex: items.length, outputKey, outputWidth: output.width, outputHeight: output.height,
      ...(source ? { sourceId: source.id, sourceRevision: revision } : {}) });
    if (output.kind === "bitmap") {
      if (items.length >= PLUGIN_LIMITS.outputItems) throw new Error("The plugin result produces too many canvas items after pen separation.");
      const asset = await pixelAsset(output.widthPx, output.heightPx, output.data);
      assets[asset.id] = asset;
      const scaleX = (placement.scaleX ?? placement.scale) * output.width / output.widthPx;
      const scaleY = (placement.scaleY ?? placement.scale) * output.height / output.heightPx;
      items.push({ id: uuid(), name: output.name ?? manifest.name, kind: "bitmap", assetId: asset.id,
        ...placement, scaleX, scaleY, visible: true, opacity: 1, svgWidth: output.widthPx,
        svgHeight: output.heightPx, viewBoxX: 0, viewBoxY: 0, pluginSource: provenance(`${rawOutputIndex}:bitmap`) });
      continue;
    }
    const partitions = new Map<string | undefined, PluginPolyline[]>();
    for (const path of output.paths) {
      if (path.penId && !palette.some((pen) => pen.id === path.penId)) throw new Error("The plugin returned an unavailable pen assignment.");
      const paths = partitions.get(path.penId) ?? [];
      paths.push(path);
      partitions.set(path.penId, paths);
    }
    for (const [penId, paths] of partitions) {
      if (items.length >= PLUGIN_LIMITS.outputItems) throw new Error("The plugin result produces too many canvas items after pen separation.");
      const pen = palette.find((entry) => entry.id === penId);
      const id = uuid();
      const artwork: SvgImport = { id, kind: "vector", name: `${output.name ?? manifest.name}${pen ? ` — ${pen.name}` : ""}`.slice(0, 1000),
        ...placement, visible: true, svgWidth: output.width, svgHeight: output.height,
        viewBoxX: 0, viewBoxY: 0, hatchEnabled: false, strokeEnabled: true, pluginSource: provenance(`${rawOutputIndex}:vector:${penId ?? ""}`),
        paths: paths.map((path, index) => {
          const color = pen?.color ?? path.color ?? "#000000";
          const d = path.points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ") + (path.closed ? " Z" : "");
          return { id: uuid(), d, svgSource: `<path d="${d}" fill="none" stroke="${color}" />`,
            visible: true, label: `Path ${index + 1}`, strokeColor: color, sourceColor: color,
            sourceOutlineVisible: true, outlineVisible: true, strokeEnabled: true, hasFill: false };
        }) };
      items.push(artwork);
      if (penId) penAssignments[id] = penId;
    }
  }
  return { items, assets, penAssignments, groupId, groupName };
}
