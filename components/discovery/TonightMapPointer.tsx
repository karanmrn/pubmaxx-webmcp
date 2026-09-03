"use client";

// W1 absorb: Discover no longer runs a parallel CityMCP "tonight nearby" lane.
// The map TonightLane (+ /api/whats-on) is the operating surface; Discover only
// points there so the spine stays one place.

import Link from "next/link";
import { Sparkles } from "lucide-react";

import { trackEvent } from "@/lib/analytics";

import "./dealsTonightLane.css";

export default function TonightMapPointer() {
  return (
    <section className="dealsTonight" aria-labelledby="tonight-map-pointer-title">
      <div className="dealsTonightHead">
        <h2 id="tonight-map-pointer-title">
          <Sparkles size={18} aria-hidden="true" /> On tonight
        </h2>
      </div>
      <p className="dealsTonightLead">
        Quiz, screens, deals, and live music live on the map Tonight lane, the
        same `/api/whats-on` spine, with pin badges and kind filters.
      </p>
      <Link
        className="dealsTonightMap"
        href="/map?src=discover-tonight"
        onClick={() => trackEvent("whats_on_filter")}
      >
        Open Tonight on the map
      </Link>
    </section>
  );
}
