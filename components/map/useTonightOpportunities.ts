"use client";

// London-only: fetch CityMCP tonight opportunities for the map overlay.
// Fail-soft + React 19 deferred setState (same pattern as TonightNearbyLane).

import { useEffect, useState } from "react";

import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

type ApiResponse = {
  opportunities?: ThingsToDoOpportunity[];
  error?: string;
};

export function useTonightOpportunities(enabled: boolean): {
  opportunities: ThingsToDoOpportunity[];
  status: "idle" | "ready" | "hidden";
} {
  const [opportunities, setOpportunities] = useState<ThingsToDoOpportunity[]>([]);
  const [status, setStatus] = useState<"idle" | "ready" | "hidden">("idle");

  useEffect(() => {
    if (!enabled) {
      Promise.resolve().then(() => {
        setOpportunities([]);
        setStatus("hidden");
      });
      return;
    }

    const controller = new AbortController();
    void loadSurfaceJson<ApiResponse>(
      "/api/citymcp/things-to-do?window=tonight&limit=8",
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        validate: (body) => Array.isArray(body?.opportunities),
      },
      (body) => {
        const ops = body.opportunities ?? [];
        Promise.resolve().then(() => {
          if (controller.signal.aborted) return;
          if (ops.length === 0) {
            setOpportunities([]);
            setStatus("hidden");
          } else {
            setOpportunities(ops);
            setStatus("ready");
          }
        });
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) {
        setOpportunities([]);
        setStatus("hidden");
      }
    });

    return () => controller.abort();
  }, [enabled]);

  return { opportunities, status };
}
