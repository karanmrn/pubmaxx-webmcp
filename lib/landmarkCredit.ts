import type { LandmarkImage } from "@/lib/landmarks";

// Pure builder for a landmark photo's Commons attribution line. Kept out of the
// component so it is hermetically testable in the node test env (no DOM), and so
// the "which fields are present" decision lives in one audited place.
//
// CC-BY / CC-BY-SA require author + licence + a link back to the file page.
// Crediting only the platform ("Wikimedia Commons") is NOT compliant, so a photo
// with author metadata renders the full line; one without falls back to the bare
// platform credit (still linked to the file page when known). A public-domain
// file has a licence name but no licence URL, so the licence is rendered as
// plain text rather than a link.

export type CreditLink = { text: string; href?: string };

export type LandmarkCredit =
  | {
      // Full, compliant attribution: author + optional licence + file-page link.
      kind: "attributed";
      author: string;
      licence: CreditLink | null;
      via: CreditLink;
    }
  | {
      // No author on record yet: honest platform-only credit.
      kind: "platform";
      via: CreditLink;
    };

export function buildLandmarkCredit(image: LandmarkImage): LandmarkCredit {
  const via: CreditLink = image.sourcePageUrl
    ? { text: image.credit, href: image.sourcePageUrl }
    : { text: image.credit };

  if (!image.author) {
    return { kind: "platform", via };
  }

  const licence: CreditLink | null = image.licenseShortName
    ? image.licenseUrl
      ? { text: image.licenseShortName, href: image.licenseUrl }
      : { text: image.licenseShortName }
    : null;

  return { kind: "attributed", author: image.author, licence, via };
}
