import type {
  PluginControl,
  PluginManifest,
  PluginParameters,
  PluginResult,
  PluginRunRequest,
  PluginInput,
  PluginOutputItem,
  PluginPen,
  PluginPlacement,
  PluginPolyline,
  PluginDetailBudget,
} from "./index";
import { validatePreparedPluginBitmap } from "./pluginBitmapPreparation";

export const PLUGIN_LIMITS = Object.freeze({
  sourceBytes: 1024 * 1024,
  metadataBytes: 64 * 1024,
  files: 256,
  controls: 32,
  stringLength: 4096,
  paths: 10000,
  points: 100000,
  dimensionMM: 10000,
  executionMs: 30000,
  outputItems: 16,
  pixels: 16 * 1024 * 1024,
  pixelDimension: 8192,
  sourceDimension: 1e6,
  palette: 256,
});

/** Capacity is selected by the host UI, never by returned plugin geometry. */
export function pluginExecutionLimits(detailBudget?: PluginDetailBudget) {
  if (detailBudget !== undefined && detailBudget !== "standard" && detailBudget !== "extended") throw new Error("Unsupported artwork capacity.");
  const multiplier = detailBudget === "extended" ? 6 : 1;
  return Object.freeze({ paths: PLUGIN_LIMITS.paths * multiplier, points: PLUGIN_LIMITS.points * multiplier, executionMs: PLUGIN_LIMITS.executionMs * multiplier });
}

const ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const KEY = /^[a-zA-Z][a-zA-Z0-9_]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const RESERVED = new Set(["__proto__", "prototype", "constructor"]);

type UnknownRecord = Record<string, unknown>;

function object(value: unknown, label: string): UnknownRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} must be a plain object.`);
  }
  for (const key of Object.keys(value)) {
    if (RESERVED.has(key)) throw new Error(`${label} contains a reserved key.`);
  }
  return value as UnknownRecord;
}

function fields(value: UnknownRecord, allowed: string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${label}: unsupported field '${key}'.`);
  }
}

function string(value: unknown, label: string, max: number = PLUGIN_LIMITS.stringLength): string {
  if (typeof value !== "string" || value.length > max) {
    throw new Error(`${label} must be text of at most ${max} characters.`);
  }
  return value;
}

function nonempty(value: unknown, label: string, max = 120): string {
  const result = string(value, label, max);
  if (!result.trim()) throw new Error(`${label} must not be empty.`);
  return result;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function dimension(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result <= 0 || result > PLUGIN_LIMITS.dimensionMM) {
    throw new Error(`${label} must be greater than zero and at most ${PLUGIN_LIMITS.dimensionMM} mm.`);
  }
  return result;
}

function identifier(value: unknown): string {
  const result = nonempty(value, "Plugin ID", 100);
  if (!ID.test(result) || RESERVED.has(result)) throw new Error("Plugin ID must use lowercase letters, digits and internal '.', '_' or '-'.");
  return result;
}

function colour(value: unknown, label: string): string {
  const result = string(value, label, 7);
  if (!HEX.test(result)) throw new Error(`${label} must be a six-digit hexadecimal colour.`);
  return result;
}

