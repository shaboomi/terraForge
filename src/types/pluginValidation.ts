import type {
  PluginControl,
  PluginManifest,
  PluginParameters,
  PluginResult,
  PluginRunRequest,
} from "./index";

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
});

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
  fields(item, ["id", "name", "version", "apiVersion", "description", "category", "input", "outputs", "controls"], "Plugin metadata");
  const id = identifier(item.id);
  const name = nonempty(item.name, "Plugin name");
  const version = nonempty(item.version, "Plugin version", 80);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Plugin version must use major.minor.patch format.");
  if (item.apiVersion !== 1) throw new Error("Unsupported plugin API version; this TerraForge supports version 1.");
  const description = nonempty(item.description, "Description", 1000);
  if (item.category !== "bitmap-processor" && item.category !== "generator" && item.category !== "font-tool") throw new Error("Unsupported plugin category.");
  if (item.input !== "none" && item.input !== "bitmap" && item.input !== "vector") throw new Error("Unsupported plugin input.");
  if (!Array.isArray(item.outputs) || item.outputs.length !== 1 || item.outputs[0] !== "vector") throw new Error("This release supports vector output only.");
  let controls: PluginControl[] | undefined;
  if (item.controls !== undefined) {
    if (!Array.isArray(item.controls) || item.controls.length > PLUGIN_LIMITS.controls) throw new Error(`At most ${PLUGIN_LIMITS.controls} controls are supported.`);
    controls = Array.from(item.controls, control);
    if (new Set(controls.map((entry) => entry.key)).size !== controls.length) throw new Error("Control keys must be unique.");
  }
  return { id, name, version, apiVersion: 1, description, category: item.category, input: item.input, outputs: ["vector"], ...(controls === undefined ? {} : { controls }) };
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
  fields(item, ["runId", "pluginId", "input", "parameters"], "Plugin request");
  const runId = nonempty(item.runId, "Run ID", 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(runId)) throw new Error("Invalid run ID.");
  const input = object(item.input, "Plugin input");
  fields(input, ["kind", "page"], "Plugin input");
  if (input.kind !== "none") throw new Error("Selection-based plugins will be supported in a later stage.");
  const page = object(input.page, "Page");
  fields(page, ["widthMM", "heightMM"], "Page");
  return { runId, pluginId: identifier(item.pluginId), input: { kind: "none", page: { widthMM: dimension(page.widthMM, "Page width"), heightMM: dimension(page.heightMM, "Page height") } }, parameters: parametersObject(item.parameters) };
}

export function validatePluginResult(value: unknown): PluginResult {
  const item = object(value, "Plugin result");
  fields(item, ["width", "height", "paths", "warnings"], "Plugin result");
  const width = dimension(item.width, "Output width");
  const height = dimension(item.height, "Output height");
  if (!Array.isArray(item.paths) || item.paths.length < 1 || item.paths.length > PLUGIN_LIMITS.paths) throw new Error(`Output must contain between 1 and ${PLUGIN_LIMITS.paths} paths.`);
  let count = 0;
  const paths = Array.from(item.paths, (entry: unknown) => {
    const path = object(entry, "Path");
    fields(path, ["points", "closed", "color"], "Path");
    if (!Array.isArray(path.points) || path.points.length < 2) throw new Error("A path must contain at least two points.");
    count += path.points.length;
    if (count > PLUGIN_LIMITS.points) throw new Error(`Output exceeds ${PLUGIN_LIMITS.points} points.`);
    const points = Array.from(path.points, (entry: unknown) => {
      const point = object(entry, "Point");
      fields(point, ["x", "y"], "Point");
      const x = finite(point.x, "Point X");
      const y = finite(point.y, "Point Y");
      if (x < 0 || y < 0 || x > width || y > height) throw new Error("Output points must lie inside the declared frame.");
      return { x, y };
    });
    if (path.closed !== undefined && typeof path.closed !== "boolean") throw new Error("Path closed flag must be boolean.");
    return { points, ...(path.closed === undefined ? {} : { closed: path.closed }), ...(path.color === undefined ? {} : { color: colour(path.color, "Path colour") }) };
  });
  let warnings: string[] | undefined;
  if (item.warnings !== undefined) {
    if (!Array.isArray(item.warnings) || item.warnings.length > 20) throw new Error("At most 20 warnings are allowed.");
    warnings = Array.from(item.warnings, (entry: unknown) => string(entry, "Warning", 512));
  }
  return { width, height, paths, ...(warnings === undefined ? {} : { warnings }) };
}