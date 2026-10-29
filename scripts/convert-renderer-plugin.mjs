#!/usr/bin/env node
/** Offline, metadata-only conversion for a bounded upstream generator subset.
 * No plugin code is executed by this tool. See docs/renderer-plugin-conversion.md.
 */
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { convertedGeneratorRuntime } from "./lib/renderer-generator-runtime.mjs";

const MAX_BYTES = 2 * 1024 * 1024;
const fail = message => { throw new Error(`Renderer conversion: ${message}`); };
function fields(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${label} field '${key}' is unsupported.`);
}
function text(value, label, max = 120) {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${label} must contain 1–${max} characters.`);
  return value;
}
function finite(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`${label} must be finite.`);
  return value;
}
function convertManifest(raw) {
  fields(raw, ["id", "label", "apiVersion", "entry", "source", "renderTimeoutMs", "inkOffset", "defaults", "fields"], "manifest");
  const id = text(raw.id, "id", 90);
  if (!/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id) || !id.includes(".")) fail("id must be a namespaced lowercase TerraForge identifier.");
  if (raw.apiVersion !== 1) fail("only upstream renderer apiVersion 1 is supported.");
  if (raw.source !== "none") fail("only source:none generators are supported; bitmap/optional sources, prepared tones and ink contexts need a separate adapter.");
  if (raw.inkOffset !== undefined && raw.inkOffset !== false) fail("inkOffset is unsupported for this generator subset.");
  if (raw.renderTimeoutMs !== undefined && (finite(raw.renderTimeoutMs, "renderTimeoutMs") <= 0)) fail("renderTimeoutMs must be positive.");
  text(raw.entry, "entry", 256);
  if (isAbsolute(raw.entry) || /[\\\0:?#]/.test(raw.entry) || raw.entry.split("/").some(p => !p || p === "." || p === "..") || !raw.entry.endsWith(".js")) fail("entry must be a canonical relative .js path inside the plugin folder.");
  fields(raw.defaults, Object.keys(raw.defaults ?? {}), "defaults");
  if (!Array.isArray(raw.fields) || raw.fields.length > 32) fail("at most 32 fields are supported.");
  const seen = new Set();
  const controls = raw.fields.map(field => {
    fields(field, ["type", "key", "label", "min", "max", "step", "control", "options"], "field");
    const key = text(field.key, "field key", 64), label = text(field.label, "field label");
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || ["constructor", "prototype", "__proto__"].includes(key) || seen.has(key)) fail("field keys must be unique safe identifiers.");
    seen.add(key);
    if (!Object.hasOwn(raw.defaults, key)) fail(`missing default for '${key}'.`);
    const value = raw.defaults[key];
    if (field.type === "number") {
      const min = finite(field.min, "minimum"), max = finite(field.max, "maximum"), step = finite(field.step, "step");
      if (min >= max || step <= 0 || finite(value, "default") < min || value > max) fail("numeric bounds/default/step are invalid.");
      if (field.control !== undefined && !["input", "slider"].includes(field.control)) fail("only input/slider numeric controls are supported.");
      if (field.options !== undefined) fail("numeric fields cannot have options.");
      return { key, label, type: field.control === "slider" ? "slider" : "number", min, max, step, default: value };
    }
    if (field.type === "boolean") {
      if (typeof value !== "boolean" || Object.keys(field).some(k => !["type", "key", "label"].includes(k))) fail("boolean fields support only key/label and a boolean default.");
      return { key, label, type: "boolean", default: value };
    }
    if (field.type === "select") {
      if (Object.keys(field).some(k => !["type", "key", "label", "options", "control"].includes(k)) || field.control !== undefined && field.control !== "dropdown") fail("only dropdown select controls are supported.");
      if (!Array.isArray(field.options) || !field.options.length || field.options.length > 64) fail("select requires 1–64 options.");
      const options = field.options.map(option => { fields(option, ["value", "label"], "option"); return { value: text(option.value, "option value", 256), label: text(option.label, "option label") }; });
      if (new Set(options.map(o => o.value)).size !== options.length || !options.some(o => o.value === value)) fail("select options/default are invalid.");
      return { key, label, type: "select", options, default: value };
    }
    fail(`field type '${field.type}' is unsupported.`);
  });
  if (Object.keys(raw.defaults).some(key => !seen.has(key))) fail("undeclared defaults are unsupported; declare every setting as a field.");
  return { id: `converted.${id}`, name: text(raw.label, "label"), version: "1.0.0", apiVersion: 1,
    description: "Offline-converted upstream generator; see renderer-plugin-conversion.md for its bounded contract.",
    category: "generator", input: "none", outputs: ["vector"], controls, previewRequired: true };
}

