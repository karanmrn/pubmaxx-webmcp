"use client";

import { useCallback, useEffect, useState } from "react";

import { outWindowToApiDay, type OutDayWindow } from "@/lib/outListings";
import { outAnswerView } from "@/lib/out/outStatus";
import type { OutDay, OutResponse } from "@/lib/out/types";
import { discardBody } from "@/lib/responseBody";

type HeldOutAnswer = {
  day: OutDay;
  body: OutResponse | null;
  failed: boolean;
};

/**
 * Abort a hung /api/out request after this long, then report a failed read.
 *
 * The same ceiling the What's-On spine keeps (useWhatsOnTonight), and for the
 * same reason twice over: /tonight now waits on BOTH reads, so a request that
 * never answers would pin the loading skeleton for good over a night What's-On
 * had already described. Every read here settles, one way or the other.
 */
export const OUT_FETCH_TIMEOUT_MS = 8_000;

/**
 * One client read of GET /api/out. Shared by /out and /tonight so a ready
 * Ticketmaster answer cannot sit behind a second, idle What's-On wait.
 */
export function useOutListings(window: OutDayWindow) {
  const apiDay = outWindowToApiDay(window);
  const [answer, setAnswer] = useState<HeldOutAnswer | null>(null);
  const [generation, setGeneration] = useState(0);
  const view = outAnswerView(answer, apiDay);

  const retry = useCallback(() => {
    setAnswer(null);
    setGeneration((n) => n + 1);
  }, [setAnswer, setGeneration]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OUT_FETCH_TIMEOUT_MS);
    void (async () => {
      try {
        const res = await fetch(`/api/out?city=london&day=${apiDay}`, {
          signal: controller.signal,
        });
        if (cancelled) {
          discardBody(res);
          return;
        }
        if (!res.ok) {
          discardBody(res);
          setAnswer({ day: apiDay, body: null, failed: true });
          return;
        }
        const json = (await res.json()) as OutResponse;
        if (cancelled) return;
        setAnswer({ day: apiDay, body: json, failed: false });
      } catch {
        // Offline, DNS, a timeout abort: the reader is owed the same honest
        // line as a refused read, never day chips over an empty page with no
        // status, and never a skeleton that outlives the request behind it.
        if (cancelled) return;
        setAnswer({ day: apiDay, body: null, failed: true });
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiDay, generation]);

  return { ...view, retry };
}
