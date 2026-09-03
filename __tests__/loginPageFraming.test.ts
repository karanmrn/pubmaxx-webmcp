import { describe, expect, it } from "vitest";

import {
  LOGIN_FIRST_TIME_LEAD,
  LOGIN_FIRST_TIME_TITLE,
  loginPageHeadCopy,
  loginPageShowsSkeleton,
} from "@/lib/loginPageFraming";

const SIGNIN_DOOR = {
  title: "Welcome back",
  lead: "Your prices, plans and nights are on your account. Pick up where you left off.",
};

const SIGNUP_DOOR = {
  title: "Let's get you in",
  lead: "Log a pint price, plan a crawl, keep your nights. Takes a handle and a minute.",
};

describe("login page framing", () => {
  it("stays on the first-time line until the session is known", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: false,
        adding: false,
        signedIn: false,
        returning: false,
        intent: "signin",
        door: SIGNIN_DOOR,
      }),
    ).toEqual({
      title: LOGIN_FIRST_TIME_TITLE,
      lead: LOGIN_FIRST_TIME_LEAD,
    });
  });

  it("does not greet a known first-timer as if they had been here", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: true,
        adding: false,
        signedIn: false,
        returning: false,
        intent: "signin",
        door: SIGNIN_DOOR,
      }).title,
    ).toBe(LOGIN_FIRST_TIME_TITLE);
  });

  it("keeps the new-account door once the session is known", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: true,
        adding: false,
        signedIn: false,
        returning: false,
        intent: "signup",
        door: SIGNUP_DOOR,
      }),
    ).toEqual(SIGNUP_DOOR);
  });

  it("stands the card's shape up only where a card can arrive", () => {
    expect(
      loginPageShowsSkeleton({ sessionKnown: false, hasAuthSurface: true }),
    ).toBe(true);
    // Keyless build: the notice is the whole answer, so nothing may promise a
    // form that is never coming.
    expect(
      loginPageShowsSkeleton({ sessionKnown: false, hasAuthSurface: false }),
    ).toBe(false);
    expect(
      loginPageShowsSkeleton({ sessionKnown: true, hasAuthSurface: true }),
    ).toBe(false);
  });

  it("keeps Welcome back for a returning resume", () => {
    expect(
      loginPageHeadCopy({
        sessionKnown: true,
        adding: false,
        signedIn: false,
        returning: true,
        intent: "signin",
        door: SIGNIN_DOOR,
      }),
    ).toEqual(SIGNIN_DOOR);
  });
});
