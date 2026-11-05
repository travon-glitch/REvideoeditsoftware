/*
 * Smart Fit in the browser: reads a small copy of the photo and finds its safe area (the most
 * detailed region, usually the home) with the engine's safeAreaFromPixels. The result is saved
 * on the camera spec, so the export frames the photo exactly like the preview.
 */
import { safeAreaFromPixels, type SafeArea } from "@lvs/camera-presets";

const SIZE = 160;

export async function analyzeSafeArea(url: string): Promise<SafeArea | null> {
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("load")); img.src = url; });
    const w = img.naturalWidth >= img.naturalHeight ? SIZE : Math.max(8, Math.round((SIZE * img.naturalWidth) / img.naturalHeight));
    const h = img.naturalWidth >= img.naturalHeight ? Math.max(8, Math.round((SIZE * img.naturalHeight) / img.naturalWidth)) : SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h); // throws if the image can't be read (no CORS)
    const gray = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) gray[i] = 0.2126 * data[i * 4]! + 0.7152 * data[i * 4 + 1]! + 0.0722 * data[i * 4 + 2]!;
    return safeAreaFromPixels(gray, w, h);
  } catch {
    return null;
  }
}
