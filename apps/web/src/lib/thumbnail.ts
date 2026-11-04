"use client";

/** Makes a small JPEG preview (longest side `maxSide` px). Returns null if the browser can't read the image. */
export async function makeThumbnail(file: Blob, maxSide = 480): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    return await new Promise((ok) => canvas.toBlob((b) => ok(b), "image/jpeg", 0.8));
  } catch {
    return null;
  }
}
