# Spiral Sawtooth artwork examples

Rebuild these examples from the current plugin with:

```powershell
node scripts/spiral-sawtooth-previews.mjs
```

The script uses the repository's existing `@resvg/resvg-js` development dependency. The vector paths in each SVG and PNG come from the actual plugin, without a bitmap underneath them. `preview-statistics.json` records the parameters, path/point counts and assigned demonstration pen IDs. Stroke width in these illustrations is 0.62 source pixels; a real pen's physical width and the chosen canvas scale change the printed appearance.

- `portrait-examples.png` compares the source, defaults, four configured pen colours and an off-centre counterclockwise result.
- `portrait-detail.png` uses ring spacing 3, gamma 1.3 and contrast 1.2 for stronger facial detail. All portrait examples process the complete image downsampled to 384 × 384 pixels (`portrait-input.png`), keeping the defaults and four-pen result within the host's geometry budgets. The original 512 × 512 NASA fixture is retained as `portrait-source.png`.
- `diagnostics-examples.png` shows a luminance gradient, colour bands, partial alpha and a fully transparent exclusion strip. It compares connected pen-matched paths with disconnected single-colour marks.
- Individual `.svg` files retain the generated polylines for inspection; `.png` files are rendered previews.

## Portrait attribution

`portrait-source.png` is the 512 × 512 NASA photograph of astronaut Eileen Collins distributed as `skimage.data.astronaut` by scikit-image. Scikit-image identifies it as having no known copyright restrictions and released into the public domain.

- [scikit-image documentation and attribution](https://scikit-image.org/docs/stable/api/skimage.data#skimage.data.astronaut)
- [Exact fixture from scikit-image v0.19.3](https://raw.githubusercontent.com/scikit-image/scikit-image/v0.19.3/skimage/data/astronaut.png)
- [NASA Great Images original referenced by scikit-image](https://flic.kr/p/r9qvLn)

The diagnostic source image is generated procedurally by the preview script and is original to this repository.
