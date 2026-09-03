import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

describe("ESLint repository scope", () => {
  it("ignores nested Claude worktrees, including detached worktrees", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });

    await expect(
      eslint.isPathIgnored(
        path.resolve(".claude/worktrees/detached/app/page.tsx"),
      ),
    ).resolves.toBe(true);
    await expect(
      eslint.isPathIgnored(
        path.resolve(".claude/worktrees/agent-123/components/Card.tsx"),
      ),
    ).resolves.toBe(true);
  });

  it("keeps equivalent main-tree application files in lint scope", async () => {
    const eslint = new ESLint({ cwd: process.cwd() });

    await expect(eslint.isPathIgnored(path.resolve("app/page.tsx"))).resolves.toBe(
      false,
    );
    await expect(
      eslint.isPathIgnored(path.resolve("components/Card.tsx")),
    ).resolves.toBe(false);
  });
});
