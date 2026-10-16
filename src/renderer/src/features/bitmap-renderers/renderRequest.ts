import type { RendererContext, RendererOutput } from "../../../../types";
import { bitmapRenderers } from "./registry";

/** A render posted to a renderer worker: which in-tree renderer, and its context. */
export interface RenderRequest {
  id: number;
  rendererId: string;
  context: RendererContext;
}

export type RenderReply =
  | { id: number; ok: true; output: RendererOutput }
  | { id: number; ok: false; message: string };

/**
 * Runs one in-tree render and packages the outcome for posting back. Kept
 * apart from the worker entry so tests can drive exactly the code a worker
 * runs, without a real worker. Only in-tree renderers are reachable here —
 * plugins have their own sandbox.
 */
export async function handleRenderRequest({ id, rendererId, context }: RenderRequest): Promise<RenderReply> {
  const renderer = bitmapRenderers.find((entry) => entry.id === rendererId);
  if (!renderer) return { id, ok: false, message: `Unknown in-tree renderer "${rendererId}".` };
  try {
    return { id, ok: true, output: await renderer.render(context) };
  } catch (err) {
    return { id, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
