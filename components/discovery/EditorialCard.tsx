import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

// A single editorial discovery card: an <article> with a real, followable link
// into /map or /crawls. Prop-driven and presentational — the copy and hrefs are
// authored on the /discover page. Kept accessible: the heading names the piece,
// and the call-to-action is a genuine anchor (not an onClick div).

export type EditorialCardData = {
  id: string;
  eyebrow: string;
  title: string;
  dek: string;
  href: string;
  cta: string;
};

export default function EditorialCard({ eyebrow, title, dek, href, cta }: EditorialCardData) {
  return (
    <article className="editorialCard" data-reveal>
      <p className="editorialEyebrow">{eyebrow}</p>
      <h3 className="editorialTitle">{title}</h3>
      <p className="editorialDek">{dek}</p>
      <Link href={href} className="editorialLink pressable">
        {cta}
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}
