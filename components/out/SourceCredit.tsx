import { outSourceDisplayLabel } from "@/lib/out/attribution";
import type { WhatsOnSource } from "@/lib/whatsOn";

type SourceCreditProps = {
  source: WhatsOnSource;
};

/**
 * The credit beside a listing: the source's own NAME, linking to that source's
 * own page for this event.
 *
 * There is deliberately no mark here. Skiddle's credit is a licence obligation
 * that names a logo, and we do not hold Skiddle's asset - so the answer is to
 * ship no mark at all rather than a hand-drawn lookalike, which discharges
 * nothing and imitates another company's wordmark. The obligation stays
 * recorded (`logoRequired` is still true for Skiddle) and the lane it attaches
 * to is fenced off until the real asset lands: see SKIDDLE_BRAND_ASSET_PRESENT
 * in lib/whatson/eventNormalise.mjs, which both supply lanes read.
 *
 * The name itself comes from `outSourceDisplayLabel`, the one owner of how a
 * publisher is spelled, so a row's internal label ("common") is never the thing
 * a reader sees beside "Ticketmaster" and "Skiddle".
 */
export function SourceCredit({ source }: SourceCreditProps) {
  return (
    <a className="outSourceCredit" href={source.url} rel="noopener noreferrer" target="_blank">
      <span>{outSourceDisplayLabel(source.label)}</span>
    </a>
  );
}
