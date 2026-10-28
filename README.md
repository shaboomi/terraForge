# terraForge

Desktop control app for FluidNC-based pen plotters (TerraPen and compatible machines).

Import SVG and PDF artwork, place PNG/JPEG references on the canvas, or create vectors with local JavaScript generators. Arrange your artwork, generate optimised G-code from vectors, and plot without leaving the app.

![Application screenshot](docs/resources/terraForge-quick-demo.gif)

---

## Documentation

- [User Guide](docs/terraForge-user-guide.md) — full feature walkthrough with screenshots
- [Spec](docs/terraForge-spec.md) — architecture and IPC API reference
- [Feature Status](docs/terraForge-features.md) — implemented / in-progress / planned
- [Plugin processing Stage 3](docs/plugin-stage-3.md) — preview bitmap/vector processors and generate artwork with your pens
- [Spiral Sawtooth](docs/spiral-sawtooth.md) — install a bitmap-to-vector spiral plugin, with controls and actual artwork previews
- [Bitmap Stage 2](docs/plugin-stage-2.md) — image import, editing and portable layouts
- [Plugin Stage 1](docs/plugin-stage-1.md) — supported features and a quick start
- [Plugin Author Guide](docs/plugin-author-guide.md) — write a single-file JavaScript generator or processor

---

## Features

### File Import

- **SVG** — full shape support (`path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`), physical unit detection (`mm`, `cm`, `in`, `pt`, `pc`, `px`), `transform` attribute resolution (including Inkscape layer matrices), and **sub-layer detection** — Inkscape-style `<g>` layers are imported as collapsible sub-layers in the Properties panel, preserving the original SVG visibility state with per-layer toggle controls
- **PDF** — vector path extraction from all pages; physical scale preserved (`25.4 ÷ 72 mm/pt`)
- **G-code** — import local `.gcode`/`.nc`/`.g` files for canvas preview and direct plotting

### Canvas

- Bed grid with 10 mm / 50 mm gridlines, origin marker, and rulers
- Move, scale (8-handle bounding box), and rotate imports; aspect-ratio lock
- Fit-to-bed and 1:1 scale shortcuts
- Zoom (scroll wheel, keyboard), pan (Space+drag, middle-mouse), fit-to-view
- Multi-select (Ctrl+A), undo/redo (50 steps), copy/paste
- Live plot progress overlay — completed cuts in red, rapids in orange
- Pen position crosshair tracking work coordinates in real time

### Bitmap Images — Stage 2

- Import PNG and JPEG images with transparency and JPEG orientation preserved.
- Move, resize, rotate, copy, hide and group bitmap items; adjust opacity and use Undo.
- Save portable version-2 `.tforge` layouts with embedded, deduplicated image assets; open existing version-1 vector layouts.
- Bitmaps are reference artwork. Plotting uses vector items; Stage 3 processors can generate separate vectors from bitmap input.

See [Stage 2](docs/plugin-stage-2.md) for instructions and supported limits.

### Local Plugins — Stage 1

- Save a self-contained `.tf-plugin.js` file in the folder opened by **Plugins → Open Plugin Folder**, then restart TerraForge to discover it without executing its code.
- Browse Bitmap Processors, Generators and Font Tools; enable/disable plugins and view per-file errors.
- Run generators with optional controls beneath **Properties**, including on an empty canvas. **Add Example Generator** installs a working grid example.
- Minimise or close plugin controls without deleting artwork; select a generated item and use **Edit with [plugin name]** to restore saved settings and **Update artwork** in place. Updates preserve placement and support Undo.
- Isolated execution with progress, cancellation and a default 30-second deadline. Validated polyline results become ordinary vector artwork in one undoable edit and remain usable in saved layouts without the plugin.

Stage 1 generators remain compatible. Font Tools supplies a category for plugins that generate their own vector geometry; font loading and shaping remain future work. See [Stage 1](docs/plugin-stage-1.md) and [the author guide](docs/plugin-author-guide.md).

### Plugin Processing — Stage 3

- Process one selected bitmap or vector with local JavaScript plugins.
- Preview temporary artwork, then Apply the complete result in one undoable edit. The source stays unchanged.
- Generate separate bitmap/vector results with the source's full frame and placement, including rotation and independent X/Y scaling.
- Supply the user's configured pen palette to plugins, keeping multi-colour vector output assigned to those pens.
- Reopen saved processor settings from Properties and update a named result group together.
- Try the original greyscale/invert, pen-matched scanline and reverse-vector [example plugins](docs/examples/README.md).

See [Stage 3](docs/plugin-stage-3.md) for installation, verification and the boundary before detailed artistic filters.

### G-code Generation

- Runs in a Web Worker — UI never blocks
- Full path command support with Bézier and arc flattening
- **Nearest-neighbour path optimisation** — minimises total rapid travel
- **Path joining** (experimental) — merges near-touching strokes within a configurable tolerance
- Per-layer G-code output for multi-pen / multi-colour workflows
- Upload directly to machine SD card after generation, save to disk, or both
- Generation preferences persisted in `localStorage`

### Machine Connection

- **Wi-Fi** (WebSocket + HTTP REST to FluidNC)
- **USB serial** (115200 baud)
- Auto-reconnect with exponential back-off (3 s → 60 s cap)
- Real-time status: machine state, work position, firmware version
- Multiple named machine configuration profiles with import/export

### File Browser

- Browse FluidNC internal flash and SD card
- Upload, download, delete, run, and G-code-preview files
- Click a row to queue it as the next job

### Job Control

- Start, pause, resume, and abort jobs
- Progress bar with line number and percentage
- Local files auto-uploaded to SD before running

### Jog Controls

- Floating, draggable jog panel
- X/Y/Z axes, configurable step (0.1 / 1 / 10 / 100 mm) and feedrate
- Go-to-origin, homing (`$H`), and set-zero (`G10 L20 P1`)

### Other

- Console with real-time FluidNC output, command input, alarm clear (`$X`), and firmware restart
- Background task toasts (progress, cancel, errors)
- Layer groups for multi-pen workflows
- Page template overlays (A2–A6, Letter, Legal, Tabloid) with margin and page-clip support
- Save/open/close `.tforge` layout files
- Dark and light themes

---

## Requirements

- **Node.js** ≥ 24
- A built FluidNC controller reachable over Wi-Fi or USB

---

## Development

```sh
npm install
npm run dev          # Electron dev server with hot reload
npm run build        # Production build → out/
npm test             # Vitest unit + component tests
npm run test:e2e     # Playwright E2E (builds first)
npm run typecheck    # TypeScript strict check for renderer, workers, and main process
```

### Distributable packages

```sh
npm run dist:win     # Windows
npm run dist:mac     # macOS arm64 + x64
npm run dist:mac:arm64
npm run dist:mac:x64
npm run dist:linux   # Linux
npm run dist:all     # All three platforms
```

---

## Tech Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Shell         | Electron 40                  |
| UI            | React 19, TailwindCSS 4      |
| Build         | electron-vite 5, Vite 7      |
| State         | Zustand + Immer              |
| G-code engine | Web Worker (TypeScript)      |
| Machine comms | WebSocket (`ws`), SerialPort |
| PDF import    | pdfjs-dist                   |
| Tests         | Vitest, Playwright           |

---

## License

MIT
