# Stage 3 example plugins

These self-contained JavaScript plugins demonstrate the processing API. They are original examples for TerraForge, not ports of DrawingBotV3 algorithms.

| File | Demonstrates |
| --- | --- |
| [cmyk-circles.tf-plugin.js](cmyk-circles.tf-plugin.js) | Four overlapping CMYK circle screens with real pen controls, plotted fills and K-last execution. Requires the extended engine; see the [installation and control guide](../cmyk-circles.md). |
| [spiral-sawtooth.tf-plugin.js](spiral-sawtooth.tf-plugin.js) | Tone-responsive Archimedean spiral with angular teeth, exact clipping and optional matching to real pens. See the [installation, controls and artwork previews](../spiral-sawtooth.md). |
| [bitmap-tones.tf-plugin.js](bitmap-tones.tf-plugin.js) | Greyscale/invert bitmap output, alpha preservation and parameter controls. |
| [bitmap-scanlines.tf-plugin.js](bitmap-scanlines.tf-plugin.js) | Bitmap-to-vector scanlines with threshold/spacing controls and optional matching to user-configured pens. |
| [reverse-vectors.tf-plugin.js](reverse-vectors.tf-plugin.js) | Vector input and a tool with no parameter controls. |

To install, choose **Plugins → Open Plugin Folder**, copy the desired files into that folder and restart TerraForge. Select one compatible source item, open its processor from Plugins, choose **Preview** and then **Apply artwork**. The source remains unchanged. No GitHub action or package installation is needed.

The scanline example uses simple nearest-RGB pen matching and samples horizontal rows. It is intended to prove pen assignment and alignment. It can stop at 9,500 paths with a visible warning; increase Row spacing for a complete result. A result with no qualifying dark pixels reports an error instead of adding empty artwork.

See [the Stage 3 workflow](../plugin-stage-3.md) and [the author guide](../plugin-author-guide.md) for the supported API and limits.