export async function convertRendererPlugin(folder) {
  const root = resolve(folder);
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) fail("plugin folder must be a real directory, not a link.");
  const realRoot = await realpath(root);
  const modules = new Map();
  let totalBytes = 0, files = 0, directories = 0;
  const inside = value => value === realRoot || value.startsWith(realRoot + sep);
  async function read(path) {
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || !inside(await realpath(path))) fail("plugin files must be regular files confined to the folder.");
    if (++files > 64 || before.size > MAX_BYTES || totalBytes + before.size > MAX_BYTES) fail("source exceeds 64 files or 2 MiB.");
    const handle = await open(path, "r");
    try {
      const current = await handle.stat();
      if (!current.isFile() || current.size !== before.size || current.ino !== before.ino || current.dev !== before.dev || !inside(await realpath(path))) fail("source changed while being read; retry conversion.");
      const bytes = Buffer.alloc(current.size + 1);
      let count = 0;
      while (count < bytes.length) { const chunk = await handle.read(bytes, count, bytes.length - count, count); if (!chunk.bytesRead) break; count += chunk.bytesRead; }
      const after = await handle.stat();
      if (count !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || !inside(await realpath(path))) fail("source changed while being read; retry conversion.");
      totalBytes += count;
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, count));
    } finally { await handle.close(); }
  }
  async function walk(directory, depth) {
    if (depth > 6 || ++directories > 256) fail("source exceeds six directory levels or 256 directories.");
    if ((await lstat(directory)).isSymbolicLink() || !inside(await realpath(directory))) fail("linked directories are unsupported.");
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 1024) fail("directory contains too many entries.");
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (entry.isSymbolicLink()) fail("symbolic links and directory junctions are unsupported.");
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name)) modules.set(relative(root, path).split(sep).join("/"), await read(path));
      else if (entry.isFile() && /^(?:LICENSE|COPYING)(?:\.[a-z]+)?$/i.test(entry.name)) modules.set(relative(root, path).split(sep).join("/"), await read(path));
    }
  }
  await walk(root, 0);
  const manifestSource = modules.get("manifest.json");
  if (!manifestSource || Buffer.byteLength(manifestSource) > 64 * 1024) fail("manifest.json is missing or exceeds 64 KiB.");
  const raw = JSON.parse(manifestSource), manifest = convertManifest(raw);
  if (!modules.has(raw.entry)) fail("entry module was not found inside the plugin folder.");
  const factories = [];
  const notices = [];
  for (const [path, source] of modules) {
    if (/^(?:.*\/)?(?:LICENSE|COPYING)(?:\.[a-z]+)?$/i.test(path)) { notices.push(`${path}\n${source}`); continue; }
    let body = source;
    if (path.endsWith(".json")) body = `module.exports = JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(source)))});`;
    // Syntax compilation only. The Script is never run in this process.
    // The generated plugin is an ES module, so its bundled factories inherit strict mode.
    new Script(`"use strict";\n(function(module,exports,require){\n${body}\n})`, { filename: path });
    factories.push(`[${JSON.stringify(path)}, function(module,exports,require){\n${body}\n}]`);
  }
  const metadata = JSON.stringify(manifest, null, 2).replace(/\*/g, "\\u002a");
  if (Buffer.byteLength(metadata) > 64 * 1024) fail("converted plugin metadata exceeds the host's 64 KiB limit.");
  const provenance = JSON.stringify({ format: "upstream-renderer-generator-subset-v1", upstreamId: raw.id,
    originalManifest: raw, notices, context: "page millimetres; scale=1; no source/ink; host deadlines and capacity" });
  const source = `/* terraforge-plugin\n${metadata}\n*/\n// Offline conversion metadata and retained licence notices (data only).\nconst conversion = ${provenance};\nvoid conversion;\nconst adapter = ${convertedGeneratorRuntime.toString()};\nexport default async function run(input,parameters,context){\nconst factories = new Map([\n${factories.join(",\n")}\n]);\nreturn adapter(factories,${JSON.stringify(raw.entry)},input,parameters,context);\n}\n`;
  if (Buffer.byteLength(source) > 1024 * 1024) fail("converted single-file plugin exceeds the host's 1 MiB limit.");
  // Compile the exact generated wrapper too; parsing a helper alone does not prove that
  // its delimiters and comments can be embedded in the final strict module unchanged.
  new Script(`"use strict";\n${source.replace(/^export default async function run/m, "async function run")}`, { filename: "converted.tf-plugin.js" });
  return { source, manifest, files: modules.size, warnings: raw.renderTimeoutMs === undefined ? [] : ["Upstream renderTimeoutMs is recorded for provenance; execution uses the host's Standard/Extended deadline."] };
}

async function main() {
  try {
    const [, , folder, output, ...extra] = process.argv;
    if (!folder || !output || extra.length || !output.endsWith(".tf-plugin.js")) fail("usage: node scripts/convert-renderer-plugin.mjs <folder> <new-output.tf-plugin.js>");
    const result = await convertRendererPlugin(folder);
    // Never overwrite an existing plugin or write into the source folder.
    const target = resolve(output), sourceFolder = await realpath(folder), targetParent = await realpath(dirname(target));
    if (targetParent === sourceFolder || targetParent.startsWith(sourceFolder + sep)) fail("choose an output outside the source plugin folder.");
    await writeFile(target, result.source, { encoding: "utf8", flag: "wx" });
    process.stdout.write(`Created ${target}\n${result.warnings.join("\n")}\nInstall through Plugins → Open Plugin Folder, then Rescan plugins. Review and run it only in TerraForge's restricted host.\n`);
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();
