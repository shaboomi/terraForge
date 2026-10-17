import type { RendererContext } from "../../../../types";
import { bitmapRenderers } from "./registry";
import { validateRendererOutput, type ValidatedOutput } from "./validatePath";

/** A render posted to a renderer worker: which in-tree renderer, and its context. */
export interface RenderRequest {
  id: number;
  rendererId: string;
  context: RendererContext;
}

export type RenderReply =
  | { id: number; ok: true; output: ValidatedOutput }
  | { id: number; ok: false; message: string };

/**
 * Runs one in-tree render, validates it, and packages the outcome for posting
 * back. Validating here rather than after the reply keeps a full scan of what
 * can be megabytes of path data off the UI thread. Kept apart from the worker
 * entry so tests can drive exactly the code a worker runs, without a real
 * worker. Only in-tree renderers are reachable here — plugins have their own
 * sandbox.
 */
export async function handleRenderRequest({ id, rendererId, context }: RenderRequest): Promise<RenderReply> {
  const renderer = bitmapRenderers.find((entry) => entry.id === rendererId);
  if (!renderer) return { id, ok: false, message: `Unknown in-tree renderer "${rendererId}".` };
  try {
    return { id, ok: true, output: validateRendererOutput(await renderer.render(context), rendererId) };
  } catch (err) {
    return { id, ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
