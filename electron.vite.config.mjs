import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import svgr from "vite-plugin-svgr";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// The worker ships inside the sandboxed preload, including in packaged builds.
// Transpile the TypeScript source without adding Node APIs to its runtime.
const pluginWorker = ts.transpileModule(
  readFileSync(resolve("src/plugin-runtime/worker.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText;

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          "font-worker": resolve("src/main/fonts/worker.ts"),
        },
      },
    },
  },
  preload: {
    define: { __TERRAFORGE_PLUGIN_WORKER__: JSON.stringify(pluginWorker) },
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
          "plugin-host": resolve("src/preload/plugin-host.ts"),
        },
      },
    },
  },
  renderer: { plugins: [svgr(), react(), tailwindcss()] },
});