function numericControl(item: UnknownRecord, base: { key: string; label: string }, type: "number" | "slider"): PluginControl {
  fields(item, ["key", "label", "type", "default", "min", "max", "step", "unit"], "Numeric control");
  const min = finite(item.min, "Minimum");
  const max = finite(item.max, "Maximum");
  const defaultValue = finite(item.default, "Default");
  if (min >= max || defaultValue < min || defaultValue > max) throw new Error("Numeric control bounds/default are invalid.");
  const step = item.step === undefined ? undefined : finite(item.step, "Step");
  if (step !== undefined && step <= 0) throw new Error("Step must be greater than zero.");
  const unit = item.unit === undefined ? undefined : string(item.unit, "Unit", 24);
  return { ...base, type, default: defaultValue, min, max, ...(step === undefined ? {} : { step }), ...(unit === undefined ? {} : { unit }) };
}
function control(value: unknown): PluginControl {
  const item = object(value, "Control");
  const key = nonempty(item.key, "Control key", 64);
  if (!KEY.test(key) || RESERVED.has(key)) throw new Error("Control key must be a safe identifier.");
  const label = nonempty(item.label, "Control label");
  const base = { key, label };
  switch (item.type) {
    case "number":
    case "slider":
      return numericControl(item, base, item.type);
    case "boolean":
      fields(item, ["key", "label", "type", "default"], "Checkbox");
      if (typeof item.default !== "boolean") throw new Error("Checkbox default must be boolean.");
      return { ...base, type: "boolean", default: item.default };
    case "select": {
      fields(item, ["key", "label", "type", "default", "options"], "Select control");
      if (!Array.isArray(item.options) || item.options.length < 1 || item.options.length > 64) throw new Error("Select must have between 1 and 64 options.");
      const options = Array.from(item.options, (entry: unknown) => {
        const option = object(entry, "Select option");
        fields(option, ["label", "value"], "Select option");
        return { label: nonempty(option.label, "Option label"), value: nonempty(option.value, "Option value", 256) };
      });
      const defaultValue = string(item.default, "Select default", 256);
      if (new Set(options.map((option) => option.value)).size !== options.length || !options.some((option) => option.value === defaultValue)) throw new Error("Select options must be unique and include the default.");
      return { ...base, type: "select", default: defaultValue, options };
    }
    case "pen":
      fields(item, ["key", "label", "type", "default", "suggestedColor"], "Pen control");
      return { ...base, type: "pen", default: string(item.default, "Pen default", 256),
        ...(item.suggestedColor === undefined ? {} : { suggestedColor: colour(item.suggestedColor, "Suggested colour") }) };
    case "text":
      fields(item, ["key", "label", "type", "default", "multiline"], "Text control");
      if (item.multiline !== undefined && typeof item.multiline !== "boolean") throw new Error("Multiline must be boolean.");
      return { ...base, type: "text", default: string(item.default, "Text default"), ...(item.multiline === undefined ? {} : { multiline: item.multiline }) };
    case "colour":
      fields(item, ["key", "label", "type", "default"], "Colour control");
      return { ...base, type: "colour", default: colour(item.default, "Colour default") };
    default:
      throw new Error("Unsupported control type.");
  }
}

export function validatePluginManifest(value: unknown): PluginManifest {
  const item = object(value, "Plugin metadata");
  fields(item, ["id", "name", "version", "apiVersion", "description", "category", "input", "outputs", "controls", "bitmapPreparation", "previewRequired"], "Plugin metadata");
  if (item.previewRequired !== undefined && item.previewRequired !== true) throw new Error("Preview requirement must be an explicit true opt-in.");
  if (item.bitmapPreparation !== undefined && (item.bitmapPreparation !== true || item.input !== "bitmap")) throw new Error("Shared bitmap preparation requires bitmap input and explicit true opt-in.");
  const id = identifier(item.id);
  const name = nonempty(item.name, "Plugin name");
  const version = nonempty(item.version, "Plugin version", 80);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Plugin version must use major.minor.patch format.");
  if (item.apiVersion !== 1) throw new Error("Unsupported plugin API version; this TerraForge supports version 1.");
  const description = nonempty(item.description, "Description", 1000);
  if (item.category !== "bitmap-processor" && item.category !== "generator" && item.category !== "font-tool") throw new Error("Unsupported plugin category.");
  if (item.input !== "none" && item.input !== "bitmap" && item.input !== "vector") throw new Error("Unsupported plugin input.");
  if (!Array.isArray(item.outputs) || item.outputs.length < 1 || item.outputs.length > 2 ||
      item.outputs.some((kind) => kind !== "vector" && kind !== "bitmap") ||
      new Set(item.outputs).size !== item.outputs.length) throw new Error("Outputs must declare unique vector and/or bitmap kinds.");
  let controls: PluginControl[] | undefined;
  if (item.controls !== undefined) {
    if (!Array.isArray(item.controls) || item.controls.length > PLUGIN_LIMITS.controls) throw new Error(`At most ${PLUGIN_LIMITS.controls} controls are supported.`);
    controls = Array.from(item.controls, control);
    if (new Set(controls.map((entry) => entry.key)).size !== controls.length) throw new Error("Control keys must be unique.");
  }
  return { id, name, version, apiVersion: 1, description, category: item.category, input: item.input, outputs: [...item.outputs] as PluginManifest["outputs"], ...(controls === undefined ? {} : { controls }), ...(item.bitmapPreparation === true ? { bitmapPreparation: true as const } : {}), ...(item.previewRequired === true ? { previewRequired: true as const } : {}) };
}

