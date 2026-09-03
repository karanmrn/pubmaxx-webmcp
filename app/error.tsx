"use client";

// Route-segment error boundary. Any unhandled render/runtime error in a page
// (outside the map, which has its own WebGL fallback) lands here as a calm,
// on-brand recovery screen instead of a white screen. `reset()` re-renders the
// segment; the Home link is the always-works escape hatch.
import Link from "next/link";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface it for logs/monitoring; never swallow silently.
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <main id="main"
      role="alert"
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--paper)",
        color: "var(--ink)",
      }}
    >
      <div style={{ maxWidth: "34rem", textAlign: "center" }}>
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--brass)",
            fontSize: "0.74rem",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          Last orders interrupted
        </p>
        <h1
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--serif, Georgia, serif)",
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            lineHeight: 1.1,
          }}
        >
          Spilled.
        </h1>
        <p style={{ margin: "0 0 28px", color: "var(--ink-soft)", lineHeight: 1.6 }}>
          Something on our end fell over, not anything you did. Have another go,
          or head back to the front page.
        </p>
        <div
          style={{ display: "flex", gap: "12px", justifyContent: "center", flexWrap: "wrap" }}
        >
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: "44px",
              padding: "0 20px",
              borderRadius: "var(--radius-sm, 8px)",
              border: "none",
              background: "var(--ink-deep, #0f1c16)",
              color: "#fdfaf2",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: "var(--radius-sm, 8px)",
              border: "1px solid var(--line)",
              color: "var(--ink)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Back to the front page
          </Link>
        </div>
        {error.digest ? (
          <p style={{ marginTop: "20px", color: "var(--muted)", fontSize: "0.76rem" }}>
            Reference: {error.digest}
          </p>
        ) : null}
      </div>
    </main>
  );
}
