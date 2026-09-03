import { Bot, Rabbit, Squirrel, Turtle, type LucideIcon } from "lucide-react";

import {
  type PalAnimationState,
  type PubPalAppearance,
} from "@/lib/pubPal";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { pubPalMascotSlugFor } from "@/lib/pubPalMascot";

const legacySpeciesIcons: Partial<Record<PubPalAppearance["species"], LucideIcon>> = {
  rabbit: Rabbit,
  turtle: Turtle,
  squirrel: Squirrel,
  bot: Bot,
};

function GreyhoundRig() {
  return (
    <svg className="palRig palRigGreyhound" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="160" cy="274" rx="79" ry="18" /></g>
      <g className="palRigBack">
        <path d="M106 101 66 54l18 81 25-7Z" />
        <path d="m214 101 40-47-18 81-25-7Z" />
      </g>
      <g className="palRigBody"><path d="M101 229c12-35 106-35 118 0l18 49H83Z" /></g>
      <g className="palRigHead">
        <path d="M96 114c12-53 116-57 128 4 10 50-14 128-63 128-50 0-76-80-65-132Z" />
        <path className="palRigHighlight" d="M111 116c19-34 80-42 103-5-22-14-64-12-103 5Z" />
      </g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M111 147c12-10 27-9 36 3-12 12-25 13-36-3Z" />
        <path className="palRigEye palRigEyeRight" d="M175 150c9-12 25-13 36-3-10 16-24 15-36 3Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="149" r="5" />
        <circle className="palRigPupil palRigPupilRight" cx="191" cy="149" r="5" />
        <path className="palRigMuzzle" d="M122 170c17-16 63-16 79 1 11 26-7 50-39 50-33 0-51-24-40-51Z" />
        <path className="palRigNose" d="M148 174c7-7 22-7 29 0-3 13-25 13-29 0Z" />
        <path className="palRigMouth" d="M144 198q18 13 36 0" />
      </g>
      <g className="palRigProp palRigCollar">
        <path d="M107 228q54 22 108 0l-4 22q-50 20-100 0Z" />
        <circle cx="161" cy="247" r="12" />
        <path d="M155 247h12M161 241v12" />
      </g>
    </svg>
  );
}

function CatRig() {
  return (
    <svg className="palRig palRigCat" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="160" cy="276" rx="72" ry="16" /></g>
      <g className="palRigBack">
        <path d="m102 111 10-74 49 55Z" /><path d="m218 111-10-74-49 55Z" />
        <path className="palRigTail" d="M211 230c77-25 59 56 15 38 31-10 24-35-8-22Z" />
      </g>
      <g className="palRigBody"><path d="M104 271c4-60 27-86 58-86 36 0 58 29 59 86Z" /></g>
      <g className="palRigHead"><path d="M92 111c14-49 121-54 139 1 16 49-17 122-70 122-54 0-84-75-69-123Z" /><path className="palRigHighlight" d="M113 104c29-24 72-25 99 3-36-10-68-8-99-3Z" /></g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M104 146q22-13 42 1-20 13-42-1Z" /><path className="palRigEye palRigEyeRight" d="M176 147q20-14 41-1-21 14-41 1Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="146" r="4" /><circle className="palRigPupil palRigPupilRight" cx="190" cy="146" r="4" />
        <path className="palRigMuzzle" d="M123 171q38-18 76 0-5 48-38 48t-38-48Z" /><path className="palRigNose" d="m151 175 10-7 10 7-10 9Z" /><path className="palRigMouth" d="M145 198q16 10 32 0" />
      </g>
      <g className="palRigProp palRigBell"><path d="M119 229q42 18 84 0l-3 18q-39 15-78 0Z" /><circle cx="161" cy="250" r="10" /></g>
    </svg>
  );
}

function RavenRig() {
  return (
    <svg className="palRig palRigRaven" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="162" cy="276" rx="72" ry="16" /></g>
      <g className="palRigBody"><path d="M100 261c4-71 32-119 76-119 49 0 70 54 58 121-35 20-96 20-134-2Z" /></g>
      <g className="palRigBack"><path d="M111 193c-38 24-44 63-21 80 30-15 54-44 63-77Z" /></g>
      <g className="palRigHead">
        <path d="M102 109c16-53 107-59 132-6 10 22 2 54-22 72-34 26-103 11-110-66Z" />
        <path className="palRigBeak" d="M194 127 286 157l-91 23c14-18 14-36-1-53Z" />
        <path className="palRigHighlight" d="M126 103c28-27 72-28 93 7-34-16-65-12-93-7Z" />
      </g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M141 132c14-13 32-10 40 4-12 15-30 14-40-4Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="165" cy="134" r="6" />
      </g>
      <g className="palRigProp palRigLens">
        <circle cx="164" cy="135" r="27" />
        <path d="m184 154 24 23M137 111l-16-17" />
      </g>
    </svg>
  );
}

