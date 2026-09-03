import type { ReactElement } from "react";

// Server-only JSON-LD injector (Wave S1.3). Renders a single
// <script type="application/ld+json"> with the structured-data graph for a
// route. Two hard rules live here:
//
//  1. XSS-safe serialization. JSON-LD is emitted inside an HTML <script>, so any
//     "<", ">" or "&" in the data (a pub name, a cited fact) could otherwise
//     break out of the script element or smuggle markup. We JSON.stringify then
//     escape those to their \uXXXX forms — valid JSON, inert HTML. The U+2028 /
//     U+2029 line/paragraph separators are escaped too (legal in JSON, illegal
//     in a JS string literal, and some consumers choke on a raw one).
//  2. CSP nonce. app/layout.tsx serves a per-request nonce CSP (see proxy.ts)
//     with NO 'unsafe-inline' in script-src. The browser enforces script-src on
//     EVERY <script> element, including non-executable application/ld+json — so
//     without the nonce the block is dropped. Callers pass the request nonce
//     (headers().get("x-nonce")) exactly like the app's other inline scripts.
//
// Data must be provenance-honest: callers only ever pass fields the underlying
// dataset actually carries — nothing invented (PRD non-negotiable).

export type JsonLdGraph = Record<string, unknown> | Record<string, unknown>[];

// Char-code → \uXXXX escape map. Keyed by code point so no literal U+2028/U+2029
// separator ever appears in this source file.
const HTML_UNSAFE = new Map<number, string>([
  [0x3c, "\\u003c"], // <
  [0x3e, "\\u003e"], // >
  [0x26, "\\u0026"], // &
  [0x2028, "\\u2028"], // line separator
  [0x2029, "\\u2029"], // paragraph separator
]);

// Matches every HTML-unsafe code point above without embedding a literal
// U+2028/U+2029 in this source file (built from escapes via new RegExp).
const HTML_UNSAFE_RE = new RegExp("[<>&\\u2028\\u2029]", "g");

/** JSON.stringify hardened for inlining inside an HTML <script> element. */
export function serializeJsonLd(data: JsonLdGraph): string {
  return JSON.stringify(data).replace(
    HTML_UNSAFE_RE,
    (char) => HTML_UNSAFE.get(char.charCodeAt(0)) ?? char,
  );
}

export default function JsonLd({
  data,
  nonce,
}: {
  data: JsonLdGraph;
  /** Per-request CSP nonce (headers().get("x-nonce")); required under the nonce CSP. */
  nonce?: string;
}): ReactElement {
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
