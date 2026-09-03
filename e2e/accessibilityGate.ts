import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";

const BLOCKING_IMPACTS = new Set(["critical", "serious"]);

export async function runAccessibilityGate({
  page,
  testInfo,
  include,
  exclude,
}: {
  page: Page;
  testInfo: TestInfo;
  include?: string[];
  exclude?: string[];
}) {
  let builder = new AxeBuilder({ page });
  for (const selector of include ?? []) builder = builder.include(selector);
  for (const selector of exclude ?? []) builder = builder.exclude(selector);

  const results = await builder.analyze();
  await testInfo.attach("axe-results", {
    body: JSON.stringify(results, null, 2),
    contentType: "application/json",
  });

  const blocking = results.violations.filter((violation) =>
    BLOCKING_IMPACTS.has(violation.impact ?? ""),
  );
  if (blocking.length > 0) {
    throw new Error(
      `accessibility gate failed: ${blocking
        .map((violation) => `${violation.impact}:${violation.id}`)
        .join(", ")}`,
    );
  }

  return results;
}
