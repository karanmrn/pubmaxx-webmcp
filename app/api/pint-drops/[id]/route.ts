import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { getPintDropById } from "@/lib/pintDropLookup";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { assertServerEnv } from "@/lib/serverEnv";

assertServerEnv();

// GET /api/pint-drops/[id] — the single public read behind a Pint Drop
// permalink. Returns the leak-proof PublicDrop DTO (getPintDropById selects only
// public columns and never surfaces a hidden/reported drop). 200 { drop } on a
// hit, 404 { error } for an unknown/hidden/absent id. Never leaks moderation
// state: a hidden id is indistinguishable from a missing one. Friends/legacy
// gating uses the JWT-derived viewer (same seam as /p/[id]).

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await resolveViewerContextFromRequest(
    request,
    new URL(request.url).searchParams.get("viewer"),
  );
  const drop = await getPintDropById(id, viewer);
  if (!drop) {
    return publicApiError("Pint drop not found.", "NOT_FOUND", 404);
  }
  return jsonNoStore({ drop });
}
