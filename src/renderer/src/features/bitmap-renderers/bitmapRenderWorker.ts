/**
 * Web Worker entry for in-tree bitmap renderers — see `rendererPool.ts`.
 *
 *   IN  → RenderRequest { id, rendererId, context }
 *   OUT ← RenderReply   { id, ok: true, output } | { id, ok: false, message }
 */
import { handleRenderRequest, type RenderRequest } from "./renderRequest";

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  self.postMessage(await handleRenderRequest(event.data));
};
