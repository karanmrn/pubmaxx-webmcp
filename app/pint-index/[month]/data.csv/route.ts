import { publishedEditionToCsv } from "@/lib/pintIndex";
import { loadArchivedPintIndexMonth } from "@/lib/pintIndexSnapshot.server";

// The CSV of one frozen month, in the columns it was published with, and the
// snapshot_id column carries the edition's own id, so a spreadsheet saved from
// here still says which window it came from long after the live index moves on.
// The live export may grow a column; this one may not follow it without a
// correction, or an old citation would quietly resolve to a different schema.

type RouteContext = { params: Promise<{ month: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { month } = await context.params;
  const edition = await loadArchivedPintIndexMonth(month);
  if (!edition) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new Response(
    publishedEditionToCsv(edition),
    {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="london-pint-index-${month}.csv"`,
        // A frozen edition never changes, so it may be cached hard.
        "cache-control": "public, max-age=86400, s-maxage=604800, immutable",
      },
    },
  );
}
