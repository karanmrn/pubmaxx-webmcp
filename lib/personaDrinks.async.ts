// Lazy persona drink dataset — keeps data/persona_drinks.json out of the eager
// map shell until a persona lens is selected or restored from session.

import type { PersonaDrink } from "@/lib/personaDrinks";
import { MAP_LENS_DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";

type PersonaModule = typeof import("@/lib/personaDrinks");

let personaModule: PersonaModule | null = null;
let personaModulePromise: Promise<PersonaModule> | null = null;

export async function loadPersonaDrinksModule(): Promise<PersonaModule> {
  if (personaModule) return personaModule;
  if (!personaModulePromise) {
    personaModulePromise = import("@/lib/personaDrinks")
      .then((mod) => {
        personaModule = mod;
        return mod;
      })
      .catch((error) => {
        personaModulePromise = null;
        throw error;
      });
  }
  return personaModulePromise;
}

export async function findPersonaByIdAsync(
  id: string,
): Promise<PersonaDrink | null> {
  const mod = await loadPersonaDrinksModule();
  return mod.findPersonaById(id);
}

export function personaHighlightsPubs(persona: { drinkCategory: DrinkCategory }): boolean {
  return MAP_LENS_DRINK_CATEGORIES.includes(persona.drinkCategory);
}
