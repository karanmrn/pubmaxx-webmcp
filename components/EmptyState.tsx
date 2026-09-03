import type { ReactNode } from "react";

import "./emptyState.css";

// Shared "honest, beautiful" empty-state pattern (GH #18 / PRD user stories
// 13, 16, 18, 43): a short serif line, a muted one-or-two-sentence explainer,
// and at most one action. Copy stays grounded — no hype, no emoji — the whole
// point is that an empty surface still reads as designed, not broken or bare.
//
// Deliberately presentational and dependency-light (no Link import) so it
// drops into server components (borough page) and client components (feed,
// crawls, profile) alike — callers pass whatever action element they need
// (usually a Next <Link>), or omit it for a pure "nothing here" message.
//
// role="status" is the default because most call sites are reporting the
// PASSIVE outcome of a completed load (no pubs / no drops / no crawls saved),
// which is exactly what a polite (non-interrupting) live region is for. A
// caller reporting a failed fetch can pass role="alert" instead.
export type EmptyStateProps = {
  /** Short, sentence-case kicker above the headline (optional). */
  eyebrow?: string;
  /** The short serif headline — one line, no punctuation pile-up. */
  title: string;
  /** Muted explainer — a sentence or two, grounded, no hype/emoji. */
  body?: ReactNode;
  /** At most one action (a link or button) — resist adding a second. */
  action?: ReactNode;
  /** Use coral action emphasis and a neutral eyebrow on action-led surfaces. */
  actionTone?: "default" | "accent";
  /** "status" (default) for passive empty results; "alert" for failures. */
  role?: "status" | "alert";
  /** Extra class appended to the root, for page-specific width/spacing only —
      never for re-theming; colours stay on the shared tokens below. */
  className?: string;
};

export default function EmptyState({
  eyebrow,
  title,
  body,
  action,
  actionTone = "default",
  role = "status",
  className,
}: EmptyStateProps): React.JSX.Element {
  const rootClassName = [
    "emptyState",
    actionTone === "accent" ? "emptyState--accentAction" : null,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      className={rootClassName}
      role={role}
    >
      {/* Decorative brass seal — pressed-paper material, not content. */}
      <span className="emptyStateStamp" aria-hidden="true" />
      {eyebrow ? <p className="emptyStateEyebrow">{eyebrow}</p> : null}
      <h2 className="emptyStateTitle">{title}</h2>
      {body ? <p className="emptyStateBody">{body}</p> : null}
      {action ? <div className="emptyStateAction">{action}</div> : null}
    </section>
  );
}
