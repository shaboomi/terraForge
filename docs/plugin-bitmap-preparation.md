# Shared bitmap preparation

Prepared Scanlines is a small example of host-controlled bitmap preparation. Copy [prepared-scanlines.tf-plugin.js](examples/prepared-scanlines.tf-plugin.js) into **Plugins → Open Plugin Folder**, choose **Rescan Plugins**, select one image and open **Bitmap to Vector → Prepared Scanlines**. Use its Properties controls to choose shared levels, gamma, contrast, smoothing and optional colour separation. Choose **Preview**, inspect the temporary result, then **Apply artwork**. Editing an existing result still requires **Preview → Update artwork**.

Preparation is opt-in. Existing plugins, including CMYK Circles, Spiral Sawtooth and Bitmap Tones, receive their existing original pixels and keep their own algorithms. They do not receive extra preparation controls. A plugin that already separates colours should continue using its original pixels or deliberately consume the host channels instead of separating those channels again.

## Author contract

Add `"bitmapPreparation": true` to the native `.tf-plugin.js` JSON header. This field requires `"input": "bitmap"`. No modification to an existing plugin is required. Plugins without the opt-in receive no `input.prepared` field.

`input.data` remains the original straight RGBA8 snapshot. It retains alpha, and fully transparent pixels have zero RGB under the existing bitmap contract. Preparation neither edits the source image nor changes its full pixel frame, position, rotation, margins or independent X/Y scales.

An opted-in plugin additionally receives:

```text
input.prepared = {
  version: 1,
  widthPx, heightPx,
  settings: {
    blackPoint, whitePoint, gamma, contrast, smoothing,
    separation: "none" | "cmyk" | "rgb" | "palette",
    palette: ["#rrggbb", ...]
  },
  tones: Uint8Array,
  channels: [{ id, label, color, model: "ink" | "light", data: Uint8Array }]
}
```

All planes contain exactly `widthPx × heightPx` row-major bytes. Coordinates use the original source-pixel frame, top-left origin, X right and Y down. `tones` is sRGB luminance brightness: **0 is black/ink; 255 is white/no ink**. It is not linear-light luminance. Use `255 - tones[index]` for darkness. Preparation version 1 describes this data contract, independently of native plugin `apiVersion: 1`.

| Setting | Default and accepted values |
| --- | --- |
| `blackPoint` | 0; finite 0–254 |
| `whitePoint` | 255; finite 1–255, greater than blackPoint |
| `gamma` | 1; 0.1–5; greater than 1 lightens |
| `contrast` | 1; 0–3, centred on mid-grey |
| `smoothing` | 0; integer box-filter radius 0–4 source pixels |
| `separation` | `none`; or `cmyk`, `rgb`, `palette` |
| `palette` | Empty by default; at most eight unique six-digit RGB colours; palette separation requires at least one |

The fixed processing order is **input levels → gamma → contrast → alpha-weighted smoothing → white compositing → brightness and colour separation**. Levels, gamma and contrast operate on each straight RGB component. Smoothing averages neighbouring adjusted colours with original alpha as the weight; windows shrink at the image edges. The host then composites using each pixel's original alpha. Invisible RGB cannot bleed into visible marks. Fully transparent pixels stay white in tones and zero in every colour channel. The original alpha remains available through `input.data`; prepared ink/light amounts already include it and must not be multiplied by alpha again.

Preparation settings are separate from plugin parameters and are saved with the generated result. **Edit with** restores them alongside the seed, source reference, detail capacity and ordinary plugin controls. Changing preparation invalidates its preview; changing source pixels, dimensions, settings or palette cannot reuse an old cache entry. Opening a layout displays saved geometry without executing a plugin or preparing its image.

## Colour channels and pens

`none` provides tones and an empty channel list. Every separation provides the same tones plus channels in the following explicit order:

| Mode | Channels and meaning |
| --- | --- |
| `cmyk` | Cyan, Magenta, Yellow, Black; `model: "ink"`; 0=no ink, 255=full coverage. Uses normalized subtractive CMYK with full black generation: K=1−max(R,G,B), C=(1−R−K)/(1−K), with analogous M/Y; pure black uses K only. |
| `rgb` | Red light, Green light, Blue light; `model: "light"`; 0=no primary light, 255=full primary light. These are additive intensities intended for a dark substrate, with original alpha applied once. Opaque white has three full channels. |
| `palette` | One ink channel per selected colour, in the saved palette order. Simple nearest squared-distance RGB chooses a channel; luminance darkness sets its amount. White and fully transparent pixels produce no ink. |

