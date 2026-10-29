/** Stage the user-facing files. Run build + preview scripts first. */
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "release/sculptural-generators/Sculptural-Generators-1.0.0-border-update");
for (const folder of ["plugins", "previews"]) mkdirSync(path.join(target, folder), { recursive: true });
for (const slug of ["flowing-ribbons", "wave-volume", "organic-contours"]) copyFileSync(path.join(root, `docs/examples/${slug}.tf-plugin.js`), path.join(target, `plugins/${slug}.tf-plugin.js`));
for (const filename of readdirSync(path.join(root, "docs/images/sculptural-generators"))) copyFileSync(path.join(root, "docs/images/sculptural-generators", filename), path.join(target, "previews", filename));
const guide = readFileSync(path.join(root, "docs/sculptural-generators.md"), "utf8")
  .replaceAll("images/sculptural-generators/", "previews/")
  .replaceAll("sculptural-generators-verification.md", "VERIFICATION.md");
writeFileSync(path.join(target, "CONTROL-GUIDE.md"), guide);
copyFileSync(path.join(root, "docs/sculptural-generators-verification.md"), path.join(target, "VERIFICATION.md"));
copyFileSync(path.join(root, "LICENSE"), path.join(target, "LICENSE"));
copyFileSync(path.join(root, "docs/sculptural-generators-start-here.txt"), path.join(target, "START-HERE.txt"));
process.stdout.write(target + "\n");
