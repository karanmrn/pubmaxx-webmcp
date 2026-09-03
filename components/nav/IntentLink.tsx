"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, type ComponentProps } from "react";

import { warmNavRoute } from "@/lib/mapWarmup";

// A link to a chip destination, warmed on intent rather than on sight.
//
// Next prefetches every <Link> in the viewport. On a page whose destinations
// are dynamic routes that is not a head start, it is a queue: a Tonight arrival
// fired twenty `/plan?occasion=…` and `/pal/chat?ask=…` prefetches, each a real
// server render, in front of the listings the reader was waiting for — and each
// one keyed by its own query string, so nothing deduped. The tab bar already
// answers this shape (components/nav/MobileTabBar.tsx): turn the automatic
// prefetch off, and warm the ONE destination a pointer or a focus says is next.
//
// The seen-set is shared across every intent link in the session, so hovering a
// chip twice costs one prefetch.

const warmed = new Set<string>();

export type IntentLinkProps = Omit<ComponentProps<typeof Link>, "prefetch">;

/** The intent warm on its own, for a link that needs its own element. */
export function useIntentWarm(): (href: string) => void {
  const router = useRouter();
  return useCallback(
    (href: string) => {
      warmNavRoute(router, href, warmed);
    },
    [router],
  );
}

export default function IntentLink({
  href,
  onPointerEnter,
  onPointerDown,
  onFocus,
  onTouchStart,
  ...props
}: IntentLinkProps) {
  const warm = useIntentWarm();
  // Only a string href can be warmed by path; a UrlObject caller still gets the
  // prefetch turned off, which is the half that was costing the arrival.
  const target = typeof href === "string" ? href : null;
  const warmTarget = () => {
    if (target) warm(target);
  };
  return (
    <Link
      href={href}
      prefetch={false}
      onPointerEnter={(event) => {
        warmTarget();
        onPointerEnter?.(event);
      }}
      onPointerDown={(event) => {
        warmTarget();
        onPointerDown?.(event);
      }}
      onFocus={(event) => {
        warmTarget();
        onFocus?.(event);
      }}
      onTouchStart={(event) => {
        warmTarget();
        onTouchStart?.(event);
      }}
      {...props}
    />
  );
}
