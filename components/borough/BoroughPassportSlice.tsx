"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useViewerHandle } from "@/components/auth/useViewerHandle";
import { useAuth } from "@/components/auth/AuthProvider";
import { buildBoroughPassport } from "@/lib/passport";
import { normalizeHandle, type ProfileDrop } from "@/lib/profiles";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";

type PublicDrop = ProfileDrop & { id?: string };

type BoroughPassportSliceProps = {
  boroughName: string;
  venueIds: string[];
};

export default function BoroughPassportSlice({ boroughName, venueIds }: BoroughPassportSliceProps) {
  const { identityResolved } = useAuth();
  const viewerHandle = useViewerHandle();
  const handle = viewerHandle ?? "";
  const [passport, setPassport] = useState(() =>
    buildBoroughPassport([], boroughName, venueIds),
  );
  const identityLoading = !identityResolved;

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      if (!identityResolved) return;
      if (!handle) {
        if (active) setPassport(buildBoroughPassport([], boroughName, venueIds));
        return;
      }
      // Scope the feed to this handle via ?author= — never pull the global
      // public feed just to filter client-side.
      const qs = new URLSearchParams({ author: handle });
      await loadSurfaceJson<{ drops?: PublicDrop[] }>(
        `/api/pint-drops?${qs.toString()}`,
        {
          signal: controller.signal,
          validate: (body) => Array.isArray(body?.drops),
        },
        (body) => {
          const mine = (body.drops ?? []).filter(
            (drop) => normalizeHandle(drop.handle) === handle,
          );
          if (active) {
            setPassport(buildBoroughPassport(mine, boroughName, venueIds));
          }
        },
      );
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [boroughName, handle, identityResolved, venueIds]);

  // A previous account's passport must not survive an unresolved account
  // boundary. The live answer controls whether these stats are data or shapes.
  const shownPassport = identityLoading
    ? buildBoroughPassport([], boroughName, venueIds)
    : passport;
  const hasActivity = !shownPassport.isEmpty;

  return (
    <section
      className={`boroughSection boroughPassport${identityLoading ? " boroughPassportLoading" : ""}`}
      aria-labelledby="boroughPassportHeading"
      aria-busy={identityLoading}
    >
      <h2 id="boroughPassportHeading" className="boroughSectionTitle">
        {identityLoading ? "Borough passport" : `Your ${boroughName} passport`}
      </h2>
      <p className="boroughSectionDek">
        {identityLoading ? (
          <span className="boroughPassportSkeleton boroughPassportSkeletonCopy" aria-hidden="true" />
        ) : handle ? (
          <>
            Pubs logged, drinks tried, and pints stamped in {boroughName} for @{handle}.
          </>
        ) : (
          <>
            Claim a handle on your profile to start collecting borough chapters. Session-only
            for now, no home address stored.
          </>
        )}
      </p>
      <dl className="boroughPassportGrid" aria-label={`Passport stats for ${boroughName}`}>
        <div className="boroughPassportStat">
          <dt>Pubs visited</dt>
          <dd>
            {identityLoading ? <span className="boroughPassportSkeleton" aria-hidden="true" /> : shownPassport.pubs}
          </dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Drinks tried</dt>
          <dd>
            {identityLoading ? <span className="boroughPassportSkeleton" aria-hidden="true" /> : shownPassport.beers}
          </dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Pints logged</dt>
          <dd>
            {identityLoading ? <span className="boroughPassportSkeleton" aria-hidden="true" /> : shownPassport.pints}
          </dd>
        </div>
        <div className="boroughPassportStat">
          <dt>Cheapest pint</dt>
          <dd>
            {identityLoading ? (
              <span className="boroughPassportSkeleton" aria-hidden="true" />
            ) : shownPassport.cheapestPintGbp == null ? (
              "–"
            ) : (
              `£${shownPassport.cheapestPintGbp.toFixed(2)}`
            )}
          </dd>
        </div>
      </dl>
      {hasActivity ? (
        <p className="boroughPassportFoot">
          {passport.badges.length > 0 ? (
            <>
              {passport.badges.length} badge{passport.badges.length === 1 ? "" : "s"} earned here
              or nearby.{" "}
            </>
          ) : null}
          <Link href={handle ? `/u/${encodeURIComponent(handle)}` : "/u/you"}>
            Open full passport →
          </Link>
        </p>
      ) : handle ? (
        <p className="boroughPassportFoot">
          Nothing stamped in {boroughName} yet.{" "}
          <Link href={`/map?q=${encodeURIComponent(boroughName)}`}>Log a pint on the map →</Link>
        </p>
      ) : (
        <p className="boroughPassportFoot">
          <Link href="/u/you">Set your handle →</Link>
        </p>
      )}
    </section>
  );
}