export function parsePluginSource(source: string): PluginManifest {
  if (source.length > PLUGIN_LIMITS.sourceBytes || new TextEncoder().encode(source).byteLength > PLUGIN_LIMITS.sourceBytes) throw new Error("Plugin file exceeds the 1 MiB limit.");
  const match = /^(?:\uFEFF)?\/\* terraforge-plugin\r?\n([\s\S]*?)\r?\n\*\/(?:\r?\n|$)/.exec(source);
  if (!match) throw new Error("Plugin must start with a /* terraforge-plugin JSON header.");
  if (new TextEncoder().encode(match[1]).byteLength > PLUGIN_LIMITS.metadataBytes) throw new Error("Plugin metadata exceeds the 64 KiB limit.");
  let parsed: unknown;
  try { parsed = JSON.parse(match[1]); } catch { throw new Error("Plugin header contains invalid JSON."); }
  return validatePluginManifest(parsed);
}

function parametersObject(value: unknown): PluginParameters {
  const item = object(value, "Parameters");
  if (Object.keys(item).length > PLUGIN_LIMITS.controls) throw new Error("Too many parameters.");
  const result: PluginParameters = {};
  for (const [key, entry] of Object.entries(item)) {
    if (!KEY.test(key) || key.length > 64) throw new Error("Invalid parameter key.");
    if (typeof entry === "number") result[key] = finite(entry, key);
    else if (typeof entry === "string") result[key] = string(entry, key);
    else if (typeof entry === "boolean") result[key] = entry;
    else throw new Error(`Parameter '${key}' must be text, a number or boolean.`);
  }
  return result;
}

export function validatePluginParameters(manifest: PluginManifest, value: unknown): PluginParameters {
  const supplied = parametersObject(value);
  const controls = manifest.controls ?? [];
  const result: PluginParameters = {};
  for (const key of Object.keys(supplied)) {
    if (!controls.some((entry) => entry.key === key)) throw new Error(`Unknown parameter '${key}'.`);
  }
  for (const entry of controls) {
    const current = Object.prototype.hasOwnProperty.call(supplied, entry.key) ? supplied[entry.key] : entry.default;
    switch (entry.type) {
      case "number":
      case "slider":
        if (typeof current !== "number" || current < entry.min || current > entry.max) throw new Error(`Parameter '${entry.label}' is outside its numeric bounds.`);
        break;
      case "boolean":
        if (typeof current !== "boolean") throw new Error(`Parameter '${entry.label}' must be boolean.`);
        break;
      case "select":
        if (typeof current !== "string" || !entry.options.some((option) => option.value === current)) throw new Error(`Parameter '${entry.label}' is not an available choice.`);
        break;
      case "pen":
        string(current, entry.label, 256);
        break;
      case "text":
        string(current, entry.label);
        break;
      case "colour":
        colour(current, entry.label);
        break;
    }
    result[entry.key] = current;
  }
  return result;
}

