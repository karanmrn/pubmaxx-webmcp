"use client";

// Easter egg, console only. Anyone who opens dev tools on PUBMAXXING has gone
// looking under the floor, so they get the line a landlord gives you when you
// follow him down to change a barrel. Renders nothing, logs once per page
// load, and touches no product surface: no price, date, source or label is
// involved, so there is nothing here a joke could cheapen.
//
// Deliberately not console.warn/error: this must never look like a fault in a
// user's console, and it must never fire in tests or on the server.

import { useEffect } from "react";

export default function CellarNotice(): null {
  useEffect(() => {
    console.log(
      "%cPUBMAXXING",
      "font: 700 13px/1.4 ui-sans-serif, system-ui; letter-spacing: .14em",
      "\nYou found the cellar. Mind your head.",
    );
  }, []);

  return null;
}
