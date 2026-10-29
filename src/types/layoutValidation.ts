import type { BitmapAsset, CanvasItem, CanvasLayout, CanvasItemBase, LayerGroup, PageTemplate, PluginProvenance, SvgImport, SvgPath } from "./index";
import { validateBitmapPreparationSettings } from "./pluginBitmapPreparation";
import { isBitmapImport } from "./index";
import { assertBitmapAssetBudget, BITMAP_LIMITS, validateBitmapAsset } from "./bitmapValidation";
import { parsePenProfile } from "./pens";

type Row = Record<string, unknown>;
const BAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const BASE_FIELDS = ["kind", "id", "name", "x", "y", "scale", "scaleX", "scaleY", "rotation", "visible", "svgWidth", "svgHeight", "viewBoxX", "viewBoxY", "pluginSource"];
const VECTOR_FLAGS = ["hatchEnabled", "strokeEnabled", "plotPointsEnabled", "generatedStrokeForNoStroke", "useStrokeWidths"];
const PATH_FLAGS = ["hasFill", "sourceOutlineVisible", "outlineVisible", "strokeEnabled", "fillEnabled", "generatedStrokeEnabled"];
const COLOURS = ["fillColor", "strokeColor", "sourceColor"];

function row(value: unknown, label: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (BAD_KEYS.has(key)) throw new Error(`${label} contains a reserved key.`);
  return value as Row;
}
function fields(value: Row, allowed: string[], label: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error(`${label} contains unsupported fields.`);
}
function text(value: unknown, label: string, max = 1000): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label} must be text of at most ${max} characters.`);
  return value;
}
function id(value: unknown, label = "ID"): string {
  const result = text(value, label, 256);
  if (!result || BAD_KEYS.has(result) || /[\u0000-\u001f]/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}
function number(value: unknown, label: string, min = -1e9, max = 1e9): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) throw new Error(`${label} must be a finite number in range.`);
  return value;
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label} must be boolean.`);
  return value;
}
function array(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be an array with at most ${max} entries.`);
  return value;
}
function unique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}
function color(value: unknown): string {
  const result = text(value, "Colour", 200);
  if (!/^(?:#[\da-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|hsl)a?\([\d.,%\s+\-]+\)|url\(\s*#[^\s()<>"'][^\s()<>"']*\s*\))$/.test(result)) throw new Error("Layout contains an invalid colour.");
  return result;
}

/** Validate SVG path tokens without forgiving unknown characters or non-finite numbers. */
function geometry(value: unknown): string {
  const d = text(value, "Path geometry", 2 * 1024 * 1024);
  if (!d.trim()) return d;
  const tokens = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  const arity: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  let previous = 0, command = "", argumentsCount = 0, tokensCount = 0;
  const checkCommand = () => {
    const count = arity[command];
    if ((count === 0 && argumentsCount !== 0) || (count > 0 && (argumentsCount === 0 || argumentsCount % count !== 0))) throw new Error("SVG path has an incomplete command.");
  };
  for (const match of d.matchAll(tokens)) {
    if (++tokensCount > 500000) throw new Error("SVG path contains too many coordinates.");
    if (!/^[\s,]*$/.test(d.slice(previous, match.index))) throw new Error("SVG path contains invalid characters.");
    previous = match.index! + match[0].length;
    if (/^[A-Za-z]$/.test(match[0])) {
      if (!command && match[0].toUpperCase() !== "M") throw new Error("SVG path must start with moveto.");
      if (command) checkCommand();
      command = match[0].toUpperCase(); argumentsCount = 0;
    } else {
      if (!command) throw new Error("SVG path has no command.");
      number(Number(match[0]), "Path coordinate");
      if (command === "A" && [3, 4].includes(argumentsCount % 7) && match[0] !== "0" && match[0] !== "1") throw new Error("SVG arc flags must be zero or one.");
      argumentsCount++;
    }
  }
  if (!command || !/^[\s,]*$/.test(d.slice(previous))) throw new Error("SVG path geometry is invalid.");
  checkCommand();
  return d;
}

function base(item: Row): CanvasItemBase {
  const result: CanvasItemBase = {
    id: id(item.id), name: text(item.name, "Item name"),
    x: number(item.x, "Item X", -1e6, 1e6), y: number(item.y, "Item Y", -1e6, 1e6),
    scale: number(item.scale, "Item scale", -1e6, 1e6), rotation: number(item.rotation, "Rotation", -1e6, 1e6),
    visible: bool(item.visible, "Visibility"),
    svgWidth: number(item.svgWidth, "Source width", 0),
    svgHeight: number(item.svgHeight, "Source height", 0),
    viewBoxX: number(item.viewBoxX ?? 0, "Frame X"), viewBoxY: number(item.viewBoxY ?? 0, "Frame Y"),
  };
  if (result.scale === 0) throw new Error("Item scale must not be zero.");
  for (const key of ["scaleX", "scaleY"] as const) if (item[key] !== undefined) {
    result[key] = number(item[key], key, -1e6, 1e6);
    if (result[key] === 0) throw new Error("Item scale must not be zero.");
  }
  if (item.pluginSource !== undefined) result.pluginSource = pluginProvenance(item.pluginSource);
  return result;
}

function pluginSourceIdentity(provenance: Record<string, unknown>): Pick<PluginProvenance, "sourceFingerprint" | "bitmapPreparation"> {
  const result: Pick<PluginProvenance, "sourceFingerprint" | "bitmapPreparation"> = {};
  if (provenance.bitmapPreparation !== undefined) result.bitmapPreparation = validateBitmapPreparationSettings(provenance.bitmapPreparation);
  if (provenance.sourceFingerprint !== undefined) {
    if (typeof provenance.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(provenance.sourceFingerprint)) throw new Error("Invalid saved plugin source fingerprint.");
    result.sourceFingerprint = provenance.sourceFingerprint;
  }
  return result;
}

function pluginProvenance(value: unknown): PluginProvenance {
  const provenance = row(value, "Plugin provenance");
  fields(provenance, ["pluginId", "pluginVersion", "parameters", "apiVersion", "seed", "sourceId", "sourceRevision", "outputGroupId", "outputGroupName", "outputIndex", "outputKey", "outputWidth", "outputHeight", "plotOrder", "detailBudget", "sourceFingerprint", "bitmapPreparation"], "Plugin provenance");
  const parameters = row(provenance.parameters, "Plugin parameters");
  if (Object.keys(parameters).length > 32) throw new Error("Too many saved plugin parameters.");
  const safeParameters: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(parameters)) {
    id(key, "Parameter key");
    if (typeof entry === "string") safeParameters[key] = text(entry, "Plugin parameter", 4096);
    else if (typeof entry === "number") safeParameters[key] = number(entry, "Plugin parameter");
    else if (typeof entry === "boolean") safeParameters[key] = entry;
    else throw new Error("Saved plugin parameters must be primitive values.");
  }
  const result: PluginProvenance = { pluginId: id(provenance.pluginId, "Plugin ID"), pluginVersion: text(provenance.pluginVersion, "Plugin version", 80), parameters: safeParameters, ...pluginSourceIdentity(provenance) };
  if (provenance.detailBudget !== undefined) {
    if (provenance.detailBudget !== "standard" && provenance.detailBudget !== "extended") throw new Error("Unsupported saved artwork capacity.");
    result.detailBudget = provenance.detailBudget;
  }
  if (provenance.plotOrder !== undefined) {
    const order = number(provenance.plotOrder, "Plot order", 0, 15);
    if (!Number.isInteger(order)) throw new Error("Plot order must be an integer.");
    result.plotOrder = order;
  }
  if (provenance.apiVersion !== undefined) {
    if (provenance.apiVersion !== 1) throw new Error("Unsupported saved plugin API version.");
    result.apiVersion = 1;
  }
  if (provenance.seed !== undefined) {
    const seed = number(provenance.seed, "Plugin seed", 0, 0xffffffff);
    if (!Number.isInteger(seed)) throw new Error("Plugin seed must be an integer.");
    result.seed = seed;
  }
  for (const key of ["sourceId", "outputGroupId"] as const) if (provenance[key] !== undefined) result[key] = id(provenance[key], key);
  if (provenance.sourceRevision !== undefined) result.sourceRevision = text(provenance.sourceRevision, "Source revision", 256);
  if (provenance.outputGroupName !== undefined) result.outputGroupName = text(provenance.outputGroupName, "Output group name", 120);
  if (provenance.outputKey !== undefined) result.outputKey = text(provenance.outputKey, "Output key", 512);
  if (provenance.outputIndex !== undefined) {
    const index = number(provenance.outputIndex, "Output index", 0, 15);
    if (!Number.isInteger(index)) throw new Error("Output index must be an integer.");
    result.outputIndex = index;
  }
  for (const key of ["outputWidth", "outputHeight"] as const) if (provenance[key] !== undefined) {
    result[key] = number(provenance[key], key, Number.MIN_VALUE, 1e6);
  }
  return result;
}

function path(value: unknown): SvgPath {
  const item = row(value, "Path");
  fields(item, ["id", "d", "svgSource", "visible", "label", "layer", ...PATH_FLAGS, ...COLOURS, "hatchLines", "pointTap", "passCount", "passMode", "centerline"], "Path");
  const result: SvgPath = { id: id(item.id, "Path ID"), d: geometry(item.d), svgSource: text(item.svgSource ?? "", "Source SVG", 2 * 1024 * 1024), visible: bool(item.visible, "Path visibility") };
  if (item.label !== undefined) result.label = text(item.label, "Path label");
  if (item.layer !== undefined) result.layer = id(item.layer, "Layer reference");
  for (const key of PATH_FLAGS) if (item[key] !== undefined) Object.assign(result, { [key]: bool(item[key], key) });
  for (const key of COLOURS) if (item[key] !== undefined) Object.assign(result, { [key]: color(item[key]) });
  if (item.hatchLines !== undefined) result.hatchLines = Array.from(array(item.hatchLines, "Hatch lines", 100000), geometry);
  if (item.pointTap !== undefined) {
    const point = row(item.pointTap, "Point tap"); fields(point, ["x", "y"], "Point tap");
    result.pointTap = { x: number(point.x, "Point X"), y: number(point.y, "Point Y") };
  }
  if (item.centerline !== undefined) {
    const data = row(item.centerline, "Centreline"); fields(data, ["points"], "Centreline");
    const points = array(data.points, "Centreline samples", 500000).map(value => {
      const point = row(value, "Centreline sample"); fields(point, ["x", "y", "width"], "Centreline sample");
      return { x: number(point.x, "Centreline X"), y: number(point.y, "Centreline Y"), width: number(point.width, "Stroke width", Number.MIN_VALUE, 1e6) };
    });
    if (points.length < 2) throw new Error("Centreline needs at least two samples.");
    result.centerline = { points };
  }
  if (item.passCount !== undefined) {
    const count = number(item.passCount, "Pass count", 1, 1000);
    if (!Number.isInteger(count)) throw new Error("Pass count must be an integer.");
    result.passCount = count;
  }
  if (item.passMode !== undefined) {
    if (!["repeat", "backtrack", "penLift"].includes(String(item.passMode))) throw new Error("Invalid path pass mode.");
    result.passMode = item.passMode as SvgPath["passMode"];
  }
  return result;
}

function vector(item: Row): SvgImport {
  fields(item, [...BASE_FIELDS, "paths", "layers", ...VECTOR_FLAGS, "hatchSpacingMM", "hatchAngleDeg", "strokeWidthMM", "pluginSource", "textSource", "brushLeadInMM"], "Vector item");
  const result: SvgImport = { ...base(item), kind: "vector", paths: Array.from(array(item.paths, "Paths", 100000), path) };
  if (item.textSource !== undefined) {
    const source = row(item.textSource, "Text source");
    fields(source, ["fontId", "fontName", "text", "fontSizeMM", "letterSpacingMM", "lineSpacing", "alignment", "mode", "useStrokeWidths", "brushLeadInMM", "infill", "fillSpacingMM", "fillAngleDeg"], "Text source");
    if (!["left", "center", "right"].includes(String(source.alignment))) throw new Error("Invalid text alignment.");
    result.textSource = {
      fontId: id(source.fontId), fontName: text(source.fontName, "Font name"), text: text(source.text, "Text", 4096),
      fontSizeMM: number(source.fontSizeMM, "Font size", 1, 1000), letterSpacingMM: number(source.letterSpacingMM, "Letter spacing", -500, 1000),
      lineSpacing: number(source.lineSpacing, "Line spacing", 0.1, 10), alignment: source.alignment as "left" | "center" | "right",
    };
    if (source.mode !== undefined) {
      if (source.mode !== "centerline" && source.mode !== "outline") throw new Error("Invalid text font mode.");
      result.textSource.mode = source.mode;
    }
    if (source.useStrokeWidths !== undefined) result.textSource.useStrokeWidths = bool(source.useStrokeWidths, "Use stroke width information");
    if (source.brushLeadInMM !== undefined) result.textSource.brushLeadInMM = number(source.brushLeadInMM, "Brush lead-in", 0.1, 20);
    if (source.infill !== undefined) {
      if (source.infill !== "outline" && source.infill !== "solid" && source.infill !== "sketch") throw new Error("Invalid font infill pattern.");
      result.textSource.infill = source.infill;
    }
    if (source.fillSpacingMM !== undefined) result.textSource.fillSpacingMM = number(source.fillSpacingMM, "Font infill spacing", 0.05, 20);
    if (source.fillAngleDeg !== undefined) result.textSource.fillAngleDeg = number(source.fillAngleDeg, "Font infill angle", -360, 360);
  }
  unique(result.paths.map((entry) => entry.id), "Path IDs within an item");
  if (item.layers !== undefined) {
    result.layers = Array.from(array(item.layers, "Layers", 10000), (value) => {
      const layer = row(value, "Layer"); fields(layer, ["id", "name", "visible"], "Layer");
      return { id: id(layer.id, "Layer ID"), name: text(layer.name, "Layer name"), visible: bool(layer.visible, "Layer visibility") };
    });
    unique(result.layers.map((entry) => entry.id), "Layer IDs");
    const layerIds = new Set(result.layers.map((entry) => entry.id));
    for (const entry of result.paths) if (entry.layer && !layerIds.has(entry.layer)) throw new Error("Path references a missing layer.");
  }
  for (const key of VECTOR_FLAGS) if (item[key] !== undefined) Object.assign(result, { [key]: bool(item[key], key) });
  for (const key of ["hatchSpacingMM", "strokeWidthMM"]) if (item[key] !== undefined) Object.assign(result, { [key]: number(item[key], key, Number.MIN_VALUE, 1e6) });
  if (item.hatchAngleDeg !== undefined) result.hatchAngleDeg = number(item.hatchAngleDeg, "Hatch angle", -1e6, 1e6);
  if (item.brushLeadInMM !== undefined) result.brushLeadInMM = number(item.brushLeadInMM, "Brush lead-in", 0.1, 20);
  return result;
}

function page(value: unknown): PageTemplate | null {
  if (value === undefined || value === null) return null;
  const item = row(value, "Page template"); fields(item, ["sizeId", "landscape", "marginMM", "color"], "Page template");
  const result: PageTemplate = { sizeId: id(item.sizeId, "Page size"), landscape: bool(item.landscape, "Page orientation"), marginMM: number(item.marginMM, "Page margin", 0, 10000) };
  if (item.color !== undefined) {
    if (typeof item.color !== "string" || !/^#[0-9a-f]{6}$/i.test(item.color)) throw new Error("Page colour must be a six-digit hex colour.");
    result.color = item.color.toLowerCase();
  }
  return result;
}

export function parseCanvasLayout(raw: string): CanvasLayout {
  if (raw.length > BITMAP_LIMITS.layoutBytes || new TextEncoder().encode(raw).byteLength > BITMAP_LIMITS.layoutBytes) throw new Error("Layout exceeds the 96 MiB file limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("Not a valid TerraForge layout file."); }
  const layout = row(parsed, "Layout"); fields(layout, ["tfVersion", "savedAt", "imports", "layerGroups", "pageTemplate", "assets", "activePenId"], "Layout");
  if (layout.tfVersion !== 1 && layout.tfVersion !== 2) throw new Error("Unsupported TerraForge layout version. This app supports versions 1 and 2.");
  const assets: Record<string, ReturnType<typeof validateBitmapAsset>> = {};
  if (layout.assets !== undefined) {
    if (layout.tfVersion === 1) throw new Error("Version 1 layouts cannot contain bitmap assets.");
    const entries = row(layout.assets, "Assets");
    if (Object.keys(entries).length > 1000) throw new Error("Layout has too many bitmap assets.");
    for (const [key, value] of Object.entries(entries)) {
      const asset = validateBitmapAsset(value);
      if (asset.id !== key) throw new Error("Bitmap asset table key does not match its ID.");
      assets[key] = asset;
    }
  }
  assertBitmapAssetBudget(assets);
  if (!Array.isArray(layout.imports)) throw new Error("Layout file does not contain a valid imports array.");
  let pathCount = 0;
  const imports: CanvasItem[] = Array.from(array(layout.imports, "Imports", 10000), (value) => {
    const item = row(value, "Canvas item");
    if (item.kind === "bitmap") {
      if (layout.tfVersion === 1) throw new Error("Version 1 layouts contain vector artwork only.");
      fields(item, [...BASE_FIELDS, "assetId", "opacity"], "Bitmap item");
      const frame = base(item), assetId = id(item.assetId, "Asset reference");
      const asset = assets[assetId];
      if (!asset) throw new Error("Bitmap references a missing asset.");
      if (frame.svgWidth !== asset.widthPx || frame.svgHeight !== asset.heightPx || frame.viewBoxX !== 0 || frame.viewBoxY !== 0) throw new Error("Bitmap frame does not match its asset dimensions.");
      return { ...frame, kind: "bitmap", assetId, opacity: number(item.opacity, "Bitmap opacity", 0, 1) };
    }
    if (item.kind !== undefined && item.kind !== "vector") throw new Error("Unsupported canvas item kind.");
    const result = vector(item);
    pathCount += result.paths.length + result.paths.reduce((sum, entry) => sum + (entry.hatchLines?.length ?? 0), 0);
    if (pathCount > 200000) throw new Error("Layout contains too much vector geometry.");
    return result;
  });
  unique(imports.map((item) => item.id), "Canvas item IDs");
  const itemIds = new Set(imports.map((item) => item.id));
  const memberships = new Set<string>();
  const layerGroups: LayerGroup[] = Array.from(array(layout.layerGroups ?? [], "Layer groups", 10000), (value) => {
    const group = row(value, "Layer group"); fields(group, ["id", "name", "color", "importIds", "penProfile"], "Layer group");
    const declaredIds = Array.from(array(group.importIds, "Group members", 10000), (value) => id(value, "Group member"));
    const importIds = layout.tfVersion === 1 ? declaredIds.filter((member) => itemIds.has(member)) : declaredIds;
    unique(importIds, "Group members");
    for (const member of importIds) {
      if (!itemIds.has(member)) throw new Error("Layer group references missing artwork.");
      if (memberships.has(member)) throw new Error("Artwork cannot belong to multiple layer groups.");
      memberships.add(member);
    }
    return { id: id(group.id, "Group ID"), name: text(group.name, "Group name"), color: color(group.color), importIds,
      ...(group.penProfile === undefined ? {} : { penProfile: parsePenProfile(group.penProfile) }) };
  });
  unique(layerGroups.map((group) => group.id), "Group IDs");
  const activePenId = layout.activePenId === undefined || layout.activePenId === null ? null : id(layout.activePenId, "Active pen");
  if (activePenId && !layerGroups.some((group) => group.id === activePenId)) throw new Error("Active pen references a missing pen.");
  const savedAt = layout.savedAt === undefined && layout.tfVersion === 1 ? "1970-01-01T00:00:00.000Z" : text(layout.savedAt, "Save date", 80);
  if (!Number.isFinite(Date.parse(savedAt))) throw new Error("Layout save date is invalid.");
  return { tfVersion: 2, savedAt, imports, layerGroups, pageTemplate: page(layout.pageTemplate), assets, ...(layout.activePenId === undefined ? {} : { activePenId }) };
}

/** Saves only live-document assets; history and clipboard remain local to the app. */
export function serializeCanvasLayout(layout: CanvasLayout): string {
  const liveAssets: Record<string, BitmapAsset> = {};
  for (const item of layout.imports) if (isBitmapImport(item)) {
    const asset = layout.assets?.[item.assetId];
    if (!asset) throw new Error("A bitmap asset is missing from this document.");
    liveAssets[item.assetId] = asset;
  }
  const raw = JSON.stringify({ ...layout, tfVersion: 2, assets: liveAssets });
  const validated = parseCanvasLayout(raw);
  const output = JSON.stringify(validated);
  if (new TextEncoder().encode(output).byteLength > BITMAP_LIMITS.layoutBytes) throw new Error("Layout exceeds the file limit.");
  return output;
}
