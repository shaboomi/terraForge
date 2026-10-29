import { parentPort, workerData } from "node:worker_threads";
import { convertOutlineFont, processFont, smoothProcessedFont, type FontIdentity } from "../../fonts/processor";

try {
  const data = workerData as { bytes: Uint8Array; identity: FontIdentity } | { font: import("../../types/fonts").ProcessedFont; identity: FontIdentity; smooth?: boolean };
  if ("font" in data) parentPort?.postMessage({ font: data.smooth ? smoothProcessedFont(data.font) : convertOutlineFont(data.font, data.identity) });
  else {
    const buffer = data.bytes.buffer.slice(data.bytes.byteOffset,data.bytes.byteOffset+data.bytes.byteLength) as ArrayBuffer;
    parentPort?.postMessage({ font:processFont(buffer,data.identity) });
  }
} catch (error) {
  parentPort?.postMessage({ error:error instanceof Error ? error.message : "Font processing failed." });
}
