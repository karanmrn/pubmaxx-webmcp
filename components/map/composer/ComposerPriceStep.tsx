import { useId } from "react";
import { Minus, Plus } from "lucide-react";

import { formatPriceChipGbp, stepPrice } from "@/lib/spill";
import type { PintDropsState } from "@/components/map/usePintDrops";

type ComposerPriceStepProps = {
  dropForm: PintDropsState["dropForm"];
  setDropForm: PintDropsState["setDropForm"];
  priceQuickAdds: number[];
  lastKnownPrice: number | null;
};

// ── The price step (price-first door) ───────────────────────────────────────
// The FIRST thing the composer shows: what the pint cost, then the drink. The
// venue is already chosen by the sheet, so a price is enterable in one tap on
// a chip. Everything else in the composer is optional and lives behind the
// extras disclosure in PintDropComposer.
export function ComposerPriceStep({
  dropForm,
  setDropForm,
  priceQuickAdds,
  lastKnownPrice,
}: ComposerPriceStepProps) {
  const priceInputId = useId();
  const drinkInputId = useId();

  return (
    <div className="spillPriceStep" data-testid="spill-price-step">
      <div className="priceField">
        <label className="priceFieldLabel" htmlFor={priceInputId}>
          What did it cost?
        </label>
        <div className="priceStepper">
          <button
            type="button"
            className="priceStepBtn"
            aria-label="Decrease price by 10 pence"
            onClick={() => setDropForm({ ...dropForm, price: stepPrice(dropForm.price, -1) })}
          >
            <Minus size={15} />
          </button>
          <input
            id={priceInputId}
            value={dropForm.price}
            onChange={(event) => setDropForm({ ...dropForm, price: event.target.value })}
            placeholder="£"
            inputMode="decimal"
          />
          <button
            type="button"
            className="priceStepBtn"
            aria-label="Increase price by 10 pence"
            onClick={() => setDropForm({ ...dropForm, price: stepPrice(dropForm.price, 1) })}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="priceQuickAdds" role="group" aria-label="Quick-add price">
          {priceQuickAdds.map((price) => {
            const label = formatPriceChipGbp(price);
            const selected = dropForm.price === label;
            const isLastKnown =
              typeof lastKnownPrice === "number" && formatPriceChipGbp(lastKnownPrice) === label;
            return (
              <button
                key={price}
                type="button"
                className={selected ? "priceChip stampChip selected" : "priceChip stampChip"}
                onClick={() => setDropForm({ ...dropForm, price: label })}
                title={isLastKnown ? "This pub's last logged price" : undefined}
                aria-pressed={selected}
              >
                £{label}
                {isLastKnown ? <span className="priceChipTag">last</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <label className="spillTextField" htmlFor={drinkInputId}>
        <span className="spillFieldLabel">Drink</span>
        <input
          id={drinkInputId}
          value={dropForm.drink}
          onChange={(event) => setDropForm({ ...dropForm, drink: event.target.value })}
          placeholder="Pint, half, soda, guest ale"
        />
      </label>
    </div>
  );
}
