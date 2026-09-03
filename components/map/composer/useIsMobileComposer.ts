import { useEffect, useState } from "react";

/**
 * Camera-first, not camera-blocked: on mobile the photo action is presented
 * first, while price/story controls stay available on the first usable paint.
 * Desktop keeps the old single-scroll layout. Hydration-safe: server render
 * and first client paint agree on `mobile=false`, then matchMedia upgrades.
 */
export function useIsMobileComposer(): boolean {
  const [mobile, setMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setMobile(mq.matches);
    apply();
    // addEventListener("change") is the modern API; the older addListener is a
    // fallback for Safari < 14. Either way we clean up on unmount.
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
    mq.addListener(apply);
    return () => mq.removeListener(apply);
  }, []);

  return mobile;
}
