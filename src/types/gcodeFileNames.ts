/** Default G-code names must survive FluidNC's byte-oriented command channel. */
export function safeGcodeFilenameBase(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 80) || "untitled";
}

/** Never strip a requested path: that could run a different existing file. */
export function assertRunnableFilePath(path: string): void {
  if (!path || /[^\x20-\x7e]|[!?~]/.test(path)) {
    throw new Error("This filename contains characters FluidNC cannot safely read in a Run command. Rename the file using letters, numbers, underscores or hyphens (for example 1-Cyan_opt.gcode), upload it again, then refresh the SD-card list.");
  }
}