function FoxRig() {
  return (
    <svg className="palRig palRigFox" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="158" cy="276" rx="82" ry="17" /></g>
      <g className="palRigBack">
        <path d="M91 112 104 35l52 58Z" />
        <path d="m229 112-13-77-52 58Z" />
        <path className="palRigTail" d="M209 226c81-31 82 49 20 49-23 0-35-14-31-27 18 12 40 0 11-22Z" />
      </g>
      <g className="palRigBody"><path d="M98 268c4-53 25-78 63-78 41 0 62 27 63 78Z" /></g>
      <g className="palRigHead">
        <path d="M87 112c17-47 126-55 147 1 16 44-15 126-73 126-59 0-91-83-74-127Z" />
        <path className="palRigHighlight" d="M108 104c35-28 77-30 108 2-32-13-69-11-108-2Z" />
        <path className="palRigMuzzle" d="m112 163 49 67 50-67c-33 18-66 18-99 0Z" />
      </g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M105 143c17-12 33-9 43 6-15 8-30 7-43-6Z" />
        <path className="palRigEye palRigEyeRight" d="M174 149c10-15 27-18 43-6-13 13-28 14-43 6Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="146" r="5" />
        <circle className="palRigPupil palRigPupilRight" cx="190" cy="146" r="5" />
        <path className="palRigNose" d="M148 185c7-8 22-8 29 0-5 13-24 13-29 0Z" />
        <path className="palRigMouth" d="M146 204q16 12 32 0" />
      </g>
      <g className="palRigProp palRigCompass">
        <circle cx="161" cy="247" r="22" />
        <path d="m169 235-5 15-13 8 5-16Z" />
      </g>
    </svg>
  );
}

function PigeonRig() {
  return (
    <svg className="palRig palRigPigeon" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="158" cy="277" rx="70" ry="15" /></g>
      <g className="palRigBody"><path d="M92 259c5-78 36-126 87-121 51 5 70 69 46 126-38 17-96 14-133-5Z" /></g>
      <g className="palRigBack"><path d="M111 183c-35 21-44 62-17 79 32-17 54-44 61-79Z" /><path d="M167 252h-34l-18 30M183 253h35l18 29" /></g>
      <g className="palRigHead"><circle cx="182" cy="111" r="63" /><path className="palRigHighlight" d="M150 77q45-35 78 8-43-17-78-8Z" /><path className="palRigBeak" d="m227 112 65 22-66 18q13-20 1-40Z" /></g>
      <g className="palRigFace"><path className="palRigEye palRigEyeLeft" d="M168 109q22-16 39 2-19 17-39-2Z" /><circle className="palRigPupil palRigPupilLeft" cx="191" cy="110" r="6" /></g>
      <g className="palRigProp palRigTransitTag"><rect x="119" y="205" width="54" height="35" rx="8" /><path d="M130 218h32M130 228h21" /></g>
    </svg>
  );
}

function BadgerRig() {
  return (
    <svg className="palRig palRigBadger" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="160" cy="276" rx="88" ry="17" /></g>
      <g className="palRigBack"><circle cx="105" cy="105" r="31" /><circle cx="215" cy="105" r="31" /></g>
      <g className="palRigBody"><path d="M71 271c11-61 45-84 90-84 48 0 80 25 89 84Z" /></g>
      <g className="palRigHead"><path d="M79 119c14-65 149-69 163 1 12 62-25 120-81 120-57 0-94-59-82-121Z" /><path className="palRigHighlight" d="m109 102 27-25 12 145-37-42Z" /><path className="palRigHighlight" d="m213 102-28-25-12 145 38-42Z" /></g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M105 148q22-13 40 3-20 12-40-3Z" /><path className="palRigEye palRigEyeRight" d="M177 151q18-16 40-3-20 15-40 3Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="149" r="5" /><circle className="palRigPupil palRigPupilRight" cx="190" cy="149" r="5" />
        <path className="palRigMuzzle" d="M119 174q42-21 84 0-4 53-42 53t-42-53Z" /><path className="palRigNose" d="M147 177q14-13 28 0-3 17-28 0Z" /><path className="palRigMouth" d="M144 204q17 9 34 0" />
      </g>
      <g className="palRigProp palRigLantern"><path d="M213 211h38v48h-38Z" /><path d="M221 211q11-20 22 0M220 225h24v22h-24Z" /></g>
    </svg>
  );
}

