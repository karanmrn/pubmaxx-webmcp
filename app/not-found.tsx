// Branded 404. Next's default not-found is an unstyled black page; any dead
// link (a retired route, a mistyped path) landed there. This replaces it with a
// calm, on-brand dark panel that carries the wordmark and points back to the
// two places worth being: the map and tonight. Server component — no client
// state, so it renders instantly inside the root layout. The dark surface is a
// deliberate committed look that reads the same in both themes; the wordmark
// inherits the light `color` set on the container.
import Link from "next/link";

import PubmaxxWordmark from "@/components/brand/PubmaxxWordmark";

export default function NotFound() {
  return (
    <main id="main"
      // A dead link is not a place to compose from, and this page has no
      // pathname of its own to be named by (components/nav/createFab.css).
      className="pageHidesCreateFab"
      style={{
        minHeight: "100svh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--ink-deep, #0f1c16)",
        color: "#fdfaf2",
      }}
    >
      <div style={{ maxWidth: "34rem", textAlign: "center" }}>
        <span
          style={{
            display: "inline-flex",
            fontSize: "1.6rem",
            marginBottom: "22px",
            color: "#fdfaf2",
          }}
        >
          <PubmaxxWordmark />
        </span>
        <p
          style={{
            margin: "0 0 12px",
            color: "var(--brass, #c9a44a)",
            fontSize: "0.74rem",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          404
        </p>
        <h1
          style={{
            margin: "0 0 14px",
            fontFamily: "var(--serif, Georgia, serif)",
            fontSize: "clamp(1.8rem, 4vw, 2.6rem)",
            lineHeight: 1.1,
          }}
        >
          Called for last orders here.
        </h1>
        <p
          style={{
            margin: "0 0 28px",
            color: "rgba(253, 250, 242, 0.72)",
            lineHeight: 1.6,
          }}
        >
          Whatever was here has drunk up and gone home. The pubs haven&rsquo;t.
        </p>
        <div
          style={{
            display: "flex",
            gap: "12px",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/map"
            style={{
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: "var(--radius-sm, 8px)",
              border: "none",
              background: "#fdfaf2",
              color: "var(--ink-deep, #0f1c16)",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            Open the map
          </Link>
          <Link
            href="/tonight"
            style={{
              minHeight: "44px",
              display: "inline-flex",
              alignItems: "center",
              padding: "0 20px",
              borderRadius: "var(--radius-sm, 8px)",
              border: "1px solid rgba(253, 250, 242, 0.3)",
              color: "#fdfaf2",
              textDecoration: "none",
              fontWeight: 600,
            }}
          >
            See tonight
          </Link>
        </div>
      </div>
    </main>
  );
}
