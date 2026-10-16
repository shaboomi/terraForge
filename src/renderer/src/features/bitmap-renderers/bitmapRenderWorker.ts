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

// Dev-only, and never true inside a worker at runtime: marks this module as
// accepting its own updates, so editing a renderer (imported here through
// the registry) does not leave Vite with an unaccepted chain and a full page
// reload. Running workers are restarted on the new code by `rendererPool`.
import.meta.hot?.accept();
