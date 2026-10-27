import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { readBoundedFile } from "../../../src/main/files/boundedFile";

describe("bounded file reads", () => {
  let directory: string;
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "terraforge-bounded-")); });
  afterEach(async () => {
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !target.split(/[\\/]/).pop()?.startsWith("terraforge-bounded-")) throw new Error("Invalid cleanup target");
    await rm(target, { recursive: true, force: true });
  });
  it("returns exact binary bytes without text conversion", async () => {
    const file = join(directory, "image.png");
    await writeFile(file, Buffer.from([137, 80, 0, 255]));
    expect(await readBoundedFile(file, 4, "Image")).toEqual(Buffer.from([137, 80, 0, 255]));
  });
  it("rejects an oversized source before reading it", async () => {
    const file = join(directory, "large.png");
    await writeFile(file, Buffer.alloc(5));
    await expect(readBoundedFile(file, 4, "Image")).rejects.toThrow(/file limit/);
  });
  it("rejects empty files and directories", async () => {
    const file = join(directory, "empty.png");
    await writeFile(file, "");
    await expect(readBoundedFile(file, 4, "Image")).rejects.toThrow(/empty/);
    await expect(readBoundedFile(directory, 4, "Image")).rejects.toThrow(/regular file/);
  });
  it("rejects invalid paths and closes handles after errors", async () => {
    await expect(readBoundedFile(null, 4, "Image")).rejects.toThrow(/valid file/);
    const file = join(directory, "large.png");
    await writeFile(file, Buffer.alloc(5));
    await expect(readBoundedFile(file, 4, "Image")).rejects.toThrow();
    await rm(file);
  });
});
