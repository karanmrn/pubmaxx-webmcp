import type { PubPalAppearance, PubPalSpecies, SignalFamily } from "@/lib/pubPal";
import { PubPalMascot } from "@/components/pal/PubPalMascot";
import { pubPalMascotSlugFor } from "@/lib/pubPalMascot";
import "./pubPal.css";

const silhouettes: Record<PubPalSpecies, string> = {
  robin: "M43 9c13 0 21 10 18 23l12 6-13 7c-3 16-14 25-29 22-16-3-22-21-14-36C23 20 31 9 43 9Z",
  greyhound: "M30 18 18 4l3 25c-5 6-7 15-4 25 4 15 28 15 33 0 3-10 1-19-4-25l3-25-12 14c-7-3-16-3-23 0Z",
  cat: "M18 23 20 5l13 13c5-2 9-2 14 0L60 5l2 18c5 8 5 24-2 33-10 12-34 12-44 0-7-9-7-25 2-33Z",
  fox: "M14 22 20 4l15 14c3-1 7-1 10 0L60 4l6 18-12 40-14 8-14-8Z",
  pigeon: "M43 9c13 0 21 10 18 23l12 6-13 7c-3 16-14 25-29 22-16-3-22-21-14-36C23 20 31 9 43 9Z",
  badger: "M16 21C23 5 57 5 64 21c7 18-2 42-24 46-22-4-31-28-24-46Zm9-2 8 39 7-43 7 43 8-39",
  corgi: "M15 22 13 3l20 15c4-1 10-1 14 0L67 3l-2 19c6 13 0 35-11 43H26C15 57 9 35 15 22Z",
  hound: "M30 18 18 4l3 25c-5 6-7 15-4 25 4 15 28 15 33 0 3-10 1-19-4-25l3-25-12 14c-7-3-16-3-23 0Z",
  raven: "M20 57c2-31 12-46 29-45 11 1 17 9 18 20l14 8-15 7c-5 21-25 28-46 10Z",
  rabbit: "M22 30 23 2l12 24c3-1 7-1 10 0L57 2l1 28c10 16 2 37-18 39-20-2-28-23-18-39Z",
  turtle: "M12 42c0-17 13-29 29-29s29 12 29 29-13 26-29 26S12 59 12 42Zm-8 0h8m58 0h8M25 66l-8 8m40-8 8 8",
  squirrel: "M21 62c-8-18 0-35 14-42 12-6 23-1 28 9 13-13 24 5 13 17-8 9-19 3-20-6 3 21-19 35-35 22Z",
  bot: "M14 17h52v47H14zM26 34h8m12 0h8M28 50h24M40 17V8m-6 0h12",
};

export function PubPalAvatar({ appearance, name, compact = false }: { appearance: PubPalAppearance; name: string; compact?: boolean }) {
  return (
    <div className={`palAvatar pal-${appearance.species} pal-${appearance.signalAffinity} ${compact ? "isCompact" : ""}`} role="img" aria-label={`${name}, a ${appearance.signalAffinity} hologram cyber ${appearance.species}`}>
      <span className="palHalo" aria-hidden="true" />
      <span className="palBody" aria-hidden="true">
        {pubPalMascotSlugFor(appearance.species) ? (
          <PubPalMascot species={appearance.species} size={compact ? 28 : 40} circular decorative className="palAvatarMascot" />
        ) : (
          <svg viewBox="0 0 80 80"><path d={silhouettes[appearance.species]} /></svg>
        )}
        <b />
      </span>
      <span className="palParticles" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <i key={index} style={{ "--p": index } as React.CSSProperties} />)}</span>
    </div>
  );
}

export function signalLabel(signal: SignalFamily): string {
  return signal[0].toUpperCase() + signal.slice(1);
}
