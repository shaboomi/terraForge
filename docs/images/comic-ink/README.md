# Comic Ink Vectorizer examples

Rebuild offline with Node 24:

```powershell
node --experimental-strip-types scripts/comic-ink-previews.mjs
```

The script runs the actual distributed plugin with real shared preparation and Standard capacity. All conversion SVGs contain its ordinary polyline paths, `fill="none"`, and a white presentation background. No photograph is hidden under a conversion. PNGs are rasterizations of those same paths using the repository's Resvg development dependency. `statistics.json` records the exact controls, warnings, elapsed algorithm time, names and geometry counts.

| Example | Paths | Points | Notes |
| --- | ---: | ---: | --- |
| portrait-clean | 7,973 | 16,078 | Full NASA portrait, default Clean Comic |
| portrait-heavy | 5,224 | 10,622 | Same input, Heavy Ink and crosshatching; larger black masses replace fine detail |
| detail-fine | 4,652 | 9,472 | Face/fabric crop of the same portrait, Fine Hatching, crosshatching, entered spacing 5 |
| coffee-clean | 4,260 | 8,769 | Independent still-life photograph with curved rim, texture and deep shadows |
| fixture-clean | 1,760 | 3,595 | Original synthetic rectangles, transparent holes/margins, white highlight and dark mass |

Processing long edge is 160 in these runs, even though the source files can be larger. Photographs are rendered from their full input frames, except the explicitly labelled detail crop. `portrait-source.png` is the 256×256 full portrait used here, not the comic reference. `coffee-source.png` is the 288×192 full coffee image. `coffee-original.png` retains the 600×400 source used by the offline generator. `fixture-source.png` retains alpha; its blank areas and holes are transparent, while the small bar is opaque white.

`comparison.png` shows the source, Clean Comic and Heavy Ink. `portrait-separations.png` and `fixture-separations.png` show labelled individual passes. Each `*-separation-N.png` matches the corresponding item recorded in `statistics.json`; inspecting them distinguishes missing colour, shadow and artistic hatch marks from simple black overdraw. Each main `.svg` retains all generated vector paths.

Render widths are illustrative nib choices: colour 0.86 working pixels and black 0.46 working pixels, scaled back into each full source frame. Default coverage spacing is 0.85 / 0.45 working pixels respectively. Antialiasing and near-adjacent strokes can show fine gaps at screen sizes; a wider real nib overlaps more and a narrower nib leaves more paper. These are stroke renderings, not physical ink predictions or a filled-vector mode. The converted SVGs do not assign real pens.

## Photograph attribution

The portrait reuses the repository's public-domain NASA photograph of astronaut Eileen Collins. See the existing [source and attribution](../spiral-sawtooth/README.md#portrait-attribution). The full original fixture remains at `docs/images/spiral-sawtooth/portrait-source.png`.

The coffee photograph is by **Rachel Michetti**, courtesy of Pikolo Espresso Bar, released under **CC0** according to the [scikit-image dataset documentation](https://scikit-image.org/docs/stable/api/skimage.data.html#skimage.data.coffee). The retained source was downloaded from [scikit-image v0.19.3](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.19.3/skimage/data/coffee.png). It is example data only: plugin processing itself never downloads anything.

The synthetic fixture is generated procedurally by the script and is original to TerraForge. The user's comic reference was inspected for palette, silhouette, black shadow and hatch characteristics; it is not included in this folder or the distribution.
