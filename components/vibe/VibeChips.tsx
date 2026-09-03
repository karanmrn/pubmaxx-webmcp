import type { ComponentProps, ReactNode } from "react";

import IntentLink from "@/components/nav/IntentLink";

import "./vibeChips.css";

type VibeChipsProps = {
  groupLabel: string;
  lede?: string;
  shellClassName?: string;
  children: ReactNode;
};

/** Shared layout for the seven owner-locked vibe chips. */
export function VibeChips({
  groupLabel,
  lede,
  shellClassName,
  children,
}: VibeChipsProps) {
  return (
    <div
      className={shellClassName ?? "vibeChips"}
      role="group"
      aria-label={groupLabel}
    >
      {lede ? <p className="vibeChipsLede">{lede}</p> : null}
      <div className="vibeChipsRow">{children}</div>
    </div>
  );
}

type VibeChipButtonProps = ComponentProps<"button"> & {
  active?: boolean;
};

export function VibeChipButton({
  active,
  className,
  type = "button",
  ...props
}: VibeChipButtonProps) {
  const classes = ["vibeChip", "pressable", className].filter(Boolean).join(" ");
  return (
    <button
      type={type}
      className={classes}
      data-active={active ? "true" : undefined}
      aria-pressed={active}
      {...props}
    />
  );
}

type VibeChipLinkProps = ComponentProps<typeof IntentLink>;

/**
 * A chip destination is a dynamic route (`/plan?occasion=…`, `/pal/chat?ask=…`),
 * so it is warmed on intent rather than prefetched on sight — see IntentLink.
 */
export function VibeChipLink({ className, ...props }: VibeChipLinkProps) {
  const classes = ["vibeChip", "pressable", className].filter(Boolean).join(" ");
  return <IntentLink className={classes} {...props} />;
}