Channel IDs such as `cmyk-0` identify prepared data, not real pens. These simple artistic colour models are not calibrated physical ink mixing, error diffusion or the upstream ink-unmixing model. Palette separation can lose colour nuance and does not promise faithful colour reproduction.

Returning a channel's label and RGB colour preserves those attributes in normal artwork. The host does not infer a real pen from a channel colour, choose a pen changer or establish plotting order. A plugin may explicitly expose existing `pen` controls and return selected real pen IDs through the normal API. CMYK Circles keeps its own explicit real-pen assignments, different separation algorithm and Black-last plotting order.

Prepared Scanlines uses either tones or the provided channels once. Its output is ordinary coloured line artwork, with one named item per nonempty channel. It reports an error if a complete result exceeds its detail allowance; it does not silently truncate the image. It neither assigns real pens nor converts lines into taps or filled shapes.

## Cache and memory limits

Decoded PNG pixels use a separate **24 MiB** bounded cache. Prepared tones/channels use a **32 MiB** least-recently-used cache, keyed by a SHA-256 digest of actual pixel bytes, dimensions and all normalized preparation settings, including palette order. Cache results are copied before use; one plugin run cannot poison later previews. Large decoded/prepared results that exceed a cache's capacity are processed without retaining that entry. Rescan clears the caches. Content-based keys prevent stale results when switching layouts while permitting bounded reuse of identical pixels.

The total returned tones and channel byte arrays also have a **32 MiB per-run limit**, checked before their allocation and again at validation. Reduce image resolution or use fewer separation channels when that limit is exceeded. The existing source pixel/dimension and output geometry limits remain in force. Cancellation yields to the host every 64 rows while computing and never retains incomplete prepared results.

The preparation-cache budget counts retained typed-array bytes; the decoded-image budget also counts its retained encoded string as UTF-16. Small keys/settings/object overhead, original source pixels, transient RGB smoothing buffers and isolated per-run copies are additional memory. Each input pixel uses four RGBA bytes; tones add one byte; CMYK adds another four; RGB adds three; palette adds one per selected colour. Smoothing temporarily uses two three-byte RGB planes and a bounded column-sum buffer. This is a bounded memory/performance tradeoff, not zero-copy sharing with plugins.

The host transfers run-owned bitmap buffers from its sandbox host to its worker, reducing one redundant host-to-worker clone while keeping original renderer/main inputs and cache buffers private. Fresh runtime hosts are retained for every run. Runtime startup/reuse was not measured in this benchmark, so these timings do not justify weakening per-run isolation, cancellation, cleanup or stale-message rejection.

## Measurements — 29 October 2026, Windows, Node 24.21.0

Before preparation/cache implementation, representative existing distributable algorithms were measured on deterministic opaque RGB gradients. Each result below is a median of five runs after one warmup; a private RGBA structured clone is included. CMYK uses Fit complete image to detail limits with four explicit real pen IDs; Spiral uses defaults. These are CPU measurements, not full desktop Preview latency or physical plotting times.

| Existing workflow | Source | Before, ms | After, ms |
| --- | --- | ---: | ---: |
| CMYK Circles | 384 × 384 | 75.96 | 86.15 |
| Spiral Sawtooth | 384 × 384 | 39.21 | 41.72 |
| CMYK Circles | 768 × 768 | 141.09 | 145.54 |
| Spiral Sawtooth | 768 × 768 | 156.56 | 157.43 |

The algorithms were unchanged. These varying timings show no demonstrated legacy-algorithm speedup and are not presented as one.

| New shared CMYK preparation, radius 2 | Cold, ms | Cached, ms | Repeated-preparation speedup | Retained planes |
| --- | ---: | ---: | ---: | ---: |
| 384 × 384 | 16.20 | 1.45 | 11.2× | 0.703 MiB |
| 768 × 768 | 59.83 | 5.77 | 10.4× | 2.813 MiB |

Cached timings include pixel copying, SHA-256 hashing and detached result copies. Cloning original RGBA took 0.15/1.10 ms at the two resolutions; cloning RGBA plus prepared tones/channels took 1.37/4.23 ms. This measures the extra data cost of optional preparation, not Electron IPC throughput. Existing plugins incur no prepared-plane transfer. The larger benefit measured here is avoiding repeated preparation when only algorithm settings change.

Reproduce from the repository:

```powershell
node --experimental-strip-types scripts/plugin-bitmap-benchmark.mts
npx.cmd vitest run tests/unit/pluginBitmapPreparation.test.ts
```

The benchmark runs local repository-owned algorithm examples. It does not launch a desktop app or connect to a physical plotter. Results vary with system load, CPU and runtime; reruns should be interpreted as measurements on their own machine.
