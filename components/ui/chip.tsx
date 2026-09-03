import * as React from "react";
import { cn } from "@/lib/utils";

export const Chip = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ className, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn("inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 text-sm font-bold text-[var(--color-text)] transition-[transform,border-color,background-color,color] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] motion-reduce:transition-none", className)}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";
