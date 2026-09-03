import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import MapExperienceLens from "@/components/map/MapExperienceLens";
import TonightArcChips from "@/components/map/TonightArcChips";

describe("MapExperienceLens", () => {
  it("offers all, no-alcohol, and food views with selected state and status copy", () => {
    const html = renderToStaticMarkup(
      createElement(MapExperienceLens, {
        lens: "no-alcohol",
        summary:
          "No alcohol-free or soft drink prices logged here yet. Food venues still show sourced menu prices.",
        onChange: () => undefined,
      }),
    );

    expect(html).toContain(">All<");
    expect(html).toContain(">No alcohol<");
    expect(html).toContain(">Food<");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("No alcohol-free or soft drink prices logged here yet.");
  });

  it("ships 44px targets and wraps safely at 390px", () => {
    const css = readFileSync(
      join(process.cwd(), "components/map/mapExperienceLens.css"),
      "utf8",
    );
    expect(css).toMatch(/\.mapExperienceLensOption\s*{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.mapExperienceLensOptions\s*{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/\.mapExperienceLens\s*{[^}]*min-width:\s*0/);
  });

  it("removes pint-only controls while an experience view owns the map", () => {
    const pubMap = readFileSync(
      join(process.cwd(), "components/PubMap.tsx"),
      "utf8",
    );
    const toolbar = readFileSync(
      join(process.cwd(), "components/map/MapToolbar.tsx"),
      "utf8",
    );

    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\([\s\S]*?<DrinkShapeChips/,
    );
    expect(pubMap).toMatch(
      /activeLensPrices !== null\s*\?\s*\([\s\S]*?selectedLensPrice[\s\S]*?Unknown/,
    );
    // The peek is a single-row read of the same index the list and the sheet
    // report on, so it uses their helper rather than a fifth sentence that
    // could settle a partial or unread index as "none logged".
    expect(pubMap).toMatch(
      /selectedLensPrice\?\.categoryLabel \?\?\s*\n?\s*drinkLensUnknownRowLabel\(/,
    );
    expect(pubMap).not.toContain("No price logged");
    expect(pubMap).toContain("experienceLens={experienceLens}");
    expect(pubMap).toContain("drinkLensCategory={mapDrinkLensCategory}");
    expect(pubMap).toContain("drinkLensPriceNoun(mapDrinkLensCategory)");
    expect(pubMap).toContain(
      'drinkCategory={experienceLens === "all" ? filters.drinkCategory || null : null}',
    );
    expect(pubMap).toContain(
      "const mobileShellReady = !mapLoadingActive;",
    );
    expect(pubMap).toContain("food: true,");
    expect(pubMap).toContain("restaurant: true,");
    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\(\s*<TabsTrigger value="prices">/,
    );
    expect(pubMap).toMatch(
      /experienceLens === "all"\s*\?\s*\(\s*<TabsContent value="prices"/,
    );
    // The drink-shape control and the drink-lane picker beside it are both
    // pint-map controls, so an experience view owns the map without them. One
    // named derivation gates every one of them.
    expect(toolbar).toContain('const laneAvailable = experienceLens === "all";');
    expect(toolbar).toMatch(/laneAvailable \? \([\s\S]*?mapToolbarDrinksBtn/);
    expect(toolbar).toMatch(/laneOpen && laneAvailable \? \(/);
    const overview = readFileSync(
      join(
        process.cwd(),
        "components/map/inspector/VenueOverviewTab.tsx",
      ),
      "utf8",
    );
    expect(overview).toContain('experienceLens === "food"');
    expect(overview).toMatch(
      /!drinkLensCategory &&[\s\S]*?experienceLens !== "no-alcohol" \|\|[\s\S]*?venue\.kind === "food"[\s\S]*?<VenuePriceSummary/,
    );
    expect(overview).toMatch(
      /experienceLens === "all" && !drinkLensCategory\s*\?\s*\([\s\S]*?<VenuePriceThen/,
    );
  });

  it("keeps the inspector's no-alcohol empty state behind an answered read", () => {
    // Both no-alcohol empty states say the same sentence, so both owe the same
    // guard: "nothing logged here" is a fact about the pub and may not stand in
    // for a read still in flight or one that failed.
    const overview = readFileSync(
      join(process.cwd(), "components/map/inspector/VenueOverviewTab.tsx"),
      "utf8",
    );

    expect(overview).toContain(
      'communityPrices.venuePriceStatus.get(venue.id) ?? "idle"',
    );
    // The sentence itself lives with the section that prints it, and the tab
    // hands it that read rather than a settled boolean.
    expect(overview).toMatch(
      /<VenueDrinkPrices[\s\S]*?readStatus=\{venueReadStatus\}/,
    );
    const drinkPrices = readFileSync(
      join(process.cwd(), "components/map/VenueDrinkPrices.tsx"),
      "utf8",
    );
    expect(drinkPrices).toContain(
      "drinkLensEmptyVenueNote(laneNoun, readStatus)",
    );
    // And the no-alcohol view keeps the joined noun rather than naming one of
    // its two categories and hiding the other.
    expect(overview).toContain("? NO_ALCOHOL_LENS_PRICE_NOUN");

    const sheet = readFileSync(
      join(process.cwd(), "components/map/UnverifiedPubSheet.tsx"),
      "utf8",
    );
    expect(sheet).toContain('const pricesKnown = readStatus === "ready";');
    expect(sheet).toContain('const readFailed = readStatus === "degraded";');

    // The tab making the claim asks for the read itself. Inheriting it from
    // the pub-only submit card left every bar, food and restaurant venue in
    // the no-alcohol view sitting on a read that never started.
    const effect =
      "  useEffect(() => {\n    loadVenue(venue.id);\n  }, [loadVenue, venue.id]);";
    expect(overview).toContain(effect);
    expect(overview.indexOf(effect)).toBeLessThan(
      overview.indexOf("{isPubVenue(venue) ? ("),
    );
  });

  it("threads the drink lens into both sheets and names coffee, not no-alcohol", () => {
    const overview = readFileSync(
      join(process.cwd(), "components/map/inspector/VenueOverviewTab.tsx"),
      "utf8",
    );
    const sheet = readFileSync(
      join(process.cwd(), "components/map/UnverifiedPubSheet.tsx"),
      "utf8",
    );
    const inspector = readFileSync(
      join(process.cwd(), "components/map/VenueInspector.tsx"),
      "utf8",
    );
    const helpers = readFileSync(
      join(process.cwd(), "lib/mapExperienceLens.ts"),
      "utf8",
    );

    expect(inspector).toContain("drinkLensCategory={drinkLensCategory}");
    // The tab names the lens through the lane table, which routes every
    // category except the joined no-alcohol view to its own drink noun.
    expect(overview).toContain("drinkLaneNoun(leadLane)");
    expect(overview).toMatch(/<VenueDrinkPrices[\s\S]*?activeLane=\{leadLane\}/);
    expect(sheet).toContain("drinkLensCategory");
    expect(sheet).toContain(
      "drinkLensEmptyVenueNote(drinkLensNoun, readStatus)",
    );
    expect(sheet).toContain(
      "row.drinkCategory === drinkLensCategory",
    );
    // The experience noun is only for the joined no-alcohol view.
    expect(helpers).toContain('case "soft-drink":');
    expect(helpers).toContain('return "soft drink";');
    expect(helpers).toMatch(
      /Never return NO_ALCOHOL_LENS_PRICE_NOUN[\s\S]*drinkLensPriceNoun/,
    );
  });

  it("renames pubs for no-alcohol nights and keeps food view food-first", () => {
    const visibility = {
      pub: true,
      bar: true,
      food: true,
      restaurant: true,
    };
    const noAlcohol = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility,
        experienceLens: "no-alcohol",
        onChange: () => undefined,
      }),
    );
    expect(noAlcohol).toContain(">Pubs<");
    expect(noAlcohol).not.toContain(">Pints<");

    const food = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility,
        experienceLens: "food",
        onChange: () => undefined,
      }),
    );
    expect(food).toContain(">Food<");
    expect(food).toContain(">Restaurants<");
    expect(food).not.toContain(">Pints<");
    expect(food).not.toContain(">Bars<");
  });

  it("marks selected venue filters without colour and labels why Clubs is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(TonightArcChips, {
        visibility: {
          pub: true,
          bar: false,
          food: true,
          restaurant: false,
        },
        onChange: () => undefined,
      }),
    );
    const pints = html.match(/<button[^>]*aria-pressed="true"[^>]*>[\s\S]*?Pints[\s\S]*?<\/button>/)?.[0] ?? "";
    const bars = html.match(/<button[^>]*aria-pressed="false"[^>]*>[\s\S]*?Bars[\s\S]*?<\/button>/)?.[0] ?? "";

    expect(pints).toContain('class="tonightArcChip isOn"');
    expect(bars).toContain('class="tonightArcChip"');
    // The tick is the non-colour selection mark (design judgement 2026-08-01,
    // finding 2.1: selection reads without the accent). Decorative only —
    // aria-pressed carries the state.
    expect(pints).toContain('class="tonightArcChipTick" aria-hidden="true"');
    expect(bars).not.toContain("✓");
    expect(html).toContain('aria-label="Clubs are not mapped yet"');
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(">Clubs<");
    expect(html).not.toContain(">are not mapped yet<");
    expect(html).not.toContain("Wave 2");
    expect(html).not.toContain("arrives in");
  });
});
