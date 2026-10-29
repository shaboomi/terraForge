# Dancing Script regression fixtures

`DancingScript.ttf` is an unmodified Dancing Script variable font used to reproduce smooth-curve and crossing-stroke issues in F/a/c/s. The font is copyright 2016 The Dancing Script Project Authors, distributed under the SIL Open Font License; see `DancingScript-OFL.txt`.

Upstream: https://github.com/google/fonts/tree/main/ofl/dancingscript

`DancingScript-legacy-strokes.json` retains only the F/a/c/s vector traces produced by the earlier Terra Forge centreline converter. Its test identity is changed and its source link removed to verify smoothing when the original outline library entry is unavailable. It contains font geometry only, with no canvas artwork or machine settings.
