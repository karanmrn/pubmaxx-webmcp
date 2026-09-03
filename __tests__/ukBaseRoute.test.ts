import { promises as fs } from "fs";
import path from "path";

import { beforeEach, describe, expect, it } from "vitest";

import { GET } from "@/app/api/uk-base/[id]/route";
import { resetUkBaseIndexForTests } from "@/lib/ukBaseIndex";
import { parseUkBaseManifest, ukBaseIdFor } from "@/lib/ukBasePubs";

async function firstCommittedId(): Promise<string> {
  const manifestRaw = await fs.readFile(
    path.join(process.cwd(), "public", "data", "uk_base", "manifest.json"),
    "utf8",
  );
  const manifest = parseUkBaseManifest(JSON.parse(manifestRaw));
  if (!manifest) throw new Error("Committed UK base manifest is malformed");
  const shardRaw = await fs.readFile(
    path.join(process.cwd(), "public", manifest.shards[0].url.replace(/^\//, "")),
    "utf8",
  );
  const shard = JSON.parse(shardRaw) as { pubs: Array<[string, ...unknown[]]> };
  return ukBaseIdFor(shard.pubs[0][0]);
}

beforeEach(() => {
  resetUkBaseIndexForTests();
});

describe("GET /api/uk-base/[id]", () => {
  it("returns a committed base pub", async () => {
    const id = await firstCommittedId();
    const res = await GET(new Request(`http://localhost/api/uk-base/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pub: { id: string; name: string } };
    expect(body.pub.id).toBe(id);
    expect(body.pub.name.length).toBeGreaterThan(0);
  });

  it("404s a well-formed id the pack does not carry", async () => {
    const id = "venue-uk-n0000000000";
    const res = await GET(new Request(`http://localhost/api/uk-base/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(404);
  });

  it("400s a curated venue id", async () => {
    const id = "venue-7l4pei";
    const res = await GET(new Request(`http://localhost/api/uk-base/${id}`), {
      params: Promise.resolve({ id }),
    });
    expect(res.status).toBe(400);
  });
});
