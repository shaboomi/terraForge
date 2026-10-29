import { parentPort, workerData } from "node:worker_threads";
import { processFont, type FontIdentity } from "../../fonts/processor";

try {
  const { bytes,identity } = workerData as { bytes: Uint8Array; identity: FontIdentity };
  const buffer = bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) as ArrayBuffer;
  parentPort?.postMessage({ font:processFont(buffer,identity) });
} catch (error) {
  parentPort?.postMessage({ error:error instanceof Error ? error.message : "Font processing failed." });
}
