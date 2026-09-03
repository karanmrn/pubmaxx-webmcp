"use client";

// Full-bleed photographic hero field with interactive alcohol-shaped pubs.
// Each marker is a DrinkGlyph (our IP) in a distinct drink category shape/colour,
// labelled in plain language so all ages can tap without guessing icons.
// Deep-links into the preferred (or default) city map via cityAwareMapPath.

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useSyncExternalStore } from "react";
import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import type { DrinkCategory } from "@/lib/drinks";
import { categoryLabel } from "@/lib/drinks";
import {
  readPreferredCity,
  subscribePreferredCity,
} from "@/lib/cityPreference";
import { cityAwareMapPath } from "@/lib/curatedCrawls";
import { warmMapRoute } from "@/lib/mapWarmup";

export type HeroPub = {
  id: string;
  category: DrinkCategory;
  /** Short place cue shown under the glyph (all-ages readability). */
  place: string;
  /** Percent positions inside the photo plane. */
  left: string;
  top: string;
  /** Map query params (drink filter / style). City comes from preference. */
  query: Record<string, string>;
};

const HERO_PUBS: HeroPub[] = [
  {
    id: "dove",
    category: "beer",
    place: "The Dove",
    left: "14%",
    top: "26%",
    // Beer is the map's rest lane. Naming a pub must not open the map as a
    // price-ranked arrival for that place. That reads as a live price claim.
    query: { drink: "beer" },
  },
  {
    id: "mayflower",
    category: "gin",
    place: "Mayflower",
    left: "36%",
    top: "64%",
    query: { drink: "gin", style: "balanced" },
  },
  {
    id: "cheese",
    category: "whisky",
    place: "Cheshire Cheese",
    left: "68%",
    top: "28%",
    query: { drink: "whisky", style: "heritage" },
  },
  {
    id: "prospect",
    category: "wine",
    place: "Prospect of Whitby",
    left: "82%",
    top: "68%",
    query: { drink: "wine", style: "dateNight" },
  },
  {
    id: "spritz",
    category: "cocktail",
    place: "Soho spritz",
    left: "52%",
    top: "16%",
    query: { drink: "cocktail", cocktails: "1" },
  },
  {
    id: "rum",
    category: "rum",
    place: "Dockside rum",
    left: "18%",
    top: "78%",
    query: { drink: "rum", style: "balanced" },
  },
];

function heroPubHref(
  query: Record<string, string>,
  preferredCity: ReturnType<typeof readPreferredCity>,
): string {
  return cityAwareMapPath(preferredCity, new URLSearchParams(query));
}

export default function ThamesHero() {
  const router = useRouter();
  const preferredCity = useSyncExternalStore(
    subscribePreferredCity,
    readPreferredCity,
    () => null,
  );
  const warmMap = useCallback(() => warmMapRoute(router), [router]);
  const mapWarmProps = {
    onPointerDown: warmMap,
    onPointerEnter: warmMap,
    onTouchStart: warmMap,
    onFocus: warmMap,
  };
  return (
    <div className="thamesHeroPhoto" role="region" aria-label="London pubs as drink shapes. Tap one to open the map">
      <Image
        className="thamesHeroImg"
        src="/landing/hero-night.jpg"
        alt=""
        fill
        priority
        sizes="(max-width: 920px) 100vw, 560px"
        quality={78}
      />
      <div className="thamesHeroScrim" aria-hidden="true" />
      {/* Warm basemap wash: decoration only, no live MapLibre and no map
          screenshot. Grounds the photo plane toward map truth. */}
      <div className="thamesHeroMapWash" aria-hidden="true" />
      <ul className="thamesHeroPins">
        {HERO_PUBS.map((pub, i) => {
          const href = heroPubHref(pub.query, preferredCity);
          return (
            <li
              key={pub.id}
              className="thamesHeroPin"
              style={{
                left: pub.left,
                top: pub.top,
                ["--pin-i" as string]: i,
              }}
            >
              <Link prefetch={false}
                href={href}
                className="thamesHeroPinLink"
                aria-label={`${categoryLabel(pub.category)} at ${pub.place}. Open on the map`}
                {...mapWarmProps}
              >
                <span className="thamesHeroPinGlyph" data-cat={pub.category}>
                  <DrinkGlyph category={pub.category} size={36} />
                </span>
                <span className="thamesHeroPinMeta">
                  <span className="thamesHeroPinCat">{categoryLabel(pub.category)}</span>
                  <span className="thamesHeroPinPlace">{pub.place}</span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { HERO_PUBS };
