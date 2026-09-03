import { useEffect, useMemo, useState } from "react";

import type { Venue } from "@/lib/venues";
import DrinkMenu from "@/components/drinks/DrinkMenu";
import FoodMenu from "@/components/food/FoodMenu";
import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";
import VenueActionStrip from "@/components/map/VenueActionStrip";
import { venueMenuForInspector } from "@/lib/venueMenu";
import { venueFoodMenuForInspector } from "@/lib/venueFoodMenu";
import {
  loadDrinkPriceUpdates,
  loadFoodPriceUpdates,
} from "@/lib/priceUpdatesLoader";
import type { DrinkPriceUpdate } from "@/lib/drinkPriceUpdates";
import type { FoodPriceUpdate } from "@/lib/foodPriceUpdates";
import { menuHubTiles } from "@/lib/menuHub";
import type { DrinkCategory } from "@/lib/drinks";
import type { TabKey } from "@/lib/venueInspectorTabs";

/** The Drinks tab prints menu and website links, never a booking CTA. */
const BOOKING_ONLY_ON_OVERVIEW = ["book"] as const;

export default function VenueMenuTab({
  venue,
  tab,
  onAddDrink,
}: {
  venue: Venue;
  tab: TabKey;
  onAddDrink?: () => void;
}) {
  // Observed price-update overlays, fetched once per session as data instead of
  // being bundled into the map chunk (~3 MB of JSON — see priceUpdatesLoader).
  // The menu renders its seed/app-dataset rows immediately; the overlay applies
  // when the fetch resolves (usually before the sheet finishes opening).
  const [drinkUpdates, setDrinkUpdates] = useState<DrinkPriceUpdate[]>([]);
  const [foodUpdates, setFoodUpdates] = useState<FoodPriceUpdate[]>([]);
  useEffect(() => {
    let cancelled = false;
    void loadDrinkPriceUpdates().then((updates) => {
      if (!cancelled && updates.length > 0) setDrinkUpdates(updates);
    });
    void loadFoodPriceUpdates().then((updates) => {
      if (!cancelled && updates.length > 0) setFoodUpdates(updates);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The Menu tab's full drink list (beer from venue.prices + seeded non-beer
  // drinks) — see lib/venueMenu.ts for the composition seam.
  const menuDrinks = useMemo(
    () => venueMenuForInspector(venue, drinkUpdates),
    [venue, drinkUpdates],
  );
  const menuFood = useMemo(
    () => venueFoodMenuForInspector(venue, foodUpdates),
    [venue, foodUpdates],
  );
  const hubTiles = useMemo(() => menuHubTiles(venue, menuDrinks), [venue, menuDrinks]);
  // Reset when the venue changes so a drinks drill-in never leaks across venues.
  type MenuView =
    | { mode: "hub" }
    | { mode: "drinks"; category?: DrinkCategory };
  const [menuView, setMenuView] = useState<MenuView>({ mode: "hub" });
  const [menuViewVenueId, setMenuViewVenueId] = useState(venue.id);
  if (menuViewVenueId !== venue.id) {
    setMenuViewVenueId(venue.id);
    setMenuView({ mode: "hub" });
  }

  return (
    <div
      role="tabpanel"
      id="venuePanel-menu"
      aria-labelledby="venueTab-menu"
      className="venueTabPanel"
      hidden={tab !== "menu"}
    >
      {menuView.mode === "hub" ? (
        <>
          {/* Booking lives on Overview only (finding 2.16). */}
          <VenueActionStrip venue={venue} omitKinds={BOOKING_ONLY_ON_OVERVIEW} />
          <MenuCategoryGrid
            tiles={hubTiles}
            venueKind={venue.kind}
            onAddDrink={onAddDrink}
            onOpenDrinks={(category) =>
              setMenuView(
                category ? { mode: "drinks", category } : { mode: "drinks" },
              )
            }
          />
          <FoodMenu items={menuFood} venueName={venue.name} />
        </>
      ) : (
        <DrinkMenu
          drinks={menuDrinks}
          venueName={venue.name}
          venueId={venue.id}
          categoryFilter={menuView.category}
          onBack={() => setMenuView({ mode: "hub" })}
          backLabel="Menus"
        />
      )}
    </div>
  );
}
