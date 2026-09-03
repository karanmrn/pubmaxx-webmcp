import type { CSSProperties, ReactNode } from "react";

import styles from "./PriceBadge.module.css";

export type PriceBadgeVariant = "baseline" | "current" | "cheap" | "increase" | "neutral";

type PriceBadgeProps = {
  children?: ReactNode;
  variant?: PriceBadgeVariant;
  className?: string;
  style?: CSSProperties;
};

export default function PriceBadge({
  children,
  variant = "neutral",
  className,
  style,
}: PriceBadgeProps) {
  const classes = [
    "priceBadge",
    `priceBadge--${variant}`,
    "price-plaque",
    "ink-stamp",
    "ink-stamp--tilt",
    styles.badge,
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span className={classes} style={style}>
      {children}
    </span>
  );
}
