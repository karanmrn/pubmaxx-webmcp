"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PubPal } from "@/lib/pubPal";
import { trackEvent } from "@/lib/analytics";
import { PubPalAvatar } from "./PubPalAvatar";

export function shouldShowPubPalSummon(pathname: string): boolean {
  return pathname === "/" || pathname === "/map" || pathname.startsWith("/map/") || pathname === "/plan" || pathname.startsWith("/plan/");
}

export default function PubPalSummon() {
  const pathname = usePathname() ?? "";
  const [pal, setPal] = useState<PubPal | null>(null);
  useEffect(() => { try { const value = JSON.parse(localStorage.getItem("pubmax_pub_pal_v1") ?? "null") as PubPal | null; queueMicrotask(() => setPal(value)); } catch {} }, [pathname]);
  if (!pal || pal.hidden || !shouldShowPubPalSummon(pathname)) return null;
  return <Link className="palSummon" href="/pal" aria-label={`Summon ${pal.name}, your Pub Pal`} onClick={() => trackEvent("pub_pal_summoned", { surface: pathname === "/" ? "home" : pathname.startsWith("/map") ? "map" : "plan" })}><PubPalAvatar appearance={pal.appearance} name={pal.name} compact/><span><strong>{pal.name}</strong><small>{pal.muted ? "Muted" : "Tap to talk or plan"}</small></span></Link>;
}
