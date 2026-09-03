import { type Dirent, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Sponsorship separation fence (wayfinder 3.6). NO sponsorship exists yet; this
// fence is law before the first deal arrives. It reads SOURCE so a regression
// fails loudly, the same idiom as __tests__/frictionVoice.test.ts.
//
// Three guards:
//   (a) No ranking module (lib/forYou.ts, lib/nearMeAnswer.ts, and every
//       lib/concierge/*.ts seam) may import lib/sponsorship.ts or name a
//       sponsored/sponsorship token. A sponsor can never buy organic position.
//   (b) Any future component under app/ or components/ that references
//       SponsoredPlacement must ALSO reference the disclosure label export
//       (SPONSORED_DISCLOSURE_LABEL). Grep-level heuristic: a component that
//       renders a placement without importing its required label is exactly the
//       undisclosed-placement bug this ticket forbids. Vacuously true today (no
//       component references it yet) and armed for the first one that does.
//   (c) The policy doc exists and names the never-changes list verbatim.

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

// Recursively collect .ts/.tsx files under a directory, skipping node_modules.
function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = readdirSync(join(process.cwd(), dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...walk(rel));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(rel);
    }
  }
  return out;
}

// The rankers the fence protects. lib/concierge/*.ts is enumerated at test time
// so a future concierge ranker seam is fenced the moment it lands.
const RANKERS: readonly string[] = [
  "lib/forYou.ts",
  "lib/nearMeAnswer.ts",
  ...walk("lib/concierge").filter((f) => f.endsWith(".ts")),
];

describe("sponsorship separation fence", () => {
  // (a) No ranker imports the rail or names a sponsorship token.
  for (const file of RANKERS) {
    it(`${file} never imports lib/sponsorship or names a sponsorship token`, () => {
      const source = read(file);
      expect(source.includes("lib/sponsorship"), `${file} imports the sponsorship rail`).toBe(false);
      expect(/sponsor/i.test(source), `${file} names a sponsorship token`).toBe(false);
    });
  }

  // (b) Component references to SponsoredPlacement must be accompanied by the
  // disclosure label export. Scoped to app/ and components/ (the render tree).
  const components = [...walk("app"), ...walk("components")];
  const placementRefs = components.filter((f) => read(f).includes("SponsoredPlacement"));

  it("every component that references SponsoredPlacement also references its disclosure label export", () => {
    for (const file of placementRefs) {
      const source = read(file);
      expect(
        source.includes("SPONSORED_DISCLOSURE_LABEL"),
        `${file} uses SponsoredPlacement but never references SPONSORED_DISCLOSURE_LABEL`,
      ).toBe(true);
    }
  });

  // (c) The policy doc exists and names the never-changes list verbatim.
  it("the policy doc names the never-changes list verbatim", () => {
    const doc = read("docs/SPONSORSHIP_POLICY.md");
    expect(doc).toContain(
      "organic ranking, eligibility, warnings, provenance, alternatives, or prices",
    );
  });
});