export function validatePluginRunRequest(value: unknown): PluginRunRequest {
  const item = object(value, "Plugin request");
  fields(item, ["runId", "pluginId", "input", "parameters", "seed", "detailBudget", "sourceFingerprint"], "Plugin request");
  if (item.sourceFingerprint !== undefined && (typeof item.sourceFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(item.sourceFingerprint))) throw new Error("Invalid plugin source fingerprint.");
  const runId = nonempty(item.runId, "Run ID", 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(runId)) throw new Error("Invalid run ID.");
  const detailBudget = item.detailBudget as PluginDetailBudget | undefined;
  const limits = pluginExecutionLimits(detailBudget);
  const supplied = object(item.input, "Plugin input");
  const page = object(supplied.page, "Page");
  fields(page, ["widthMM", "heightMM"], "Page");
  const common = {
    page: { widthMM: dimension(page.widthMM, "Page width"), heightMM: dimension(page.heightMM, "Page height") },
    ...(supplied.palette === undefined ? {} : { palette: palette(supplied.palette) }),
  };
  let input: PluginInput;
  if (supplied.kind === "none") {
    fields(supplied, ["kind", "page", "palette"], "Plugin input");
    input = { ...common, kind: "none" };
  } else {
    const allowed = ["kind", "page", "palette", "sourceId", "width", "height", "placement"];
    const frame = { width: sourceDimension(supplied.width, "Source width"), height: sourceDimension(supplied.height, "Source height") };
    const selection = { ...common, ...frame, sourceId: reference(supplied.sourceId, "Source ID"), placement: placement(supplied.placement) };
    if (supplied.kind === "bitmap") {
      fields(supplied, [...allowed, "widthPx", "heightPx", "data", "prepared"], "Bitmap input");
      const pixels = rgba(supplied, { pixels: 0 });
      if (frame.width !== pixels.widthPx || frame.height !== pixels.heightPx) throw new Error("Bitmap source frame must match its pixel dimensions.");
      input = { ...selection, kind: "bitmap", ...pixels, ...(supplied.prepared === undefined ? {} : { prepared: validatePreparedPluginBitmap(supplied.prepared, pixels.widthPx, pixels.heightPx) }) };
    } else if (supplied.kind === "vector") {
      fields(supplied, [...allowed, "paths"], "Vector input");
      input = { ...selection, kind: "vector", paths: polylines(supplied.paths, frame.width, frame.height, { paths: 0, points: 0 }, false, limits) };
    } else throw new Error("Unsupported plugin input kind.");
    validatePenReferences(input.kind === "vector" ? input.paths : [], common.palette ?? []);
  }
  const seed = item.seed === undefined ? undefined : uint32(item.seed, "Seed");
  return { runId, pluginId: identifier(item.pluginId), input, parameters: parametersObject(item.parameters), ...(seed === undefined ? {} : { seed }), ...(detailBudget === undefined ? {} : { detailBudget }), ...(item.sourceFingerprint === undefined ? {} : { sourceFingerprint: item.sourceFingerprint as string }) };
}

function reference(value: unknown, label: string): string {
  const result = nonempty(value, label, 256);
  if (RESERVED.has(result) || /[\u0000-\u001f]/.test(result)) throw new Error(`${label} is invalid.`);
  return result;
}

function uint32(value: unknown, label: string): number {
  const result = finite(value, label);
  if (!Number.isInteger(result) || result < 0 || result > 0xffffffff) throw new Error(`${label} must be an unsigned 32-bit integer.`);
  return result;
}

function sourceDimension(value: unknown, label: string): number {
  const result = finite(value, label);
  if (result <= 0 || result > PLUGIN_LIMITS.sourceDimension) throw new Error(`${label} is outside the supported source frame.`);
  return result;
}

function placement(value: unknown): PluginPlacement {
  const item = object(value, "Placement");
  fields(item, ["x", "y", "scale", "scaleX", "scaleY", "rotation"], "Placement");
  const bounded = (value: unknown, label: string) => {
    const result = finite(value, label);
    if (Math.abs(result) > 1e6) throw new Error(`${label} is outside the supported range.`);
    return result;
  };
  const scale = (value: unknown, label: string) => {
    const result = bounded(value, label);
    if (result === 0) throw new Error(`${label} must not be zero.`);
    return result;
  };
  return { x: bounded(item.x, "Placement X"), y: bounded(item.y, "Placement Y"), scale: scale(item.scale, "Scale"), rotation: bounded(item.rotation, "Rotation"),
    ...(item.scaleX === undefined ? {} : { scaleX: scale(item.scaleX, "Scale X") }), ...(item.scaleY === undefined ? {} : { scaleY: scale(item.scaleY, "Scale Y") }) };
}

