import { expect, test } from "@playwright/test";

const ADMIN_TOKEN = process.env.PW_E2E_ADMIN_TOKEN ?? "pubmax-e2e-admin-token";

test("anonymous GET /admin is a 401, and the moderator console never paints", async ({
  page,
  request,
}) => {
  // The credential answer itself: a refusal status, and no redirect to the
  // drinker door. Next serves the unauthorized boundary as a 401 document
  // whose body hydrates the token form, so the status is asserted over HTTP
  // and the surface is asserted in the browser below.
  const res = await request.get("/admin", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
  expect(res.headers()["location"]).toBeUndefined();

  const navigation = await page.goto("/admin");
  expect(navigation?.status()).toBe(401);
  await expect(
    page.getByRole("heading", { name: "Moderator sign-in", level: 1 }),
  ).toBeVisible();
  await expect(page.getByLabel("Admin token")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open console" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Admin sections" })).toHaveCount(
    0,
  );
});

test("a moderator session cookie opens /admin", async ({
  baseURL,
  page,
  request,
}) => {
  const login = await request.post("/api/admin/session", {
    data: { token: ADMIN_TOKEN },
  });
  expect(login.ok()).toBeTruthy();
  // The cookie is Secure under `next start` while the baseURL is http, so the
  // request context's jar may drop it. Replay it by hand: the point is the
  // cookie lane, not Playwright's storage rules.
  const setCookie = login
    .headersArray()
    .filter((header) => header.name.toLowerCase() === "set-cookie")
    .map((header) => header.value.split(";")[0]?.trim())
    .filter((pair): pair is string => Boolean(pair))
    .join("; ");
  expect(setCookie).toContain("pubmax_admin_session=");
  const res = await request.get("/admin", { headers: { cookie: setCookie } });
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("admin-tabs");
  expect(body).not.toContain("Moderator sign-in");

  const [name, value] = setCookie.split("=");
  await page.context().addCookies([
    {
      name: name ?? "pubmax_admin_session",
      value: value ?? "",
      url: baseURL ?? "http://localhost:3100",
    },
  ]);
  const navigation = await page.goto("/admin");
  expect(navigation?.status()).toBe(200);
  await expect(
    page.getByRole("tablist", { name: "Admin sections" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Moderator sign-in" }),
  ).toHaveCount(0);
});
