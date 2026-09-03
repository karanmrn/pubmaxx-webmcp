// The mark. Small, brass, and said the same way everywhere it appears.
//
// It is one component rather than a line of JSX on each surface because the
// profile card, the account hub and the founders wall all print the same fact,
// and three copies of that sentence would drift the moment one was edited.
//
// It is not a link, not a button, and it opens nothing. A reader who taps it
// gets nothing to open, because there is nothing behind a founding number: it
// says when somebody arrived and stops. See `lib/foundingMembers.ts`.

import {
  foundingMemberMark,
  foundingMemberMarkDetail,
} from "@/lib/foundingMembers";

import "./foundingMemberMark.css";

export default function FoundingMemberMark({
  number,
  className,
}: {
  number: number | null | undefined;
  className?: string;
}): React.JSX.Element | null {
  const mark = foundingMemberMark(number);
  if (!mark) return null;
  const detail = foundingMemberMarkDetail(number);
  // A span, not a paragraph: this mark sits inside a heading on the account hub
  // and inside a list row on the wall, and a block element in either is invalid
  // markup that browsers repair by moving it out of the thing it describes.
  return (
    <span
      className={className ? `foundingMark ${className}` : "foundingMark"}
      {...(detail ? { title: detail } : {})}
    >
      <span aria-hidden="true" className="foundingMarkDot" />
      <span className="foundingMarkLabel">{mark}</span>
    </span>
  );
}
