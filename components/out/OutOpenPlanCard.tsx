import Link from "next/link";

import type { OutOpenPlan } from "@/lib/out";
import { crewPath } from "@/lib/socialCrewsUi";

function formatPlanWhen(startTime: string): string {
  if (!Number.isFinite(Date.parse(startTime))) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(startTime));
}

type OutOpenPlanCardProps = {
  plan: OutOpenPlan;
};

export function OutOpenPlanCard({ plan }: OutOpenPlanCardProps) {
  const when = formatPlanWhen(plan.startTime);
  const meet = plan.meetingPoint?.name ?? plan.stopVenueName ?? "Meeting point";
  return (
    <li className="outOpenPlanCard">
      <Link className="outOpenPlanLink pressable" href={crewPath(plan.crewId)}>
        <h3 className="outOpenPlanTitle">{plan.title}</h3>
        <p className="outOpenPlanMeta">
          @{plan.hostHandle}
          {when ? ` · ${when}` : ""}
        </p>
        <p className="outOpenPlanMeet">Meet at {meet}</p>
      </Link>
    </li>
  );
}
