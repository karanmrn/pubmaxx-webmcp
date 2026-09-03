import Link from "next/link";
import type { ReactNode } from "react";

import "./socialViewerState.css";

export type SocialViewerPhase = "unresolved" | "signed-out" | "resolved";

export function SocialViewerState({
  phase,
  loadingLabel,
  inviteMessage,
  children,
}: {
  phase: SocialViewerPhase;
  loadingLabel: string;
  inviteMessage: string;
  children?: ReactNode;
}) {
  if (phase === "unresolved") {
    return (
      <div
        className="socialIdentitySkeletons"
        role="status"
        aria-busy="true"
        aria-label={loadingLabel}
      >
        <span />
        <span />
      </div>
    );
  }

  if (phase === "signed-out") {
    return (
      <p className="socialIdentityInvite">
        {inviteMessage} <Link href="/login?mode=signin&from=%2Fsocial">Sign in</Link>
      </p>
    );
  }

  return children;
}
