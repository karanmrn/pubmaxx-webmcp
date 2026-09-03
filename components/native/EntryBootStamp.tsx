"use client";

// Mounted once in the root layout. The entry-decision seam
// (lib/entryDecision.ts) marks "the cold-start decision already ran this
// session" from AppEntryRoute, but that component only mounts at "/". The
// installed PWA cold-starts on the manifest start_url (/tonight), so the flag
// was never stamped and the first in-app wordmark tap to "/" was mistaken for
// a cold start and bounced back to /tonight (owner report, 2026-07-22). A boot
// on any non-root path is a deep-link entry by the seam's own precedence, so
// this component consumes the session entry there. Root boots are left
// entirely to AppEntryRoute; this renders nothing and runs once per boot.

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { consumeDeepLinkBootEntry } from "@/lib/entryDecision";

export default function EntryBootStamp(): null {
  const pathname = usePathname();
  const stamped = useRef(false);

  useEffect(() => {
    if (stamped.current) return;
    stamped.current = true;
    consumeDeepLinkBootEntry(pathname ?? "/");
  }, [pathname]);

  return null;
}
