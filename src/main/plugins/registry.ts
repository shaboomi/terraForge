import { constants } from "fs";
import { lstat, mkdir, open, readdir, realpath, rename, rm, writeFile } from "fs/promises";
import { createHash, randomUUID } from "crypto";
import { isAbsolute, join, relative, resolve } from "path";
import type { PluginEntry, PluginManifest } from "../../types";
import { parsePluginSource, PLUGIN_LIMITS } from "../../types/pluginValidation";
import { EXAMPLE_PLUGIN_FILENAME, EXAMPLE_PLUGIN_SOURCE } from "./sample";

interface DiscoveredPlugin {
  entry: PluginEntry;
  hash?: string;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Plugin could not be read.";
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function digest(source: string): string {
  return createHash("sha256").update(source).digest("hex");
}

/** Metadata discovery never evaluates a plugin. Executable source is pinned until restart. */
export class PluginRegistry {
  readonly directory: string;
  private canonicalDirectory = "";
  private entries: DiscoveredPlugin[] = [];
  private disabled = new Set<string>();
  private pending: Promise<void> = Promise.resolve();
  private ready = false;

  constructor(directory: string) {
    this.directory = resolve(directory);
  }

  async initialise(): Promise<void> {
    this.ready = false;
    this.entries = [];
    await mkdir(this.directory, { recursive: true });
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Plugin folder must be a real directory, not a link.");
    this.canonicalDirectory = await realpath(this.directory);
    await this.loadSettings();
    await this.scan();
    this.ready = true;
  }

  list(): PluginEntry[] {
    this.assertReady();
    return structuredClone(this.entries.map(({ entry }) => entry));
  }

