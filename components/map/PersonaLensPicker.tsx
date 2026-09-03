"use client";

// "Drink like..." persona picker for the map's drink layer controls.
//
// Rides the existing drink-category filter path: selecting a persona hands the
// parent a PersonaDrink; the parent sets filters.drinkCategory to the persona's
// mapped category (so filterVenues + pubsToGeoJSON light the matching pins with
// zero new pin pipeline) and records the active persona for the card.
//
// Searchable, grouped person/fictional, fits-tonight-first (a quiet tag). Text
// and iconography only, never a likeness (PRD guardrail). No em dashes.

import { GlassWater, Search, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { DrinkCategory } from "@/lib/drinks";
import {
  buildPersonaPickerListEntries,
  stepPersonaPickerActiveIndex,
} from "@/lib/personaLensPickerA11y";
import {
  buildPersonaPickerSections,
  loadPersonaDrinks,
  personaFitsCategory,
  type PersonaDrink,
} from "@/lib/personaDrinks";

import "./personaLens.css";

type PersonaLensPickerProps = {
  /** The active persona id, or null when the lens is off. */
  personaId: string | null;
  /** Selecting a persona, or null to clear the lens. */
  onSelect: (persona: PersonaDrink | null) => void;
  /** The DrinkCategory that fits tonight, for the fits-tonight sort/tag. */
  tonightCategory: DrinkCategory | null;
};

function PersonaLensOption({
  id,
  className,
  highlighted,
  selected,
  onHover,
  onPick,
  children,
}: {
  id: string;
  className: string;
  highlighted: boolean;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      id={id}
      type="button"
      role="option"
      aria-selected={selected}
      className={highlighted ? `${className} isHighlighted` : className}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      {children}
    </button>
  );
}

export default function PersonaLensPicker({
  personaId,
  onSelect,
  tonightCategory,
}: PersonaLensPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const activeIndexRef = useRef(-1);
  const [activeIndex, setActiveIndex] = useState(-1);

  const personas = useMemo(() => loadPersonaDrinks(), []);
  const active = useMemo(
    () => personas.find((p) => p.id === personaId) ?? null,
    [personas, personaId],
  );
  const sections = useMemo(
    () => buildPersonaPickerSections({ personas, query, tonightCategory }),
    [personas, query, tonightCategory],
  );
  const listEntries = useMemo(
    () =>
      buildPersonaPickerListEntries({
        sections,
        includeClear: Boolean(active),
      }),
    [active, sections],
  );

  const entryIndexByPersonaId = useMemo(() => {
    const map = new Map<string, number>();
    listEntries.forEach((entry, index) => {
      if (entry.kind === "persona") map.set(entry.persona.id, index);
    });
    return map;
  }, [listEntries]);

  const chooseActiveIndex = useCallback((next: number) => {
    activeIndexRef.current = next;
    setActiveIndex(next);
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    setQuery("");
    chooseActiveIndex(-1);
    triggerRef.current?.focus({ preventScroll: true });
  }, [chooseActiveIndex]);

  const choose = useCallback(
    (persona: PersonaDrink | null) => {
      onSelect(persona);
      setOpen(false);
      setQuery("");
      chooseActiveIndex(-1);
      triggerRef.current?.focus({ preventScroll: true });
    },
    [chooseActiveIndex, onSelect],
  );

  const activateEntry = useCallback(
    (index: number) => {
      const entry = listEntries[index];
      if (!entry) return;
      if (entry.kind === "clear") choose(null);
      else choose(entry.persona);
    },
    [choose, listEntries],
  );

  const optionId = useCallback((index: number) => `${listId}-opt-${index}`, [listId]);
  const safeActive =
    activeIndex >= 0 && activeIndex < listEntries.length ? activeIndex : -1;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) closePanel();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closePanel();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePanel, open]);

  const handleSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const eventActive =
        activeIndexRef.current >= 0 && activeIndexRef.current < listEntries.length
          ? activeIndexRef.current
          : -1;
      if (event.key === "ArrowDown" && listEntries.length > 0) {
        event.preventDefault();
        chooseActiveIndex(stepPersonaPickerActiveIndex(eventActive, 1, listEntries.length));
        return;
      }
      if (event.key === "ArrowUp" && listEntries.length > 0) {
        event.preventDefault();
        chooseActiveIndex(stepPersonaPickerActiveIndex(eventActive, -1, listEntries.length));
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        if (eventActive < 0) return;
        event.preventDefault();
        activateEntry(eventActive);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closePanel();
      }
    },
    [activateEntry, chooseActiveIndex, closePanel, listEntries.length],
  );

  const handleQueryChange = useCallback(
    (next: string) => {
      chooseActiveIndex(-1);
      setQuery(next);
    },
    [chooseActiveIndex],
  );

  return (
    <div className="personaLensPicker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={active ? "personaLensTrigger isActive" : "personaLensTrigger"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <GlassWater size={15} aria-hidden="true" />
        <span className="personaLensTriggerLabel">
          {active ? active.name : "Drink like..."}
        </span>
      </button>
      {active ? (
        <button
          type="button"
          className="personaLensClear"
          aria-label="Clear persona lens"
          onClick={() => choose(null)}
        >
          <X size={13} aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div className="personaLensPanel">
          <div className="personaLensSearch">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={query}
              autoFocus
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
              aria-label="Search personas by name or drink"
              onChange={(event) => handleQueryChange(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search people or drinks"
            />
          </div>

          <div className="personaLensList" id={listId} role="listbox" aria-label="Personas">
            {active ? (
              <PersonaLensOption
                id={optionId(0)}
                className="personaLensOption personaLensOptionClear"
                highlighted={safeActive === 0}
                selected={false}
                onHover={() => chooseActiveIndex(0)}
                onPick={() => choose(null)}
              >
                Clear selection
              </PersonaLensOption>
            ) : null}

            {sections.length === 0 ? (
              <p className="personaLensEmpty">No personas match that search.</p>
            ) : null}

            {sections.map((section) => (
              <div key={section.kind} className="personaLensGroup">
                <p className="personaLensGroupLabel">{section.label}</p>
                {section.personas.map((persona) => {
                  const index = entryIndexByPersonaId.get(persona.id);
                  if (index === undefined) return null;
                  const fits = personaFitsCategory(persona, tonightCategory);
                  const selected = persona.id === personaId;
                  return (
                    <PersonaLensOption
                      key={persona.id}
                      id={optionId(index)}
                      className={
                        selected ? "personaLensOption isSelected" : "personaLensOption"
                      }
                      highlighted={safeActive === index}
                      selected={selected}
                      onHover={() => chooseActiveIndex(index)}
                      onPick={() => choose(persona)}
                    >
                      <span className="personaLensOptionName">{persona.name}</span>
                      <span className="personaLensOptionMeta">
                        {persona.drink}
                        {fits ? (
                          <span className="personaLensFitsTag">
                            <Sparkles size={11} aria-hidden="true" />
                            fits tonight
                          </span>
                        ) : null}
                      </span>
                    </PersonaLensOption>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
