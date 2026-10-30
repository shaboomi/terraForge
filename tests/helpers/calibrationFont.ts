import { Font, Glyph, Path } from "opentype.js";
import type { CalibrationFontData } from "../../src/types";
import { parseCalibrationFont } from "../../src/renderer/src/features/calibration/calibrationText";

/** Small deterministic font for layout tests; app checks use the real installed font. */
const glyphs = [new Glyph({ name: ".notdef", advanceWidth: 600, path: new Path() })];
for (let code = 32; code < 127; code++) {
  const path = new Path();
  if (code !== 32) {
    path.moveTo(50, 0); path.lineTo(500, 0); path.lineTo(500, 500);
    path.quadraticCurveTo(500, 800, 50, 700); path.close();
  }
  glyphs.push(new Glyph({ name: `uni${code.toString(16)}`, unicode: code, advanceWidth: 600, path }));
}
const font = new Font({ familyName: "Test Sans", styleName: "Regular", unitsPerEm: 1000, ascender: 800, descender: -200, glyphs });
export const calibrationFontData: CalibrationFontData = { family: "Test Sans", bytes: new Uint8Array(font.toArrayBuffer()) };
export const calibrationFont = parseCalibrationFont(calibrationFontData);
