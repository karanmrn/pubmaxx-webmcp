-- Extend the closed drink taxonomy with coffee as its own price lane.
-- A coffee is not a soft drink and must not collapse into "other". Keep these
-- CHECK constraints aligned with lib/drinks.ts.

alter table public.drinks
  drop constraint if exists drinks_category_check;

alter table public.drinks
  add constraint drinks_category_check
  check (category in (
    'beer',
    'wine',
    'whisky',
    'gin',
    'vodka',
    'rum',
    'cocktail',
    'shot',
    'alcohol-free',
    'soft-drink',
    'coffee',
    'other'
  ));

alter table public.community_prices
  drop constraint if exists community_prices_category_check;

alter table public.community_prices
  add constraint community_prices_category_check
  check (drink_category in (
    'beer',
    'wine',
    'whisky',
    'gin',
    'vodka',
    'rum',
    'cocktail',
    'shot',
    'alcohol-free',
    'soft-drink',
    'coffee',
    'other'
  ));
