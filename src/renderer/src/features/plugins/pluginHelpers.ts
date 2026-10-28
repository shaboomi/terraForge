import { v4 as uuid } from "uuid";
import type { MachineConfig, PluginControl, PluginManifest, PluginParameters, PluginVectorResult, SvgImport } from "../../../../types";
import type { CanvasState } from "../../store/canvasStore/types";
import { resolvePageBounds } from "../properties-panel/utils/pageBounds";

export function defaultParameters(manifest: PluginManifest): PluginParameters {
  return Object.fromEntries((manifest.controls ?? []).map((control) => [control.key, control.default]));
}

export function parameterError(control: PluginControl, value: string | number | boolean | undefined): string | null {
  if (control.type === "number" || control.type === "slider") {
    return typeof value !== "number" || !Number.isFinite(value) || value < control.min || value > control.max
      ? `${control.label} must be between ${control.min} and ${control.max}.` : null;
  }
  if (control.type === "boolean") return typeof value === "boolean" ? null : `${control.label} must be on or off.`;
  if (typeof value !== "string") return `${control.label} must be text.`;
  if (control.type === "select" && !control.options.some((option) => option.value === value)) return `Choose a valid ${control.label}.`;
  if (control.type === "colour" && !/^#[\da-f]{6}$/i.test(value)) return `${control.label} must be a six-digit colour.`;
  return null;
}

export function generatorPage(state: CanvasState, machine: MachineConfig | undefined) {
  const { pageW, pageH } = resolvePageBounds({ bedW: machine?.bedWidth ?? 220, bedH: machine?.bedHeight ?? 200, pageTemplate: state.pageTemplate, pageSizes: state.pageSizes });
  return { widthMM: pageW, heightMM: pageH };
}

/** The host constructs all SVG markup; plugins only supply validated coordinates. */
export function importPluginResult(result: PluginVectorResult, manifest: PluginManifest, parameters: PluginParameters, page: { widthMM: number; heightMM: number }, machine?: MachineConfig): SvgImport {
  if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || result.width <= 0 || result.height <= 0) throw new Error("The plugin returned invalid artwork dimensions.");
  if (result.width > page.widthMM || result.height > page.heightMM) throw new Error("The artwork is larger than the page. Reduce its dimensions and run the plugin again.");
  if (!result.paths.length) throw new Error("The plugin did not return any vector paths.");
  const paths = result.paths.map((path, index) => {
    if (path.points.length < 2 || path.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.y < 0 || point.x > result.width || point.y > result.height)) throw new Error("The plugin returned a path outside its artwork dimensions.");
    const d = path.points.map((point, i) => `${i ? "L" : "M"}${point.x} ${point.y}`).join(" ") + (path.closed ? " Z" : "");
    const color = path.color && /^#[\da-f]{6}$/i.test(path.color) ? path.color : "#000000";
    return { id: uuid(), d, svgSource: `<path d="${d}" fill="none" stroke="${color}" />`, visible: true, label: `Path ${index + 1}`, strokeColor: color, sourceColor: color, sourceOutlineVisible: true, outlineVisible: true, strokeEnabled: true, hasFill: false };
  });
  const origin = machine?.origin ?? "bottom-left";
  const right = origin === "bottom-right" || origin === "top-right";
  const top = origin === "top-left" || origin === "top-right";
  return { id: uuid(), name: manifest.name, paths, x: right ? (machine?.bedWidth ?? 220) - result.width : 0, y: top ? -result.height : 0, scale: 1, rotation: 0, visible: true, svgWidth: result.width, svgHeight: result.height, viewBoxX: 0, viewBoxY: 0, hatchEnabled: false, strokeEnabled: true, pluginSource: { pluginId: manifest.id, pluginVersion: manifest.version, parameters: { ...parameters } } };
}
