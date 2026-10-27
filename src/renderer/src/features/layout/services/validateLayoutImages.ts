import type { CanvasLayout } from "../../../../../types";

/** Decode sequentially before replacing the document; structural PNG checks run first. */
export async function validateCanvasLayoutImages(layout: CanvasLayout): Promise<void> {
  for (const asset of Object.values(layout.assets ?? {})) {
    const binary = atob(asset.data);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    let image: ImageBitmap;
    try {
      image = await createImageBitmap(new Blob([bytes.buffer], { type: "image/png" }));
    } catch {
      throw new Error("Layout contains a damaged PNG image and could not be opened.");
    }
    try {
      if (image.width !== asset.widthPx || image.height !== asset.heightPx) {
        throw new Error("Decoded layout image dimensions do not match the saved asset.");
      }
    } finally {
      image.close();
    }
  }
}