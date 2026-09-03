"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { PINT_DATASET_OBSERVED_AT } from "@/lib/dataFreshness";
import type { NearMeCard } from "@/lib/nearMeAnswer";
import type { NearPriceTrustResponse } from "@/lib/nearPriceTrust";
import { discardBody } from "@/lib/responseBody";

export type NearPriceTrustView = "loading" | NearPriceTrustResponse;

export type NearPriceTrustRequest = {
  promise: Promise<NearPriceTrustResponse>;
  signal: AbortSignal;
  abort: () => void;
};

const MAX_TRUST_IDS = 5;

export function buildNearPriceTrustUrl(cards: readonly NearMeCard[]): string | null {
  const ids = [...new Set(cards.map((card) => card.id.trim()).filter(Boolean))]
    .slice(0, MAX_TRUST_IDS);
  if (ids.length === 0) return null;
  const params = new URLSearchParams();
  for (const id of ids) params.append("venueId", id);
  return `/api/near-price-trust?${params.toString()}`;
}

function isNearPriceTrustResponse(value: unknown): value is NearPriceTrustResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<NearPriceTrustResponse>;
  const responseKeys = Object.keys(candidate);
  return (
    responseKeys.length === 3 &&
    responseKeys.every((key) => ["status", "collectedAt", "results"].includes(key)) &&
    (candidate.status === "ready" || candidate.status === "degraded") &&
    typeof candidate.collectedAt === "string" &&
    Array.isArray(candidate.results) &&
    candidate.results.every(
      (item) =>
        item &&
        typeof item === "object" &&
        Object.keys(item).length === 3 &&
        ["venueId", "price", "publisher"].every((key) => Object.hasOwn(item, key)) &&
        typeof item.venueId === "string" &&
        typeof item.price === "number" &&
        Number.isFinite(item.price) &&
        (item.publisher === null || typeof item.publisher === "string"),
    )
  );
}

export function startNearPriceTrustRequest(
  requestUrl: string,
  fetcher: typeof fetch = fetch,
): NearPriceTrustRequest {
  const controller = new AbortController();
  const promise = fetcher(requestUrl, {
    cache: "no-store",
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      discardBody(response);
      throw new Error("near price trust read failed");
    }
    const body: unknown = await response.json();
    if (!isNearPriceTrustResponse(body)) {
      throw new Error("near price trust response invalid");
    }
    return body;
  });
  return {
    promise,
    signal: controller.signal,
    abort: () => controller.abort(),
  };
}

function degradedResponse(): NearPriceTrustResponse {
  return {
    status: "degraded",
    collectedAt: PINT_DATASET_OBSERVED_AT.toISOString().slice(0, 10),
    results: [],
  };
}

/** `/near` evidence read. The generation guard and abort keep old area reads out. */
export function useNearPriceTrust(
  cards: readonly NearMeCard[],
  enabled: boolean,
  activeAnswerGeneration: number,
  completedAnswerGeneration: number | null,
): NearPriceTrustView | undefined {
  const requestUrl = useMemo(() => buildNearPriceTrustUrl(cards), [cards]);
  const answerComplete = activeAnswerGeneration === completedAnswerGeneration;
  const [resolved, setResolved] = useState<{
    requestUrl: string;
    view: NearPriceTrustView;
  }>();
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    if (!enabled || !requestUrl || !answerComplete) return;
    // An external server read owns this transition. Prices stay rendered.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResolved({ requestUrl, view: "loading" });
    const request = startNearPriceTrustRequest(requestUrl);
    void request.promise
      .then((body) => {
        if (generation === generationRef.current) {
          setResolved({ requestUrl, view: body });
        }
      })
      .catch((error: unknown) => {
        if (request.signal.aborted) return;
        if (generation === generationRef.current) {
          setResolved({ requestUrl, view: degradedResponse() });
        }
        void error;
      });
    return () => request.abort();
  }, [activeAnswerGeneration, answerComplete, enabled, requestUrl]);

  if (!enabled || !requestUrl || !answerComplete) return undefined;
  return resolved?.requestUrl === requestUrl ? resolved.view : "loading";
}
