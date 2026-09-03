import * as React from "react";
import { cn } from "@/lib/utils";

type TabsContextValue = { value: string; setValue: (value: string) => void; id: string };
const TabsContext = React.createContext<TabsContextValue | null>(null);

export function Tabs({ value, onValueChange, className, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string; onValueChange: (value: string) => void }) {
  const id = React.useId();
  return <TabsContext.Provider value={{ value, setValue: onValueChange, id }}><div className={cn("grid gap-4", className)} {...props} /></TabsContext.Provider>;
}

/**
 * De-box rule (design judgement 2026-08-01, finding 2.5): borders are for
 * inputs, fills are for selection, hairlines are for structure. The group wears
 * ONE hairline; a segment never wears its own border. The `border-0
 * bg-transparent` on the trigger is load-bearing, not decoration: this app ships
 * no Tailwind preflight, so a button with no explicit border/background falls
 * back to the user agent's `2px outset buttonborder` on `buttonface`. That is
 * what drew the unselected segments louder and lighter than the selected one -
 * the eye read the four wrong tabs as active.
 */
export function TabsList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div role="tablist" className={cn("flex min-h-11 gap-1 overflow-x-auto touch-pan-y rounded-[var(--radius)] border border-[var(--color-border-soft)] bg-transparent p-1", className)} {...props} />;
}

function valueId(value: string): string {
  return value.replace(/[^a-z0-9_-]/gi, "-");
}

export function TabsTrigger({ value, className, onClick, onKeyDown, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsTrigger must be inside Tabs");
  const selected = context.value === value;
  const suffix = valueId(value);
  return <button type="button" role="tab" id={`${context.id}-tab-${suffix}`} aria-controls={`${context.id}-panel-${suffix}`} aria-selected={selected} tabIndex={selected ? 0 : -1} className={cn("min-h-9 shrink-0 rounded-[calc(var(--radius)-4px)] border-0 bg-transparent px-3 text-sm font-bold text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]", selected && "bg-[var(--color-surface-raised)] font-extrabold text-[var(--color-text)] shadow-sm", className)} onClick={(event) => { onClick?.(event); if (!event.defaultPrevented) context.setValue(value); }} onKeyDown={(event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = [...event.currentTarget.closest('[role="tablist"]')?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []];
    const current = tabs.indexOf(event.currentTarget);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
  }} {...props} />;
}

export function TabsContent({ value, ...props }: React.HTMLAttributes<HTMLDivElement> & { value: string }) {
  const context = React.useContext(TabsContext);
  if (!context) throw new Error("TabsContent must be inside Tabs");
  if (context.value !== value) return null;
  const suffix = valueId(value);
  return <div role="tabpanel" id={`${context.id}-panel-${suffix}`} aria-labelledby={`${context.id}-tab-${suffix}`} tabIndex={0} {...props} />;
}
