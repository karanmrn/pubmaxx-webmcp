import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readApiJson } from "@/lib/apiErrorMessage";

describe("readApiJson", () => {
  it("does not parse a plain-text server refusal", async () => {
    const body = await readApiJson(
      new Response("Internal Server Error", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    expect(body).toBeNull();
  });

  it("keeps structured JSON refusal details for product copy", async () => {
    const body = await readApiJson(
      new Response(JSON.stringify({ error: "Plan saving is temporarily unavailable. Try again." }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(body).toEqual({ error: "Plan saving is temporarily unavailable. Try again." });
  });

  it("ignores malformed JSON instead of exposing parser text", async () => {
    const body = await readApiJson(
      new Response("{not-json", {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(body).toBeNull();
  });
});

describe("plan generation response guards", () => {
  it.each([
    "components/plan/PlanComposer.tsx",
    "components/plan/MobilePlanActivation.tsx",
  ])("checks the response before accepting generated stops in %s", (relativePath) => {
    const source = readFileSync(join(process.cwd(), relativePath), "utf8");
    const start = source.indexOf('fetch("/api/plans/generate"');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = source.indexOf("if (!response.ok", start);
    const generationPath = source.slice(start, end === -1 ? start + 1_500 : end + 120);

    expect(source).toMatch(/import \{[^}]*readApiJson[^}]*\} from "@\/lib\/apiErrorMessage"/);
    expect(generationPath).toContain("readApiJson(response)");
    expect(generationPath).not.toContain("response.json()");
    expect(source).toContain("errorMessageFrom");
  });
});
