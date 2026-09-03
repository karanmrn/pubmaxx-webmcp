"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { anonymousAnalyticsId } from "@/lib/analytics";
import { capturePosthogPageview } from "@/lib/posthogClient";

export default function PosthogPageviews(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) capturePosthogPageview(pathname, anonymousAnalyticsId());
  }, [pathname]);

  return null;
}
