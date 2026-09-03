const NEW_RESERVED_CONTRIBUTOR_HANDLES = [
  "nikhil",
  "tiffany",
  "karanmanoharan",
  "karanszn",
  "karanm",
  "karanmrn",
  "kai",
  "janaki",
  "manoharan",
] as const;

export const EXPECTED_RESERVED_CONTRIBUTOR_HANDLES = [
  "karan",
  "sarah",
  "carol",
  "erin",
  ...NEW_RESERVED_CONTRIBUTOR_HANDLES,
] as const;

export const NEW_RESERVED_CONTRIBUTOR_HANDLE_INPUTS = [
  ...NEW_RESERVED_CONTRIBUTOR_HANDLES,
  "Nikhil",
  " tiffany ",
  "TIFFANY",
] as const;

export const RESERVED_CONTRIBUTOR_HANDLE_INPUTS = [
  ...EXPECTED_RESERVED_CONTRIBUTOR_HANDLES,
  "Nikhil",
  " tiffany ",
  "TIFFANY",
] as const;