function CorgiRig() {
  return (
    <svg className="palRig palRigCorgi" viewBox="0 0 320 320" aria-hidden="true">
      <g className="palRigShadow"><ellipse cx="160" cy="277" rx="84" ry="17" /></g>
      <g className="palRigBack"><path d="m101 112-9-83 62 67Z" /><path d="m219 112 9-83-62 67Z" /></g>
      <g className="palRigBody"><path d="M78 271c9-58 39-81 83-81 46 0 76 24 82 81Z" /></g>
      <g className="palRigHead"><path d="M82 116c16-56 140-60 157 2 15 56-21 119-78 119-58 0-95-65-79-121Z" /><path className="palRigHighlight" d="M109 102q51-37 103 4-54-17-103-4Z" /><path className="palRigMuzzle" d="M111 166q50-32 100 0-4 65-50 65t-50-65Z" /></g>
      <g className="palRigFace">
        <path className="palRigEye palRigEyeLeft" d="M102 146q21-17 43 1-21 18-43-1Z" /><path className="palRigEye palRigEyeRight" d="M177 147q22-18 43-1-22 18-43 1Z" />
        <circle className="palRigPupil palRigPupilLeft" cx="132" cy="146" r="6" /><circle className="palRigPupil palRigPupilRight" cx="190" cy="146" r="6" />
        <path className="palRigNose" d="M146 177q15-14 30 0-5 18-30 0Z" /><path className="palRigMouth" d="M139 202q22 23 44 0" />
      </g>
      <g className="palRigProp palRigHarness"><path d="M103 226q58 28 116 0l-5 27q-53 23-106 0Z" /><path d="M153 241h16v16h-16Z" /></g>
    </svg>
  );
}

const speciesDescriptions: Record<PubPalAppearance["species"], string> = {
  robin: "the circuit robin companion with a warm amber signal chest",
  greyhound: "a long-nosed signal greyhound with a loyal expression and collar light",
  cat: "a black-glass signal cat with a hooked tail and brass bell",
  pigeon: "a streetwise signal pigeon with an oil-slick chest and transit tag",
  badger: "a steady graphite signal badger with a night-key lantern",
  corgi: "a bright signal corgi with oversized ears and a crew band",
  hound: "an alert signal hound with a loyal expression and collar light",
  raven: "an observant signal raven with a long profile and lore lens",
  fox: "a quick signal fox with bright eyes and route compass",
  rabbit: "an alert neon rabbit ready for a detour on the way home",
  turtle: "a steady chrome turtle who never rushes a good night",
  squirrel: "a bright holographic squirrel collecting stories instead of acorns",
  bot: "a pocket-sized Night Bot with an expressive screen face",
};

export default function PalPortrait({ appearance, name, compact = false, state = "idle" }: {
  appearance: PubPalAppearance;
  name: string;
  compact?: boolean;
  state?: PalAnimationState;
}) {
  const LegacyIcon = legacySpeciesIcons[appearance.species];
  const mascotSize = compact ? 96 : 192;
  // A species that ships a master is drawn as that photograph; the rigs below are
  // the fallback for the forms that have none, so the question is asked once here
  // rather than by comparing species names in three places.
  const rendered = pubPalMascotSlugFor(appearance.species) !== null;
  const Rig = rendered ? null
    : appearance.species === "greyhound" || appearance.species === "hound" ? GreyhoundRig
    : appearance.species === "cat" ? CatRig
    : appearance.species === "fox" ? FoxRig
    : appearance.species === "pigeon" ? PigeonRig
    : appearance.species === "badger" ? BadgerRig
    : appearance.species === "corgi" ? CorgiRig
    : appearance.species === "raven" ? RavenRig
    : null;

  return (
    <div
      className={`palPortrait palPortrait-${appearance.signalAffinity} palPortrait-${appearance.material} ${compact ? "isCompact" : ""}`}
      data-pal-state={state}
      {...(rendered
        ? {}
        : {
            role: "img" as const,
            "aria-label": `${name}, ${speciesDescriptions[appearance.species]}. ${appearance.material} material with ${appearance.signalAffinity} affinity. ${state} state.`,
          })}
    >
      <span className="palPortraitField" aria-hidden="true" />
      <span className="palPortraitOrbit palPortraitOrbitA" aria-hidden="true" />
      <span className="palPortraitOrbit palPortraitOrbitB" aria-hidden="true" />
      <span className="palPortraitCore" aria-hidden={!rendered}>
        {rendered ? (
          <PubPalMascot species={appearance.species} size={mascotSize} circular={false} className="palPortraitMascot" />
        ) : Rig ? (
          <Rig />
        ) : LegacyIcon ? (
          <LegacyIcon className="palLegacyIcon" strokeWidth={1.15} />
        ) : null}
        <span className="palPortraitScan" />
      </span>
      <span className="palPortraitEcho" aria-hidden="true"><span className="palPortraitSignalMark" /></span>
      {appearance.accessory !== "none" ? <span className="palPortraitAccessory" aria-hidden="true">{appearance.accessory.replace("-", " ")}</span> : null}
    </div>
  );
}
