import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const palChatCss = readFileSync(
  join(process.cwd(), "components/pal/palChat.css"),
  "utf8",
);
const palChatSource = readFileSync(
  join(process.cwd(), "components/pal/PalChat.tsx"),
  "utf8",
);

describe("pal chat mobile layout", () => {
  it("uses standard app navigation above the responsive chat surface", () => {
    expect(palChatSource).toContain('import SiteNav from "@/components/nav/SiteNav";');
    expect(palChatSource).toContain("<SiteNav />");
  });

  it("lets short transcripts end where content ends instead of stretching the scroll lane", () => {
    const palRoot = palChatCss.match(/\.palChat\s*{([^}]*)}/)?.[1] ?? "";
    const scroll = palChatCss.match(/\.palChatScroll\s*{([^}]*)}/)?.[1] ?? "";
    expect(palRoot).toMatch(/min-height:\s*100dvh/);
    expect(palRoot).not.toMatch(/(?:^|[^-])height:\s*100dvh/);
    expect(scroll).toMatch(/flex:\s*0\s+1\s+auto/);
    expect(scroll).not.toMatch(/flex:\s*1\s+1\s+auto/);
  });
});
