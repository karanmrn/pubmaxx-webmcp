"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, MapPinned, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import PalPortrait from "@/components/pal/PalPortrait";
import { trackEvent } from "@/lib/analytics";
import { writePreferredCity } from "@/lib/cityPreference";
import {
  FIRST_RUN_COMPANIONS,
  claimTourPromptBudget,
  markTourSeen,
  readFirstRunCompanion,
  releaseTourPromptBudget,
  writeFirstRunCompanion,
  type FirstRunCompanion,
} from "@/lib/firstRunTour";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";

type ReviewedArea = {
  name: string;
  transportAnchor: string;
};

export default function FirstRunOnboarding({
  reviewedAreas,
}: {
  reviewedAreas: ReviewedArea[];
}) {
  const router = useRouter();
  const [stage, setStage] = useState<"london" | "companion">("london");
  const [companion, setCompanion] = useState<FirstRunCompanion>("robin");

  useEffect(() => {
    claimTourPromptBudget();
    const remembered = readFirstRunCompanion();
    if (remembered) void Promise.resolve().then(() => setCompanion(remembered));
    const releaseBudget = () => releaseTourPromptBudget();
    window.addEventListener("pagehide", releaseBudget);
    return () => {
      window.removeEventListener("pagehide", releaseBudget);
      releaseBudget();
    };
  }, []);

  const selectedCompanion = useMemo(
    () => FIRST_RUN_COMPANIONS.find((choice) => choice.id === companion) ?? null,
    [companion],
  );
  const appearance = useMemo(
    () => ({
      ...DEFAULT_PAL_DRAFT.appearance,
      species: companion ?? DEFAULT_PAL_DRAFT.appearance.species,
    }),
    [companion],
  );

  function confirmLondon() {
    writePreferredCity("london");
    setStage("companion");
  }

  function chooseCompanion(choice: FirstRunCompanion) {
    setCompanion(choice);
    writeFirstRunCompanion(choice);
  }

  function skipOnboarding() {
    markTourSeen();
    trackEvent("tour_complete", { completed: false });
    releaseTourPromptBudget();
    router.replace("/tonight");
  }

  function startPlan() {
    if (!companion) return;
    writePreferredCity("london");
    writeFirstRunCompanion(companion);
    markTourSeen();
    trackEvent("tour_complete", { completed: true });
    // Onboarding and push never overlap. The route generator is the first
    // action allowed to arm the native permission explainer.
    releaseTourPromptBudget();
    router.push("/map?plan=1");
  }

  const isCompanionStage = stage === "companion";

  return (
    <main id="main" className="firstRunOnboarding" data-stage={stage}>
      <header className="firstRunTopbar">
        <div className="firstRunBrand" aria-label="PUBMAXXING">
          <Image src="/brand/icon.svg" alt="" width={30} height={30} priority />
          <span>PUBMAXXING</span>
        </div>
        <div
          className="firstRunProgress"
          role="progressbar"
          aria-label="Onboarding progress"
          aria-valuemin={1}
          aria-valuemax={2}
          aria-valuenow={isCompanionStage ? 2 : 1}
        >
          <span className={isCompanionStage ? "isComplete" : "isCurrent"} />
          <span className={isCompanionStage ? "isCurrent" : ""} />
        </div>
        <button type="button" className="firstRunSkip pressable" onClick={skipOnboarding}>
          Skip
        </button>
      </header>

      <div className="firstRunStage" key={stage}>
        <section className="firstRunVisual" aria-label={isCompanionStage ? "Companion preview" : "London preview"}>
          {isCompanionStage ? (
            <div className="firstRunCompanionHero">
              <PalPortrait
                appearance={appearance}
                name={selectedCompanion?.label ?? "Companion preview"}
                state="noticing"
              />
              <p aria-live="polite">
                {selectedCompanion
                  ? `${selectedCompanion.label} will be in your corner for the first night.`
                  : "Pick the Pal you want in your corner for the first night."}
              </p>
            </div>
          ) : (
            <figure className="firstRunLondonPhoto">
              <Image
                src="/landing/hero-thames.jpg"
                alt="London and the Thames viewed from above"
                fill
                priority
                sizes="(max-width: 760px) 100vw, 52vw"
              />
              <figcaption>London, with the route home kept in view.</figcaption>
            </figure>
          )}
        </section>

        <section className="firstRunPanel" aria-live="polite">
          <div className="firstRunPanelInner">
            {isCompanionStage ? (
              <>
                <p className="firstRunEyebrow">Your companion</p>
                <h1>Pick your Pub Pal.</h1>
                <p className="firstRunLead">
                  Every Pal reads the same real prices and routes. Pick the one you want in your corner tonight.
                </p>

                <div className="firstRunCompanionGrid" role="group" aria-label="Choose your Pub Pal">
                  {FIRST_RUN_COMPANIONS.map((choice) => {
                    const selected = companion === choice.id;
                    return (
                      <button
                        key={choice.id}
                        type="button"
                        className={`firstRunCompanionChoice pressable${selected ? " isSelected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => chooseCompanion(choice.id)}
                      >
                        <span>{choice.label}</span>
                        <small>{choice.note}</small>
                        {selected ? <Check size={18} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>

                <p className="firstRunPrivacy">
                  <ShieldCheck size={16} aria-hidden="true" />
                  You can name, tweak, or skip your Pal later.
                </p>

                <div className="firstRunActions">
                  <button type="button" className="firstRunBack pressable" onClick={() => setStage("london")}>
                    <ArrowLeft size={18} aria-hidden="true" /> Back
                  </button>
                  <button
                    type="button"
                    className="firstRunPrimary pressable"
                    disabled={!companion}
                    onClick={startPlan}
                  >
                    Plan my night <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
                <p className="firstRunPermissionNote">
                  We won&rsquo;t ask about notifications until your first night&rsquo;s sorted.
                </p>
              </>
            ) : (
              <>
                <p className="firstRunEyebrow">Your city</p>
                <h1>London is ready.</h1>
                <p className="firstRunLead">
                  Start with checked routes, listed pint prices, and a clear way home.
                </p>

                <div className="firstRunAreaList" aria-label="Reviewed London route areas">
                  {reviewedAreas.map((area) => (
                    <article key={area.name}>
                      <MapPinned size={19} aria-hidden="true" />
                      <div>
                        <strong>{area.name}</strong>
                        <span>Home via {area.transportAnchor}</span>
                      </div>
                      <small>PUBMAXX reviewed</small>
                    </article>
                  ))}
                </div>

                <div className="firstRunActions firstRunActionsSingle">
                  <button type="button" className="firstRunPrimary pressable" onClick={confirmLondon}>
                    Use London <ArrowRight size={18} aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
