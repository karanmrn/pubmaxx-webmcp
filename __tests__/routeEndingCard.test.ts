import { createElement, Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_ROUTE_ENDINGS,
  RouteEndingCard,
  type RouteEndingId,
} from "@/components/night/RouteEndingCard";

type ButtonProps = {
  children?: ReactNode;
  onClick?: () => void;
};

function findButtons(node: ReactNode): Array<ReactElement<ButtonProps>> {
  if (!isValidElement(node)) return [];

  const props = node.props as ButtonProps;
  const ownButton = node.type === "button" ? [node as ReactElement<ButtonProps>] : [];
  return [...ownButton, ...Children.toArray(props.children).flatMap(findButtons)];
}

describe("RouteEndingCard", () => {
  it("renders the three crawl ending choices", () => {
    const html = renderToStaticMarkup(
      createElement(RouteEndingCard, { onChoose: vi.fn() }),
    );

    expect(html.match(/class="routeEndingCard__choice"/g)).toHaveLength(3);
    expect(html).toContain("Find food");
    expect(html).toContain("Get home");
    expect(html).toContain("Keep going");
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Choose how to finish"');
    expect(html).toContain('type="button"');
  });

  it("marks one recommendation without selecting or executing it", () => {
    const onChoose = vi.fn<(ending: RouteEndingId) => void>();
    const html = renderToStaticMarkup(
      createElement(RouteEndingCard, { onChoose }),
    );

    expect(html.match(/data-recommended="true"/g)).toHaveLength(1);
    expect(html).toContain('data-ending="get_home"');
    expect(html).toContain("Recommended");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("aria-checked");
    expect(html).not.toContain("aria-selected");
    expect(onChoose).not.toHaveBeenCalled();
  });

  it("fires the ending callback only when a choice is activated", () => {
    const onChoose = vi.fn<(ending: RouteEndingId) => void>();
    const tree = RouteEndingCard({ onChoose });
    const buttons = findButtons(tree);

    expect(buttons).toHaveLength(DEFAULT_ROUTE_ENDINGS.length);
    expect(onChoose).not.toHaveBeenCalled();

    buttons[2]?.props.onClick?.();

    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose).toHaveBeenCalledWith("keep_going");
  });
});
