import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import MenuCategoryGrid from "@/components/drinks/MenuCategoryGrid";

type ButtonProps = {
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
};

function findEmptyAction(node: ReactNode): ReactElement<ButtonProps> | undefined {
  if (!isValidElement(node)) return undefined;

  const props = node.props as ButtonProps;
  if (node.type === "button" && props.className === "menuHubEmptyAction") {
    return node as ReactElement<ButtonProps>;
  }

  return Children.toArray(props.children)
    .map(findEmptyAction)
    .find((button) => button !== undefined);
}

describe("MenuCategoryGrid empty state", () => {
  it("keeps the drinks contribution action working beside a food link", () => {
    const onAddDrink = vi.fn();
    const props = {
      tiles: [
        {
          id: "food-external",
          kind: "food-external" as const,
          label: "Food menu",
          href: "https://pub.example/menu",
        },
      ],
      onOpenDrinks: vi.fn(),
      onAddDrink,
    };
    const tree = MenuCategoryGrid(props);
    const html = renderToStaticMarkup(tree);

    expect(html).toContain("We don’t have this pub’s drinks yet.");
    expect(html).toContain("Add what you’re drinking");
    expect(html).toContain('href="https://pub.example/menu"');
    expect(html).toContain("Food opens the pub’s own menu.");
    expect(html).not.toContain("Drinks first");
    expect(html).not.toContain("Tap a tile");

    findEmptyAction(tree)?.props.onClick?.();

    expect(onAddDrink).toHaveBeenCalledTimes(1);
  });
});
