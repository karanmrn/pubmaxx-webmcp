"use client";

// The one way into the founders wall from inside the app.
//
// ONE component, shared by Social and by You, because the two would otherwise
// each own a label and drift. It reads NOTHING about the viewer: whether the
// reader holds a number may not decide whether this renders, or a founding
// number would be a capability, which lib/foundingMembers.ts forbids in the
// same sentence it forbids a perk.
//
// It carries no count. "6 of 100 taken" belongs on the wall, where it is a
// record; on a link it would be the hurry-up this model exists to refuse.

import Link from "next/link";

import {
  FOUNDERS_WALL_HREF,
  FOUNDERS_WALL_LINK_LABEL,
} from "@/lib/foundingMembers";

import "./foundersWallLink.css";

export default function FoundersWallLink({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <Link
      className={["foundersWallLink", className].filter(Boolean).join(" ")}
      href={FOUNDERS_WALL_HREF}
    >
      {FOUNDERS_WALL_LINK_LABEL}
    </Link>
  );
}
