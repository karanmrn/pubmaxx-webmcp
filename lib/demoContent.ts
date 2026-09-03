// Kill switch for DEMO content (seeded pint drops, ambient presence counts).
//
// Demo seeds bootstrapped the product's surfaces while no real users existed,
// and every seeded row is labelled DEMO in the UI. But for a launch built on
// data honesty, seeded liveness ("2 spilling right now") is a credibility
// risk the moment real users arrive — so the seams below let the owner turn
// ALL demo content off with one env flip, without touching the seed data.
//
// Default is ON (unchanged behavior) until `NEXT_PUBLIC_DEMO_CONTENT=off` is
// set. The flag is a public build-time env because the seeds render on both
// server and client surfaces and must agree.
export function demoContentEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_CONTENT !== "off";
}
