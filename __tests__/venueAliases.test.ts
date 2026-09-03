import { afterEach, describe, it, expect } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import {
  lookupCanonicalVenueId,
  resolveCanonicalVenueId,
  resetVenueAliasesForTests,
  setVenueAliasesPathForTests,
} from "@/lib/venueAliases";

async function writeAliasFile(doc: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "venue-aliases-"));
  const file = path.join(dir, "venue_id_aliases.json");
  await fs.writeFile(file, JSON.stringify(doc));
  return file;
}

afterEach(() => {
  resetVenueAliasesForTests();
});

describe("resolveCanonicalVenueId", () => {
  it("maps a merged duplicate id to its canonical id", async () => {
    const file = await writeAliasFile({
      version: 1,
      aliases: { "venue-dupe1": "venue-canon", "venue-dupe2": "venue-canon" },
    });
    setVenueAliasesPathForTests(file);

    expect(await resolveCanonicalVenueId("venue-dupe1")).toBe("venue-canon");
    expect(await resolveCanonicalVenueId("venue-dupe2")).toBe("venue-canon");
  });

  it("returns the id unchanged when it has no alias", async () => {
    const file = await writeAliasFile({ aliases: { "venue-dupe1": "venue-canon" } });
    setVenueAliasesPathForTests(file);

    expect(await resolveCanonicalVenueId("venue-canon")).toBe("venue-canon");
    expect(await resolveCanonicalVenueId("venue-unknown")).toBe("venue-unknown");
    expect(await resolveCanonicalVenueId("")).toBe("");
  });

  it("ignores self-maps and non-string targets", async () => {
    const file = await writeAliasFile({
      aliases: { "venue-self": "venue-self", "venue-bad": 42, "venue-ok": "venue-canon" },
    });
    setVenueAliasesPathForTests(file);

    expect(await resolveCanonicalVenueId("venue-self")).toBe("venue-self");
    expect(await resolveCanonicalVenueId("venue-bad")).toBe("venue-bad");
    expect(await resolveCanonicalVenueId("venue-ok")).toBe("venue-canon");
  });

  it("degrades to an identity map when the alias file is missing", async () => {
    setVenueAliasesPathForTests(path.join(os.tmpdir(), "does-not-exist-venue-aliases.json"));
    expect(await resolveCanonicalVenueId("venue-anything")).toBe("venue-anything");
    expect(await lookupCanonicalVenueId("venue-anything")).toEqual({ status: "unavailable" });
  });

  it("recovers once a previously-missing alias file is created (no cached-empty poisoning)", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "venue-aliases-late-"));
    const file = path.join(dir, "venue_id_aliases.json");
    setVenueAliasesPathForTests(file);

    // First call hits a missing file — must resolve to identity, and must NOT
    // cache the failure so a later, successful read still counts.
    expect(await resolveCanonicalVenueId("venue-dupe1")).toBe("venue-dupe1");

    await fs.writeFile(
      file,
      JSON.stringify({ aliases: { "venue-dupe1": "venue-canon" } }),
    );

    expect(await resolveCanonicalVenueId("venue-dupe1")).toBe("venue-canon");
  });
});
