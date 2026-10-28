/** Run the actual CMYK Circles workflow against an unpacked Windows application. */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "release/cmyk-circles-filename-fix/win-unpacked/terraForge.exe");
if (process.platform !== "win32") throw new Error("The cmyk package check currently supports Windows only.");
if (!existsSync(executable)) throw new Error(`Packaged application not found: ${executable}`);
const result = spawnSync(process.execPath, [path.join(root, "node_modules/@playwright/test/cli.js"),
  "test", "--config=tests/e2e/playwright.config.ts", "tests/e2e/cmyk-circles.spec.ts"], {
  cwd: root, env: { ...process.env, TERRAFORGE_CMYK_EXECUTABLE: executable }, stdio: "inherit", shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
