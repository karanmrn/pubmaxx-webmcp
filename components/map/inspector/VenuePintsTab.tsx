import Link from "next/link";
import { PlusCircle, Quote } from "lucide-react";

import type { Venue } from "@/lib/venues";
import type { LastPintDecision } from "@/lib/tfl";
import type { DropWithPhotos, PintDropsState } from "@/components/map/usePintDrops";
import PintDropComposer from "@/components/map/PintDropComposer";
import VenuePriceStory from "@/components/map/VenuePriceStory";
import type { TabKey } from "@/lib/venueInspectorTabs";
import PintDropsList from "./PintDropsList";

export default function VenuePintsTab({
  venue,
  tab,
  pintDrops,
  drops,
  lastTrainDecision,
  onTabSelect,
}: {
  venue: Venue;
  tab: TabKey;
  pintDrops: PintDropsState;
  drops: DropWithPhotos[];
  lastTrainDecision: LastPintDecision | null;
  onTabSelect?: (key: TabKey) => void;
}) {
  const { composerOpen, setComposerOpen, dropMsg, reportDrop } = pintDrops;
  const hasDemoDrops = drops.some((drop) => drop.provenance === "demo");
  return (
    <div
      role="tabpanel"
      id="venuePanel-pints"
      aria-labelledby="venueTab-pints"
      className="venueTabPanel"
      hidden={tab !== "pints"}
    >
      {/* Desktop docked panel (N3): Golden Thread / composer sits beside the
          Pint Drops list in a two-column layout instead of stacking. This
          wrapper is a no-op on mobile (venueSheet.css only grids it ≥1024px);
          on mobile the two children still stack in document order exactly as
          before. */}
      <div className="venuePintsCols">
        {composerOpen ? (
          <PintDropComposer
            venueId={venue.id}
            state={pintDrops}
            venueName={venue.name}
            lastTrainDecision={lastTrainDecision}
          />
        ) : (
          <VenuePriceStory
            venue={venue}
            drops={drops}
            onPriceChanged={() => {
              onTabSelect?.("pints");
              setComposerOpen(true);
            }}
          />
        )}
        <section className="pintDrops">
          <div className="inspectorTitle">
            <Quote size={16} />
            <span>Pint Drops</span>
          </div>
          {hasDemoDrops ? (
            <div className="demoDataNote">
              <span>Demo data</span>
              Example Pint Drops are seeded for the walkthrough. Live contributions use the same
              flow.
            </div>
          ) : null}
          {composerOpen ? null : (
            <div className="logDropBar">
              <button
                className="logDropBtn"
                onClick={() => {
                  onTabSelect?.("pints");
                  setComposerOpen(true);
                }}
                aria-label={`Log a Pint Drop at ${venue.name}`}
              >
                <PlusCircle size={17} /> Log a Pint Drop
              </button>
              {dropMsg ? (
                <span
                  role={dropMsg.ok ? "status" : "alert"}
                  className={`composerMsg ${dropMsg.ok ? "ok" : "error"}`}
                  style={{ display: "block", marginTop: "8px" }}
                >
                  {dropMsg.text}
                  {dropMsg.ok && dropMsg.links && dropMsg.links.length > 0 ? (
                    <span className="composerMsgLinks">
                      {dropMsg.links.map((link) => (
                        <Link key={link.href} href={link.href} className="composerMsgLink">
                          {link.label}
                        </Link>
                      ))}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </div>
          )}
          {drops.length === 0 ? (
            <p className="description muted">
              No Pint Drops yet at {venue.name}. Be the first. Log tonight&rsquo;s price or pass
              down a story using the button below.
            </p>
          ) : (
            <PintDropsList
              venue={venue}
              drops={drops}
              lastTrainDecision={lastTrainDecision}
              reportDrop={reportDrop}
            />
          )}
        </section>
      </div>
    </div>
  );
}
