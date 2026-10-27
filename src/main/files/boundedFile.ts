import { open } from "node:fs/promises";

/** Bound allocation before reading; reject growing/changed files rather than truncating. */
export async function readBoundedFile(filePath: unknown, maxBytes: number, label: string): Promise<Buffer> {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 32768) {
    throw new Error("Choose a valid file.");
  }
  const handle = await open(filePath, "r");
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new Error("Choose a regular file.");
    if (before.size <= 0) throw new Error(`${label} is empty.`);
    if (before.size > maxBytes) throw new Error(`${label} exceeds the ${Math.floor(maxBytes / 1024 / 1024)} MiB file limit.`);
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const chunk = await handle.read(bytes, length, bytes.length - length, length);
      if (!chunk.bytesRead) break;
      length += chunk.bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error(`${label} changed while it was being read. Try importing it again.`);
    }
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}
