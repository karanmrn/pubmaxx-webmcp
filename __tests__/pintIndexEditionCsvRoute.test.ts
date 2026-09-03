import { describe, it, expect } from "vitest";

import { GET } from "@/app/pint-index/[month]/data.csv/route";
import { LEAGUE_CSV_HEADER, PUBLISHED_EDITION_CSV_HEADER } from "@/lib/pintIndex";
import { listPintIndexArchiveMonths } from "@/lib/pintIndexSnapshot.server";

const request = new Request("https://pubmaxxing.com/pint-index/2026-06/data.csv");
const params = (month: string) => ({ params: Promise.resolve({ month }) });

// The schema every published edition went out with, written here as the bytes
// themselves rather than derived from the module. A published edition is
// written once, which is why a citation to one still resolves to the same file
// a year later, so widening its CSV needs a deliberate edit to this literal and
// a correction note beside it - never a column that arrived for the live export
// and reached the frozen months on the way past.
const PUBLISHED_EDITION_HEADER_AS_PUBLISHED =
  "borough_code,borough,tracked_pubs,average_pint_gbp,cheapest_pint_gbp," +
  "cheapest_pint_pub,dearest_pint_gbp,observation_start,observation_end,snapshot_id";

describe("GET /pint-index/[month]/data.csv", () => {
  it("serves a published month as a named, hard-cacheable download", async () => {
    const [month] = await listPintIndexArchiveMonths();
    expect(month, "at least one dated edition is published").toBeTruthy();

    const res = await GET(request, params(month));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain(`filename="london-pint-index-${month}.csv"`);
    // A frozen month never changes, so the CSV may be cached as immutable.
    expect(res.headers.get("cache-control")).toContain("immutable");

    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe(PUBLISHED_EDITION_HEADER_AS_PUBLISHED);
  });

  it("serves every published month in the schema it was published with", async () => {
    // Byte-for-byte, on every edition, so a column added to the live export
    // cannot shift observation_start, observation_end and snapshot_id along for
    // a reader who already parses one of these files by position.
    expect(PUBLISHED_EDITION_CSV_HEADER.join(",")).toBe(PUBLISHED_EDITION_HEADER_AS_PUBLISHED);
    const months = await listPintIndexArchiveMonths();
    expect(months.length).toBeGreaterThan(0);
    for (const month of months) {
      const body = await (await GET(request, params(month))).text();
      const [header, ...rows] = body.trimEnd().split("\r\n");
      expect(header, `${month} must keep its published columns`).toBe(
        PUBLISHED_EDITION_HEADER_AS_PUBLISHED,
      );
      // The cells follow the header rather than a wider table's row shape. A
      // quoted field may hold a comma of its own, so only plain rows are counted.
      for (const row of rows.filter((line) => !line.includes('"'))) {
        expect(row.split(",").length).toBe(PUBLISHED_EDITION_CSV_HEADER.length);
      }
    }
  });

  it("lets the live export carry a column an edition does not", async () => {
    // The two schemas are allowed to differ, and the difference only ever runs
    // one way: live gains first, a frozen month follows through a correction.
    expect(LEAGUE_CSV_HEADER).toContain("dearest_pint_pub");
    expect(PUBLISHED_EDITION_CSV_HEADER).not.toContain("dearest_pint_pub");
    expect(PUBLISHED_EDITION_CSV_HEADER).toEqual(
      LEAGUE_CSV_HEADER.filter((column) => column !== "dearest_pint_pub"),
    );
  });

  it("404s an unpublished or malformed month rather than inventing one", async () => {
    expect((await GET(request, params("1999-01"))).status).toBe(404);
    expect((await GET(request, params("2026-13"))).status).toBe(404);
    expect((await GET(request, params("../../etc/passwd"))).status).toBe(404);
  });
});
