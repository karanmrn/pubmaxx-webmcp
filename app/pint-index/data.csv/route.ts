import { leagueTableToCsv, LEAGUE_CSV_HEADER } from "@/lib/pintIndex";
import { loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";

export async function GET(): Promise<Response> {
  const snapshot = await loadPublicPintIndexSnapshot();
  // With no snapshot the download is the header alone, read from the same
  // column table the rows come from, so an empty export can never advertise a
  // schema the populated one does not have.
  const csv = snapshot
    ? leagueTableToCsv(snapshot)
    : `${LEAGUE_CSV_HEADER.join(",")}\r\n`;
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="london-pint-index.csv"',
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
