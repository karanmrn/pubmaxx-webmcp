"use client";

// The persona card for an active "Drink like..." lens. Follows the venue-sheet
// idioms (role tokens, panel-raised surface, brass accents) and renders as a
// bottom-anchored sheet card at 390x844 and a side drawer card on desktop, both
// themes. Text + iconography only, never a likeness (PRD guardrail).
//
// Framing copy is always "reported favourite" (real people) or "as ordered in
// [work]" (fictional), and the fixed disclaimer ships on the surface. No em
// dashes anywhere.

import { ExternalLink, X } from "lucide-react";

import { DrinkGlyph } from "@/components/drinks/DrinkGlyph";
import { categoryLabel } from "@/lib/drinks";
import { PERSONA_DISCLAIMER, type PersonaDrink } from "@/lib/personaDrinks";

import "./personaLens.css";

type PersonaLensCardProps = {
  persona: PersonaDrink;
  /** Count of pubs currently matching the lens, for the pub-tie line. */
  matchCount?: number;
  onClose: () => void;
};

function framingLine(persona: PersonaDrink): string {
  if (persona.kind === "fictional") return `As ordered in ${persona.sourceName}`;
  return "Reported favourite";
}

export default function PersonaLensCard({
  persona,
  matchCount,
  onClose,
}: PersonaLensCardProps) {
  const hasIngredients = persona.ingredients.length > 0;
  return (
    <aside
      className="personaLensCard"
      aria-label={`Drink like ${persona.name}`}
    >
      <div className="personaLensCardHead">
        <span className="personaLensCardEyebrow">{framingLine(persona)}</span>
        <button
          type="button"
          className="personaLensCardClose"
          onClick={onClose}
          aria-label="Close persona lens"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="personaLensCardTitle">
        <DrinkGlyph category={persona.drinkCategory} size={30} />
        <div>
          <h2 className="personaLensCardName">{persona.name}</h2>
          <p className="personaLensCardKnownFor">{persona.knownFor}</p>
        </div>
      </div>

      <div className="personaLensCardDrink">
        <strong className="personaLensCardDrinkName">{persona.drink}</strong>
        <span className="personaLensCardCategory">
          {categoryLabel(persona.drinkCategory)}
        </span>
      </div>

      {typeof matchCount === "number" ? (
        <p className="personaLensCardPubTie">
          {matchCount === 0
            ? "No pubs on the map match this drink right now."
            : matchCount === 1
              ? "1 pub on the map pours it."
              : `${matchCount} pubs on the map pour it.`}
        </p>
      ) : null}

      {hasIngredients ? (
        <ul className="personaLensCardIngredients" aria-label="Ingredients">
          {persona.ingredients.map((ingredient) => (
            <li key={ingredient} className="personaLensCardIngredient">
              {ingredient}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="personaLensCardOrder">
        <span className="personaLensCardOrderLabel">How to order</span>
        {persona.howToOrder}
      </p>

      <p className="personaLensCardWhy">{persona.why}</p>

      <a
        className="personaLensCardSource"
        href={persona.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
      >
        {persona.sourceName}
        <ExternalLink size={13} aria-hidden="true" />
      </a>

      <p className="personaLensCardDisclaimer">{PERSONA_DISCLAIMER}</p>
    </aside>
  );
}
