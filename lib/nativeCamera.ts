// Native camera seam. When the app runs inside the Capacitor shell the file
// input's `capture` attribute is unreliable (WKWebView shows a bare chooser),
// so capture goes through @capacitor/camera instead and hands a plain File
// back into the existing web pipeline — callers never see Capacitor types.
// Web/SSR callers must gate on isNativeApp() first; this module dynamically
// imports the plugin only on the native path so the web bundle stays lean.

import { isNativeApp } from "@/lib/nativePlatform";

/**
 * Take a photo with the native camera (falls back to the photo library sheet
 * per plugin defaults on user choice). Resolves to a File shaped exactly like
 * a file-input selection, or null when the user cancels / capture fails —
 * callers treat null as "nothing chosen", never an error.
 */
export async function captureNativePhoto(): Promise<File | null> {
  if (!isNativeApp()) return null;
  try {
    const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
    const photo = await Camera.getPhoto({
      resultType: CameraResultType.Uri,
      source: CameraSource.Prompt,
      quality: 85,
    });
    if (!photo.webPath) return null;
    const blob = await (await fetch(photo.webPath)).blob();
    const format = photo.format || "jpeg";
    const type = blob.type || `image/${format === "jpg" ? "jpeg" : format}`;
    return new File([blob], `moment-${Date.now()}.${format}`, { type });
  } catch {
    // User cancelled or permission denied — the composer just stays as-is.
    return null;
  }
}
