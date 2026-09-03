// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { "data-testid": "auth-provider" }, children),
}));

vi.mock("@/components/auth/ConfiguredClerkTree", () => ({
  default: function MockConfiguredClerkTree({ children }: { children: React.ReactNode }) {
    return createElement("div", { "data-testid": "clerk-tree" }, children);
  },
}));

const { default: OptionalClerkProvider } = await import(
  "@/components/auth/OptionalClerkProvider"
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderProvider() {
  act(() => {
    root.render(
      createElement(
        OptionalClerkProvider,
        {
          clerkIntegrationConfigured: true,
          appearance: undefined,
        },
        createElement("main", { "data-testid": "product-surface" }, "Map chrome"),
      ),
    );
  });
}

describe("OptionalClerkProvider", () => {
  it("paints product children on the first client render before Clerk loads", () => {
    renderProvider();

    expect(container.querySelector("[data-testid='auth-provider']")).not.toBeNull();
    expect(container.querySelector("[data-testid='product-surface']")).not.toBeNull();
    expect(container.textContent).toContain("Map chrome");
    expect(container.querySelector("[data-testid='clerk-tree']")).toBeNull();
  });

  it("wraps product children in Clerk after the chunk resolves", async () => {
    renderProvider();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='clerk-tree']")).not.toBeNull();
    expect(container.querySelector("[data-testid='product-surface']")).not.toBeNull();
  });
});