function palette(value: unknown): PluginPen[] {
  if (!Array.isArray(value) || value.length > PLUGIN_LIMITS.palette) throw new Error(`Palette supports at most ${PLUGIN_LIMITS.palette} pens.`);
  const result = Array.from(value, (entry: unknown) => {
    const pen = object(entry, "Palette pen");
    fields(pen, ["id", "name", "color"], "Palette pen");
    return { id: reference(pen.id, "Pen ID"), name: nonempty(pen.name, "Pen name", 1000), color: colour(pen.color, "Pen colour") };
  });
  if (new Set(result.map((pen) => pen.id)).size !== result.length) throw new Error("Palette pen IDs must be unique.");
  return result;
}

function validatePenReferences(paths: PluginPolyline[], pens: PluginPen[]): void {
  const ids = new Set(pens.map((pen) => pen.id));
  for (const path of paths) if (path.penId !== undefined && !ids.has(path.penId)) throw new Error("Output references a pen outside the supplied palette.");
}

function rgba(item: UnknownRecord, budget: { pixels: number }): { widthPx: number; heightPx: number; data: Uint8Array } {
  const edge = (value: unknown, label: string) => {
    const result = finite(value, label);
    if (!Number.isInteger(result) || result < 1 || result > PLUGIN_LIMITS.pixelDimension) throw new Error(`${label} must be between 1 and ${PLUGIN_LIMITS.pixelDimension} pixels.`);
    return result;
  };
  const widthPx = edge(item.widthPx, "Pixel width"), heightPx = edge(item.heightPx, "Pixel height");
  budget.pixels += widthPx * heightPx;
  if (budget.pixels > PLUGIN_LIMITS.pixels) throw new Error("Plugin bitmap data exceeds the total pixel budget.");
  const data = item.data;
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray) || !(data.buffer instanceof ArrayBuffer) ||
      data.byteLength !== widthPx * heightPx * 4 || data.byteOffset !== 0 || data.byteLength !== data.buffer.byteLength) {
    throw new Error("Bitmap data must be a tightly sized, non-shared RGBA8 byte array.");
  }
  return { widthPx, heightPx, data: new Uint8Array(data) };
}

function polylines(value: unknown, width: number, height: number, budget: { paths: number; points: number }, allowEmpty = false, limits = pluginExecutionLimits()): PluginPolyline[] {
  if (!Array.isArray(value) || (value.length < 1 && !allowEmpty) || (budget.paths += value.length) > limits.paths) throw new Error(`Output must contain between 1 and ${limits.paths} paths in total.`);
  return Array.from(value, (entry: unknown) => {
    const path = object(entry, "Path");
    fields(path, ["points", "closed", "color", "penId"], "Path");
    if (!Array.isArray(path.points) || path.points.length < 2) throw new Error("A path must contain at least two points.");
    budget.points += path.points.length;
    if (budget.points > limits.points) throw new Error(`Output exceeds ${limits.points} points.`);
    const points = Array.from(path.points, (entry: unknown) => {
      const point = object(entry, "Point");
      fields(point, ["x", "y"], "Point");
      const x = finite(point.x, "Point X");
      const y = finite(point.y, "Point Y");
      if (x < 0 || y < 0 || x > width || y > height) throw new Error("Output points must lie inside the declared frame.");
      return { x, y };
    });
    if (path.closed !== undefined && typeof path.closed !== "boolean") throw new Error("Path closed flag must be boolean.");
    return { points, ...(path.closed === undefined ? {} : { closed: path.closed }), ...(path.color === undefined ? {} : { color: colour(path.color, "Path colour") }), ...(path.penId === undefined ? {} : { penId: reference(path.penId, "Pen ID") }) };
  });
}

