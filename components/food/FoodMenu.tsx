import { formatPrice } from "@/lib/venues";
import PriceBadge from "@/components/PriceBadge";
import {
  foodCategoryColor,
  groupFoodByCategory,
  type FoodCategory,
  type FoodItem,
  type FoodProvenance,
} from "@/lib/food";

import "@/components/drinks/drinkMenu.css";

function provenanceLabel(prov: FoodProvenance): string {
  if (prov.source === "seed" || prov.source.toLowerCase().includes("demo")) return "Demo";
  return prov.source;
}

function isDemoProvenance(prov: FoodProvenance): boolean {
  return prov.source === "seed" || prov.source.toLowerCase().includes("demo");
}

function ProvChip({ prov }: { prov: FoodProvenance }) {
  const label = provenanceLabel(prov);
  const kind = isDemoProvenance(prov) ? "demo" : "sourced";
  return (
    <span className={`drinkProvChip ${kind}`} title={`${prov.source} · ${prov.licence}`}>
      {label}
    </span>
  );
}

function FoodRow({ item }: { item: FoodItem }) {
  const dietary =
    item.dietary && item.dietary.length > 0
      ? item.dietary.map((d) => d.replace("-", " ")).join(" · ")
      : "";
  return (
    <li className="drinkRow">
      <div className="drinkRowMain">
        <span className="drinkName">{item.name}</span>
        {item.description ? <span className="drinkMeta">{item.description}</span> : null}
        {dietary ? <span className="drinkServing">{dietary}</span> : null}
      </div>
      <div className="drinkRowSide">
        <PriceBadge variant="neutral" className="drinkPrice">
          {formatPrice(item.priceGbp)}
        </PriceBadge>
        <ProvChip prov={item.provenance} />
      </div>
    </li>
  );
}

function CategorySection({
  category,
  label,
  items,
}: {
  category: FoodCategory;
  label: string;
  items: FoodItem[];
}) {
  const accent = foodCategoryColor(category);
  return (
    <section
      className="drinkCategory"
      style={{ ["--cat-accent" as string]: accent }}
      aria-labelledby={`food-cat-${category}`}
    >
      <h4 className="drinkCategoryTitle" id={`food-cat-${category}`}>
        <span className="drinkCategoryDot" aria-hidden="true" />
        {label}
      </h4>
      <ul className="drinkList">
        {items.map((item) => (
          <FoodRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}

export type FoodMenuProps = {
  items: FoodItem[];
  venueName?: string;
};

export default function FoodMenu({ items, venueName }: FoodMenuProps) {
  const groups = groupFoodByCategory(items);

  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="drinkMenu" aria-label={venueName ? `Food at ${venueName}` : "Food menu"}>
      <h3 className="drinkCategoryTitle" style={{ marginBottom: 4 }}>
        Food
      </h3>
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          category={group.category}
          label={group.label}
          items={group.items}
        />
      ))}
      <p className="drinkMenuFootnote">
        Every dish carries its source · Prices from first-party menus, not a live till feed.
      </p>
    </div>
  );
}
