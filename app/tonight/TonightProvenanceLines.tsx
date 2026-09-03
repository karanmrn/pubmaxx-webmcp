"use client";

// The credit lines under the Tonight heading, lifted out of TonightClient whole.
//
// Each lane is credited and dated by its OWN read (see tonightProvenanceCredits),
// so this renders two independent pairs: the credit itself, and the plain
// sentence a lane gets when it could not be dated at all. Presentation only —
// every decision is already made by the credits it is handed.

import type { TonightProvenanceCredits } from "@/lib/tonightOutListings";

/** Said instead of a dated chain segment when a lane carries no date. */
export const UNDATED_SOURCE_LINE = "We can’t date these listings yet.";

export default function TonightProvenanceLines({
  provenance,
  nearestSuffix,
}: {
  provenance: TonightProvenanceCredits;
  /** " · nearest Soho first", or null when the page names no patch. */
  nearestSuffix: string | null;
}) {
  return (
    <>
      {provenance.whatsOn ? (
        <p
          className="tonightProvenance"
          data-tonight-provenance="whats-on"
          data-tonight-dated={provenance.whatsOnDated ? "yes" : "no"}
        >
          {provenance.whatsOn}
          {nearestSuffix}
        </p>
      ) : null}
      {provenance.whatsOn && !provenance.whatsOnDated ? (
        <p className="tonightProvenance" data-tonight-provenance="undated-whats-on">
          {UNDATED_SOURCE_LINE}
        </p>
      ) : null}
      {provenance.out ? (
        <p
          className="tonightProvenance"
          data-tonight-provenance="out"
          data-tonight-dated={provenance.outDated ? "yes" : "no"}
        >
          {provenance.out}
        </p>
      ) : null}
      {provenance.out && !provenance.outDated ? (
        <p className="tonightProvenance" data-tonight-provenance="undated-out">
          {UNDATED_SOURCE_LINE}
        </p>
      ) : null}
    </>
  );
}