/** Normalise the legacy generator return without altering its public shape. */
export function pluginResultItems(result: PluginResult): PluginOutputItem[] {
  return "items" in result ? result.items : [{ kind: "vector", width: result.width, height: result.height, paths: result.paths }];
}

/** Copies/bounds output before IPC; request-aware checks bind it to its source and palette. */
export function validatePluginResult(value: unknown, request?: PluginRunRequest, manifest?: PluginManifest): PluginResult {
  const item = object(value, "Plugin result");
  const budget = { paths: 0, points: 0, pixels: 0 };
  const limits = pluginExecutionLimits(request?.detailBudget);
  const frame = (output: UnknownRecord) => {
    const size = request && request.input.kind !== "none" ? sourceDimension : dimension;
    const width = size(output.width, "Output width"), height = size(output.height, "Output height");
    if (request && request.input.kind !== "none" && (width !== request.input.width || height !== request.input.height)) throw new Error("Processor output must preserve the complete source frame.");
    return { width, height };
  };
  let warnings: string[] | undefined;
  if (item.warnings !== undefined) {
    if (!Array.isArray(item.warnings) || item.warnings.length > 20) throw new Error("At most 20 warnings are allowed.");
    warnings = Array.from(item.warnings, (entry: unknown) => string(entry, "Warning", 512));
  }
  const diagnostics = warnings === undefined ? {} : { warnings };
  let result: PluginResult;
  if (item.items === undefined) {
    fields(item, ["width", "height", "paths", "warnings"], "Plugin result");
    const dimensions = frame(item);
    result = { ...dimensions, paths: polylines(item.paths, dimensions.width, dimensions.height, budget, false, limits), ...diagnostics };
  } else {
    fields(item, ["items", "warnings"], "Plugin result");
    if (!Array.isArray(item.items) || item.items.length < 1 || item.items.length > PLUGIN_LIMITS.outputItems) throw new Error(`Output must contain between 1 and ${PLUGIN_LIMITS.outputItems} items.`);
    const items: PluginOutputItem[] = Array.from(item.items, (entry: unknown) => {
      const output = object(entry, "Output item");
      const dimensions = frame(output);
      const name = output.name === undefined ? {} : { name: nonempty(output.name, "Output name") };
      if (output.kind === "vector") {
        fields(output, ["kind", "width", "height", "paths", "name", "penId", "plotOrder"], "Vector output");
        const penId = output.penId === undefined ? undefined : reference(output.penId, "Output pen ID");
        const plotOrder = output.plotOrder === undefined ? undefined : uint32(output.plotOrder, "Plot order");
        if (plotOrder !== undefined && plotOrder > 15) throw new Error("Plot order must be between 0 and 15.");
        return { ...dimensions, ...name, kind: "vector",
          ...(penId === undefined ? {} : { penId }), ...(plotOrder === undefined ? {} : { plotOrder }),
          paths: polylines(output.paths, dimensions.width, dimensions.height, budget, penId !== undefined, limits) };
      }
      if (output.kind === "bitmap") {
        fields(output, ["kind", "width", "height", "widthPx", "heightPx", "data", "name"], "Bitmap output");
        return { ...dimensions, ...name, kind: "bitmap", ...rgba(output, budget) };
      }
      throw new Error("Unsupported output item kind.");
    });
    result = { items, ...diagnostics };
  }
  for (const output of pluginResultItems(result)) {
    if (manifest && !manifest.outputs.includes(output.kind)) throw new Error(`Plugin returned undeclared ${output.kind} output.`);
    if (request && output.kind === "vector") {
      const pens = request.input.palette ?? [];
      validatePenReferences(output.paths, pens);
      if (output.penId !== undefined && !pens.some((pen) => pen.id === output.penId)) throw new Error("Output references a pen outside the supplied palette.");
      if (output.penId !== undefined && output.paths.some((path) => path.penId !== undefined && path.penId !== output.penId)) throw new Error("Output paths must use the declared output pen.");
    }
  }
  return result;
}