  setEnabled(pluginId: string, enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      this.assertReady();
      const matches = this.entries.filter(({ entry }) => entry.manifest?.id === pluginId);
      if (matches.length !== 1 || matches[0].entry.error) throw new Error("Choose one valid plugin to enable or disable.");
      if (typeof enabled !== "boolean") throw new Error("Enabled must be boolean.");
      const next = new Set(this.disabled);
      if (enabled) next.delete(pluginId); else next.add(pluginId);
      await this.saveSettings(next);
      this.disabled = next;
      matches[0].entry.enabled = enabled;
    });
  }

  async getExecutable(pluginId: string): Promise<{ manifest: PluginManifest; source: string }> {
    this.assertReady();
    const matches = this.entries.filter(({ entry }) => entry.manifest?.id === pluginId);
    if (matches.length !== 1) throw new Error("Plugin is missing or its ID is duplicated.");
    const { entry, hash } = matches[0];
    if (!entry.manifest || entry.error) throw new Error(entry.error ?? "Plugin is invalid.");
    if (!entry.enabled) throw new Error("Plugin is disabled.");
    const source = await this.readBounded(entry.filename, PLUGIN_LIMITS.sourceBytes);
    if (digest(source) !== hash) throw new Error("Plugin file changed since startup. Restart TerraForge to load it.");
    return { manifest: structuredClone(entry.manifest), source };
  }

  installExample(): Promise<void> {
    return this.enqueue(async () => {
      this.assertReady();
      await this.verifyDirectory();
      try {
        await writeFile(join(this.directory, EXAMPLE_PLUGIN_FILENAME), EXAMPLE_PLUGIN_SOURCE, { encoding: "utf8", flag: "wx", mode: 0o600 });
      } catch (error) {
        if (!hasCode(error, "EEXIST")) throw error;
      }
      // Explicit installation refreshes the list; ordinary file changes await restart.
      await this.scan();
    });
  }

  private assertReady(): void {
    if (!this.ready) throw new Error("Plugin registry is not ready.");
  }

  private enqueue(action: () => Promise<void>): Promise<void> {
    const operation = this.pending.then(action, action);
    this.pending = operation.catch(() => {});
    return operation;
  }

  private async verifyDirectory(): Promise<void> {
    const info = await lstat(this.directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(this.directory) !== this.canonicalDirectory) {
      throw new Error("Plugin folder changed or became a link. Restart TerraForge after restoring it.");
    }
  }
  private async scan(): Promise<void> {
    await this.verifyDirectory();
    const names = (await readdir(this.directory)).filter((name) => name.endsWith(".tf-plugin.js")).sort();
    if (names.length > PLUGIN_LIMITS.files) throw new Error(`Plugin folder contains more than ${PLUGIN_LIMITS.files} plugin files.`);
    const found: DiscoveredPlugin[] = [];
    for (const filename of names) {
      try {
        const source = await this.readBounded(filename, PLUGIN_LIMITS.sourceBytes);
        const manifest = parsePluginSource(source);
        found.push({ entry: { filename, manifest, enabled: !this.disabled.has(manifest.id) }, hash: digest(source) });
      } catch (error) {
        found.push({ entry: { filename, enabled: false, error: message(error) } });
      }
    }
    const counts = new Map<string, number>();
    for (const { entry } of found) if (entry.manifest) counts.set(entry.manifest.id, (counts.get(entry.manifest.id) ?? 0) + 1);
    for (const { entry } of found) {
      if (entry.manifest && counts.get(entry.manifest.id)! > 1) {
        entry.enabled = false;
        entry.error = `Duplicate plugin ID '${entry.manifest.id}'. Give each plugin a unique ID, then restart.`;
      }
    }
    this.entries = found;
  }

  private async readBounded(filename: string, limit: number): Promise<string> {
    await this.verifyDirectory();
    if (filename !== filename.split(/[\\/]/).pop() || filename === "." || filename === "..") throw new Error("Invalid plugin filename.");
    const path = join(this.directory, filename);
    const before = await lstat(path);
    if (!before.isFile() || before.isSymbolicLink()) throw new Error("Plugin must be a regular file; links are not allowed.");
    if (before.size > limit) throw new Error("Plugin file is too large.");
    const canonical = await realpath(path);
    const inside = relative(this.canonicalDirectory, canonical);
    if (inside.startsWith("..") || isAbsolute(inside)) throw new Error("Plugin file must remain inside the plugin folder.");
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > limit || opened.ino !== before.ino || opened.dev !== before.dev) throw new Error("Plugin file changed while being read.");
      const buffer = Buffer.alloc(limit + 1);
      let offset = 0;
      while (offset <= limit) {
        const { bytesRead } = await handle.read(buffer, offset, limit + 1 - offset, offset);
        if (bytesRead === 0) break;
        offset += bytesRead;
      }
      if (offset > limit) throw new Error("Plugin file is too large.");
      const after = await lstat(path);
      if (!after.isFile() || after.isSymbolicLink() || after.ino !== opened.ino || after.dev !== opened.dev) throw new Error("Plugin file changed while being read.");
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } finally {
      await handle.close();
    }
  }

  private async loadSettings(): Promise<void> {
    let source: string;
    try { source = await this.readBounded(".plugin-state.json", PLUGIN_LIMITS.metadataBytes); }
    catch (error) { if (hasCode(error, "ENOENT")) { this.disabled.clear(); return; } throw error; }
    let settings: unknown;
    try { settings = JSON.parse(source); } catch { throw new Error("Plugin settings contain invalid JSON."); }
    if (typeof settings !== "object" || settings === null || !("version" in settings) || settings.version !== 1 || !("disabled" in settings) || !Array.isArray(settings.disabled) || settings.disabled.length > PLUGIN_LIMITS.files || !settings.disabled.every((id: unknown) => typeof id === "string" && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(id) && id.length <= 100)) throw new Error("Plugin settings are invalid; restore .plugin-state.json or remove it to reset plugin preferences.");
    this.disabled = new Set(settings.disabled as string[]);
  }

  private async saveSettings(disabled: Set<string>): Promise<void> {
    await this.verifyDirectory();
    const temporary = join(this.directory, `.plugin-state-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify({ version: 1, disabled: [...disabled].sort() }, null, 2) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      await rename(temporary, join(this.directory, ".plugin-state.json"));
    } finally {
      await rm(temporary, { force: true });
    }
  }
}