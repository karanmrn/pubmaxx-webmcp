import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type QaCredentials = {
  handle: string;
  password: string;
};

function qaCredentials(): QaCredentials {
  const path = resolve(process.cwd(), ".e2e", "qa-credentials.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as QaCredentials;
  } catch {
    throw new Error("Missing .e2e/qa-credentials.json. Run npm run e2e:seed first.");
  }
}

test.setTimeout(90_000);

test("signs in through the real handle-password path and resolves /u/you", async ({
  page,
}) => {
  const credentials = qaCredentials();
  await page.goto("/login");
  await page.getByTestId("e2e-login-toggle").click();
  await page.getByTestId("e2e-login-handle").fill(credentials.handle);
  await page.getByTestId("e2e-login-password").fill(credentials.password);
  await page.getByTestId("e2e-login-submit").click();

  await expect(page.getByRole("heading", { name: "You are signed in" })).toBeVisible();
  await page.goto("/u/you");
  await expect(page).toHaveURL(/\/u\/e2e_qa(?:\?|$)/);
  await expect(page.getByText("@e2e_qa", { exact: true }).first()).toBeVisible();
});
