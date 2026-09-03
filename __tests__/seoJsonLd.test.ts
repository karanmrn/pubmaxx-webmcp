import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";

import JsonLd, { serializeJsonLd } from "@/components/seo/JsonLd";

// Wave S1.3 — the JSON-LD serializer must be safe to inline inside an HTML
// <script>: HTML-significant characters escape to \uXXXX, and the result stays
// valid JSON that round-trips back to the original data.

describe("serializeJsonLd", () => {
  it("escapes < > & so markup can't break out of the script element", () => {
    const out = serializeJsonLd({ name: "The Dog <script> & Duck > pub" });
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    expect(out).not.toContain("&"); // raw ampersand is always escaped
    expect(out).toContain("\\u003c");
    expect(out).toContain("\\u003e");
    expect(out).toContain("\\u0026");
    // A literal closing </script> can never appear in the output.
    expect(out.toLowerCase()).not.toContain("</script>");
  });

  it("escapes U+2028 / U+2029 line separators", () => {
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    const out = serializeJsonLd({ note: `line${LS}sep${PS}ended` });
    expect(out).toContain("\\u2028");
    expect(out).toContain("\\u2029");
    expect(out).not.toContain(LS);
    expect(out).not.toContain(PS);
  });

  it("stays valid JSON that round-trips to the original value", () => {
    const data = {
      "@context": "https://schema.org",
      "@type": "BarOrPub",
      name: "Ye Olde <b>Cheshire</b> & Co   tavern",
    };
    const parsed = JSON.parse(serializeJsonLd(data));
    expect(parsed).toEqual(data);
  });

  it("serializes an array graph (multiple @types)", () => {
    const out = serializeJsonLd([{ "@type": "WebSite" }, { "@type": "Organization" }]);
    expect(JSON.parse(out)).toHaveLength(2);
  });
});

describe("JsonLd nonce hydration", () => {
  it("suppresses the client-only nonce attribute mismatch", () => {
    const element = JsonLd({
      data: { "@type": "WebSite" },
      nonce: "request-nonce",
    }) as ReactElement<{ suppressHydrationWarning?: boolean }>;
    expect(element.props.suppressHydrationWarning).toBe(true);
  });
});
