// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    const { fill, priority, sizes, ...rest } = props;
    return createElement("img", rest);
  },
}));

import FirstRunOnboarding from "@/components/onboarding/FirstRunOnboarding";

let container: HTMLDivElement;
let root: Root | null = null;

function buttonContaining(text: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent?.includes(text));
  if (!button) throw new Error(`Button not found: ${text}`);
  return button;
}

beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(FirstRunOnboarding, { reviewedAreas: [{ name: "Clapham", transportAnchor: "Clapham North" }] }));
  });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container.remove();
  vi.clearAllMocks();
});

describe("first-run companion choice", () => {
  it("preselects robin and enables planning when companion step opens", async () => {
    await act(async () => {
      buttonContaining("Use London").click();
    });

    const robin = buttonContaining("Circuit Robin");
    const plan = buttonContaining("Plan my night");
    expect(robin.getAttribute("aria-pressed")).toBe("true");
    expect(plan.disabled).toBe(false);
    expect(container.querySelector('img[alt="Pub Pal"]')).not.toBeNull();

    await act(async () => {
      buttonContaining("Greyhound").click();
    });

    expect(robin.getAttribute("aria-pressed")).toBe("false");
    expect(buttonContaining("Greyhound").getAttribute("aria-pressed")).toBe("true");
    // The greyhound ships its own master, so the preview swaps the portrait
    // rather than keeping the robin's.
    const greyhoundImg = container.querySelector('img[alt="Pub Pal"]');
    expect(greyhoundImg?.getAttribute("src")).toContain("circuit-greyhound");
    expect(container.querySelector(".palRigGreyhound")).toBeNull();
  });
});
