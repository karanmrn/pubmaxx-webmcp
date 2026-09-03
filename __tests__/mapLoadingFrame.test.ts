// @vitest-environment jsdom

import { createElement, useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MapLoadingFrame from "@/components/map/MapLoadingFrame";
import MapLoadingSkeleton from "@/components/map/MapLoadingSkeleton";
import { useMapPinsRevealed } from "@/components/map/useMapPinsRevealed";
import { MAP_PIN_REVEAL_EVENT } from "@/lib/mapPinRevealEvent";
import { MAP_LOADING_SLOW_AFTER_MS } from "@/lib/mapLoadingCopy";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

function frame(): HTMLElement {
  const element = host.querySelector<HTMLElement>(".mapLoading");
  if (!element) throw new Error("held loading frame did not render");
  return element;
}

describe("the map's held loading frame", () => {
  it("names the city it is loading and stays quiet about the wait at first", () => {
    act(() => {
      root.render(
        createElement(MapLoadingFrame, { mapDisplayName: "Manchester", progress: 35 }),
      );
    });

    expect(frame().textContent).toContain("Loading Manchester pubs…");
    expect(frame().textContent).not.toContain("Still loading pubs…");
    expect(frame().getAttribute("aria-label")).toBe(
      "Loading the Manchester pub map.",
    );
  });

  // docs/VOICE.md lets the VISIBLE loading line carry a dry aside. The
  // ANNOUNCED name may not: a screen-reader user hears what is happening, not
  // the joke. Every labelled node in the rendered frame has to obey, not just
  // the outer one, and the sentence has to be built from the city it was
  // given rather than written down once.
  it.each(["London", "Manchester"])(
    "announces the %s load as a plain fact and nothing else",
    (city) => {
      act(() => {
        root.render(
          createElement(MapLoadingFrame, { mapDisplayName: city, progress: 12 }),
        );
      });

      const loadingLabels = Array.from(
        host.querySelectorAll<HTMLElement>("[aria-label]"),
      )
        .map((element) => element.getAttribute("aria-label") ?? "")
        .filter((label) => label.includes("Loading"));

      expect(loadingLabels).toEqual([`Loading the ${city} pub map.`]);
    },
  );

  // First paint waits on the basemap and the pin index, never on prices, so
  // the held frame may not say it is fetching them.
  it("never claims the wait is about tonight's prices", () => {
    act(() => {
      root.render(
        createElement(MapLoadingFrame, { mapDisplayName: "London", progress: 12 }),
      );
    });

    expect(frame().textContent).not.toContain("Fetching tonight");
  });

  it("admits the load is slow once the threshold passes", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        createElement(MapLoadingFrame, { mapDisplayName: "London", progress: 12 }),
      );
    });

    act(() => {
      vi.advanceTimersByTime(MAP_LOADING_SLOW_AFTER_MS - 1);
    });
    expect(host.querySelector(".mapLoadingSlow")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(host.querySelector(".mapLoadingSlow")?.textContent).toBe(
      "Still loading pubs…",
    );
  });

  // THE REGRESSION: the pill is a flex ROW, so the slow line shipped as a
  // third sibling of the eyebrow and the primary line and grew the pill a
  // third COLUMN at 390px instead of dropping under them. Every line the
  // frame prints has to live in the one stack the pill holds beside its dot.
  it("stacks every printed line inside one child of the pill", () => {
    vi.useFakeTimers();
    act(() => {
      root.render(
        createElement(MapLoadingFrame, { mapDisplayName: "London", progress: 12 }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(MAP_LOADING_SLOW_AFTER_MS);
    });

    const pill = host.querySelector<HTMLElement>(".mapLoadingCopy");
    const stack = host.querySelector<HTMLElement>(".mapLoadingLines");
    expect(Array.from(pill?.children ?? [])).toEqual([stack]);
    expect(
      Array.from(stack?.children ?? []).map((line) => line.textContent),
    ).toEqual(["London pub map", "Loading London pubs…", "Still loading pubs…"]);
  });

  it("draws the progress bar without announcing a second time", () => {
    act(() => {
      root.render(
        createElement(MapLoadingFrame, { mapDisplayName: "London", progress: 55 }),
      );
    });

    // The frame is one polite live region. A stepping progressbar inside it
    // would announce the same load again at every rung.
    expect(frame().getAttribute("aria-live")).toBe("polite");
    expect(host.querySelector('[role="progressbar"]')).toBeNull();

    const bar = host.querySelector<HTMLElement>(".mapLoadingProgress");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(
      host.querySelector<HTMLElement>(".mapLoadingProgressBar")?.style.width,
    ).toBe("55%");
  });
});

describe("the map's held skeleton", () => {
  function copy(): string {
    return host.querySelector<HTMLElement>(".mapSkeletonCopy")?.textContent ?? "";
  }

  // THE REGRESSION: the skeleton said "Loading London pubs…" over every city,
  // so /map/manchester read as London while its own map was still loading.
  it("names the city it was given", () => {
    act(() => {
      root.render(createElement(MapLoadingSkeleton, { cityDisplayName: "Manchester" }));
    });

    expect(copy()).toContain("Loading Manchester pubs…");
    expect(copy()).not.toContain("London");
  });

  it("stays cityless when nobody could tell it which map this is", () => {
    act(() => {
      root.render(createElement(MapLoadingSkeleton));
    });

    expect(copy()).toContain("Loading pubs…");
    expect(copy()).not.toContain("London");
  });
});

describe("useMapPinsRevealed", () => {
  const seen: boolean[] = [];
  let reset: () => void;

  function Probe() {
    const { pinsRevealed, resetPinReveal } = useMapPinsRevealed();
    reset = resetPinReveal;
    useEffect(() => {
      seen.push(pinsRevealed);
    }, [pinsRevealed]);
    return createElement("span", { "data-revealed": String(pinsRevealed) });
  }

  function revealed(): string | null {
    return host.querySelector("span")?.getAttribute("data-revealed") ?? null;
  }

  beforeEach(() => {
    seen.length = 0;
    act(() => {
      root.render(createElement(Probe));
    });
  });

  it("latches the canvas's painted-pin announcement", () => {
    expect(revealed()).toBe("false");

    act(() => {
      window.dispatchEvent(new CustomEvent(MAP_PIN_REVEAL_EVENT));
    });

    expect(revealed()).toBe("true");
  });

  // THE REGRESSION: the latch used to be one-shot, so a canvas re-init (Retry,
  // soft retry, context loss) tore the painted pins down while the parent still
  // read "revealed" and showed no loading chrome at all.
  it("drops the latch on reset and re-latches on the next paint", () => {
    act(() => {
      window.dispatchEvent(new CustomEvent(MAP_PIN_REVEAL_EVENT));
    });
    expect(revealed()).toBe("true");

    act(() => {
      reset();
    });
    expect(revealed()).toBe("false");

    act(() => {
      window.dispatchEvent(new CustomEvent(MAP_PIN_REVEAL_EVENT));
    });
    expect(revealed()).toBe("true");
  });
});
