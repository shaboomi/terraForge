# Generated CMYK Circles artwork

Rebuild with `node scripts/cmyk-circles-previews.mjs` from the repository root. This executes `docs/examples/cmyk-circles.tf-plugin.js` itself. The SVGs contain its actual polyline toolpaths, without a source bitmap underneath. Individual C/M/Y/K PNGs show each layer.

- `*-rgb.png`: normal RGB coloured-path overdraw, like a conventional screen preview.
- `*-ideal-ink.png`: an explicitly illustrative transparent-ink model. Each generated layer is rasterized as an alpha mask; ideal cyan reduces red transmittance, magenta reduces green, yellow reduces blue, and K reduces all three. These transmittances multiply over white. This is not colour calibration or a prediction of physical pen/paper behaviour.
- Photographic fill spacing is 2.5 source pixels, diagnostic spacing is 1.5. Illustrated stroke width is 95% of fill spacing. Real nib width and page scale can look substantially different.
- `diagnostics` has W/K/C/M/Y/R/G/B bands, a grey gradient, a partial-alpha colour strip, and a fully transparent vertical slit. `diagnostics-outline` uses perimeter paths only; `diagnostics-equal-size` uses equal-size, population-screened circles.
- `statistics.json` records exact settings, point/path counts, pen IDs and execution ranks. All files contain complete results within the host's budget; no layer is truncated.

`photograph-source.png` is a 384×384 full-frame resize of the repository's existing 512×512 NASA photograph of astronaut Eileen Collins. The existing [source and attribution](../spiral-sawtooth/README.md#portrait-attribution) are unchanged. Procedural diagnostic images are original to TerraForge.

`desktop-preview.png` and `desktop-reopened.png`, when present, are screenshots of the packaged Windows test workflow. They display the actual application, including its original bitmap reference and temporary/applied path display. No plotter was operated.
