import * as React from "react";
import { Search, X } from "lucide-react";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export function SearchField({ className, value, onChange, label = "Search pubs", ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & { value: string; onChange: (value: string) => void; label?: string }) {
  return (
    // The field is one control, so it wears one focus ring: the label's, in the
    // house focus colour. The input inside must not add a second — the global
    // :focus-visible rule drew a ring inside this one, so a focused field read
    // as two stacked outlines.
    <label className={cn("houseSearchField flex min-h-11 items-center gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-surface-raised)] px-3 focus-within:ring-2 focus-within:ring-[var(--brass)]", className)}>
      <Search size={18} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      {/* The inner ring and Chrome's own cancel glyph are both suppressed in
          globals.css: a utility class loses to the global :focus-visible and
          UA rules it has to beat. See .houseSearchField there. */}
      <input className="min-w-0 flex-1 border-0 bg-transparent text-base text-[var(--color-text)] outline-none" type="search" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} {...props} />
      {value ? <IconButton className="-mr-2 size-11 border-0 bg-transparent" aria-label="Clear search" onClick={() => onChange("")}><X size={17} /></IconButton> : null}
    </label>
  );
}
