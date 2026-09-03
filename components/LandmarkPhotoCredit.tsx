import type { LandmarkImage } from "@/lib/landmarks";
import { buildLandmarkCredit, type CreditLink } from "@/lib/landmarkCredit";

// Compliant Wikimedia Commons attribution for a landmark photo, rendered inside
// the figure's <figcaption>. CC-BY / CC-BY-SA require author + licence + a link
// back to the file page, so crediting the platform alone is not enough (see
// docs/IMAGE_RIGHTS_AUDIT_2026-07-21.md finding 2). Data stays plain per the
// taste doctrine: one compact line, "·" separators, no em dashes, no slang.
//
// The "which fields render" decision lives in lib/landmarkCredit (pure, tested);
// this component only turns that shape into the caption markup.
function Piece({ link }: { link: CreditLink }) {
  return link.href ? (
    <a href={link.href} target="_blank" rel="noreferrer">
      {link.text}
    </a>
  ) : (
    <span>{link.text}</span>
  );
}

export default function LandmarkPhotoCredit({ image }: { image: LandmarkImage }) {
  const credit = buildLandmarkCredit(image);

  if (credit.kind === "platform") {
    return (
      <figcaption>
        Photo · <Piece link={credit.via} />
      </figcaption>
    );
  }

  return (
    <figcaption>
      Photo: {credit.author}
      {credit.licence ? (
        <>
          {" "}
          · <Piece link={credit.licence} />
        </>
      ) : null}{" "}
      · via <Piece link={credit.via} />
    </figcaption>
  );
}
