import { permanentRedirect } from "next/navigation";

// next.config owns the direct route-family redirect. Keep this route-level
// fallback direct too, so no caller can encounter a redirect chain.
export default function DrinksRedirect() {
  permanentRedirect("/social?tab=discover");
}
