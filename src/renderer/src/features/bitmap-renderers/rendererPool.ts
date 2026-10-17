import type { RendererContext } from "../../../../types";
import { bitmapRenderers } from "./registry";
import { handleRenderRequest, type RenderReply, type RenderRequest } from "./renderRequest";
import type { BitmapRendererDefinition } from "./types";
import { validateRendererOutput, type ValidatedOutput } from "./validatePath";

/**
 * Runs in-tree renderers off the main thread. A large spiral or fine ring
 * render takes long enough to freeze the UI outright when run inline; in a
 * worker the app stays responsive, a colour separation's channels render in
 * parallel, and a render that has been superseded can be stopped rather than
 * left to finish — its worker is terminated and replaced.
 *
 * Where workers do not exist (the test environment), renders run inline
 * instead, with the same result.
 */

interface Task {
  request: RenderRequest;
  resolve: (output: ValidatedOutput) => void;
  reject: (err: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface Slot {
  worker: Worker;
  task: Task | null;
}

/** Leaves a core for the UI; more than four buys little for at most four inks. */
const POOL_SIZE = Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency || 2) - 1));

let slots: Slot[] | null = null;
const queue: Task[] = [];
let nextId = 0;

function abortError(): DOMException {
  return new DOMException("Render cancelled.", "AbortError");
}

function spawn(slot?: Slot): Slot {
  const worker = new Worker(new URL("./bitmapRenderWorker.ts", import.meta.url), { type: "module" });
  const target: Slot = slot ?? { worker, task: null };
  target.worker = worker;
  worker.onmessage = (event: MessageEvent<RenderReply>) => {
    const task = target.task;
    if (!task || task.request.id !== event.data.id) return;
    finish(target);
    if (event.data.ok) task.resolve(event.data.output);
    else task.reject(new Error(event.data.message));
  };
  // An error escaping the handler means the worker itself broke: fail its
  // task and start over with a fresh one.
  worker.onerror = (event) => {
    const task = target.task;
    event.preventDefault();
    replace(target);
    task?.reject(new Error(event.message || "Renderer worker failed."));
  };
  return target;
}

function pool(): Slot[] {
  slots ??= Array.from({ length: POOL_SIZE }, () => spawn());
  return slots;
}

/** Clears a slot's task and starts the next queued one. */
function finish(slot: Slot): void {
  const task = slot.task;
  if (task?.onAbort) task.signal?.removeEventListener("abort", task.onAbort);
  slot.task = null;
  dispatch();
}

function replace(slot: Slot): void {
  slot.worker.terminate();
  spawn(slot);
  finish(slot);
}

function dispatch(): void {
  for (const slot of pool()) {
    if (slot.task || queue.length === 0) continue;
    const task = queue.shift()!;
    slot.task = task;
    slot.worker.postMessage(task.request);
  }
}

/**
 * Renders with an in-tree renderer, in a worker when available, returning
 * its validated output. Aborting
 * `signal` rejects with an `AbortError` and, if the render is already
 * running, terminates its worker so the work actually stops.
 */
export function runInTreeRenderer(
  renderer: BitmapRendererDefinition,
  context: RendererContext,
  signal?: AbortSignal,
): Promise<ValidatedOutput> {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === "undefined") {
    return handleRenderRequest({ id: 0, rendererId: renderer.id, context }).then((reply) => {
      if (!reply.ok) throw new Error(reply.message);
      return reply.output;
    });
  }

  return new Promise<ValidatedOutput>((resolve, reject) => {
    const task: Task = { request: { id: nextId++, rendererId: renderer.id, context }, resolve, reject, signal };
    if (signal) {
      task.onAbort = () => {
        const queued = queue.indexOf(task);
        if (queued !== -1) queue.splice(queued, 1);
        const running = pool().find((slot) => slot.task === task);
        if (running) replace(running);
        reject(abortError());
      };
      signal.addEventListener("abort", task.onAbort, { once: true });
    }
    queue.push(task);
    dispatch();
  });
}

/**
 * Runs any renderer and returns its validated output: in-tree ones in the
 * worker pool (validated there, off the UI thread), plugins directly (a
 * plugin already runs in its own sandbox process). A plugin render cannot be
 * stopped mid-flight, but once `signal` is aborted its result is refused all
 * the same, so a superseded render never reaches the document.
 */
export async function runRenderer(
  renderer: BitmapRendererDefinition,
  context: RendererContext,
  signal?: AbortSignal,
): Promise<ValidatedOutput> {
  if (bitmapRenderers.includes(renderer)) return runInTreeRenderer(renderer, context, signal);
  const output = await renderer.render(context);
  if (signal?.aborted) throw abortError();
  return validateRendererOutput(output, renderer.id);
}

/** Terminates every worker and forgets queued work. For tests. */
export function resetRendererPool(): void {
  slots?.forEach((slot) => slot.worker.terminate());
  slots = null;
  queue.length = 0;
}

// Dev-only: accept hot updates here — this module's own, or any in-tree
// renderer's, which arrive through the registry import — by stopping the
// previous version's workers; the replacement module starts fresh ones, on the
// new renderer code, at its next render.
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => resetRendererPool());
}
