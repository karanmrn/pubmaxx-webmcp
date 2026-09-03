import { describe, it, expect } from "vitest";

import { GET } from "@/app/pint-index/data.csv/route";
import { LEAGUE_CSV_HEADER } from "@/lib/pintIndex";

// The checked-in public snapshot is deliberately empty until eligible evidence
// exists. The download must remain useful and honest: header only, no fallback
// to the legacy map dataset.
describe("GET /pint-index/data.csv", () => {
  it("returns a downloadable text/csv attachment", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="london-pint-index.csv"',
    );
    expect(res.headers.get("cache-control")).toContain("s-maxage");
  });

  it("emits a header-only public snapshot", async () => {
    const res = await GET();
    const body = await res.text();
    const lines = body.trimEnd().split("\r\n");
    expect(lines[0]).toBe(LEAGUE_CSV_HEADER.join(","));
    expect(lines).toEqual([LEAGUE_CSV_HEADER.join(",")]);
  });
});
