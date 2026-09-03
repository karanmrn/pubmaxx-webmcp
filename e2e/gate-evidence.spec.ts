import { expect, test } from "@playwright/test";
import { samplePagePerformance } from "./gateEvidence";

test("performance samples use fresh pages and time selector visibility", async ({ context }) => {
  const initialPages = context.pages().length;
  const html = encodeURIComponent(`
    <!doctype html>
    <html lang="en">
      <head><title>Performance fixture</title></head>
      <body>
        <script>
          setTimeout(() => {
            const ready = document.createElement("main");
            ready.id = "useful";
            ready.textContent = "Useful state";
            document.body.appendChild(ready);
          }, 50);
        </script>
      </body>
    </html>
  `);

  const samples = await samplePagePerformance({
    context,
    url: `data:text/html;charset=utf-8,${html}`,
    samples: 2,
    usefulSelector: "#useful",
  });

  expect(samples).toHaveLength(2);
  expect(context.pages()).toHaveLength(initialPages);
  for (const sample of samples) {
    expect(sample.usefulState).not.toBeNull();
    expect(sample.usefulState!).toBeGreaterThanOrEqual(40);
    expect(sample.usefulState!).toBeLessThan(400);
  }
});

test("performance helper rejects an empty sample count", async ({ context }) => {
  await expect(
    samplePagePerformance({ context, url: "data:text/html,fixture", samples: 0 }),
  ).rejects.toThrow("samples must be a positive integer");
});
