# Account Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give signed-in PUBMAXX accounts one account-settings surface for password management, private details, and notifications, with server-side old-password verification for changes.

**Architecture:** Keep password creation in the signed-in browser and keep Supabase Auth as the only password writer. Add one authenticated verification route that checks the caller's own verified email through the existing `signInWithEmailPassword` seam, rate-limit that check, and let the browser call `updateUser` only after verification. Make `PubmaxxAccountHub` render a clearly labelled account-settings group, remove private details from public profile editing, and keep one live mount of each account-plumbing editor.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth, Vitest, Chrome DevTools AXI.

## Global Constraints

- Password creation stays signed-in only and uses `supabase.auth.updateUser({ password })`.
- Password change requires current password, new password, and confirmation.
- Current-password failure uses one generic error and never identifies a field.
- Verification attempts are rate-limited server-side.
- `lib/passwordPolicy.ts` remains the only password creation policy source.
- No password or email is logged or persisted by the new route.
- Private details and password management each have one live mount on the profile page.
- Use the existing profile tab idiom and keep profile-content editing separate from account settings.
- Do not modify generated files or `CHANGELOG.md`.

---

### Task 1: Lock server-side current-password verification

**Files:**
- Create: `app/api/auth/change-password/verify/route.ts`
- Create: `__tests__/changePasswordVerifyRoute.test.ts`
- Modify: `lib/handlePasswordSignIn.ts` only if a small same-account helper is required

**Interfaces:**
- Consumes: `Authorization: Bearer <caller JWT>`, JSON `{ currentPassword: string }`.
- Produces: `POST /api/auth/change-password/verify` with `{ verified: true }` on success, one generic 401 response on bad credentials, and 429 after the verification budget is exhausted.

- [ ] **Step 1: Write the failing route tests.** Test that a verified caller's own email is passed to `signInWithEmailPassword`, that bad or missing current passwords return the same generic 401, that a caller cannot supply an account identity in the body, and that the limiter blocks the sign-in seam.

```ts
it("verifies the caller's own current password through the existing password seam", async () => {
  callerAuth.mockResolvedValue({ id: "user-1", email: "owner@example.com", createdAt: null });
  passwordGrant.mockResolvedValue({ access_token: "access", refresh_token: "refresh" });

  const response = await POST(request({ currentPassword: "Oldpass1!" }));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ verified: true });
  expect(passwordGrant).toHaveBeenCalledWith("owner@example.com", "Oldpass1!");
});

it("uses one generic failure for wrong, short, and missing current passwords", async () => {
  callerAuth.mockResolvedValue({ id: "user-1", email: "owner@example.com", createdAt: null });
  passwordGrant.mockResolvedValue(null);

  const responses = await Promise.all([
    POST(request({ currentPassword: "Wrongpass1!" })),
    POST(request({ currentPassword: "short" })),
    POST(request({})),
  ]);

  expect(new Set(responses.map((response) => response.status))).toEqual(new Set([401]));
  expect(await responses[0].json()).toEqual(await responses[1].json());
  expect(await responses[1].json()).toEqual(await responses[2].json());
});
```

- [ ] **Step 2: Run the route tests and confirm the intended red failure.**

Run: `npm test -- __tests__/changePasswordVerifyRoute.test.ts`

Expected: FAIL because the route does not exist yet.

- [ ] **Step 3: Implement the smallest route.** Resolve identity only from `callerAuthIdentity(request)`, reject cross-site requests, apply an IP plus caller rate limit with `isLimited`, pass only the verified caller email to `signInWithEmailPassword`, and return the generic API error for every credential failure. Do not return the temporary session from the password grant.

- [ ] **Step 4: Run the route tests and the existing handle-password tests.**

Run: `npm test -- __tests__/changePasswordVerifyRoute.test.ts __tests__/handlePasswordSignIn.test.ts __tests__/handlePasswordRoute.test.ts`

Expected: PASS with no credential values in response bodies or logs.

### Task 2: Make the password form distinguish create from change

**Files:**
- Modify: `components/auth/SetAccountPassword.tsx`
- Modify: `__tests__/setAccountPassword.test.ts`

**Interfaces:**
- Consumes: `POST /api/auth/change-password/verify` for existing-password accounts.
- Produces: Existing create flow unchanged for `hasPassword === false`; existing-password flow renders current, new, and confirmation fields and calls `updateUser` only after server verification.

- [ ] **Step 1: Add failing source tests for the old-password contract and create-flow fence.** Assert the current-password input and verification route appear only in the change branch, `updateUser` remains present, and create mode has no current-password field.

```ts
it("requires current password before changing an existing password", () => {
  expect(setPasswordSource).toContain('autoComplete="current-password"');
  expect(setPasswordSource).toContain("/api/auth/change-password/verify");
  expect(setPasswordSource).toContain("currentPassword");
  expect(setPasswordSource).toContain("Could not verify your current password. Try again.");
});

it("keeps password creation free of an old-password field", () => {
  expect(setPasswordSource).toContain('hasPassword === true');
  expect(setPasswordSource).toContain('hasPassword === false');
  expect(setPasswordSource).toMatch(/hasPassword === true[\s\S]*current-password/);
});
```

- [ ] **Step 2: Run the focused source tests and confirm the intended red failure.**

Run: `npm test -- __tests__/setAccountPassword.test.ts`

Expected: FAIL because the current-password field and verification call are absent.

- [ ] **Step 3: Implement the client red-green change.** Add `currentPassword` state. In change mode, require it before the shared new-password policy and confirmation checks. Call the verification route with `authedFetch` and drain failed response bodies. On any non-OK verification response, show one generic current-password message and do not call `updateUser`. On success, call `supabase.auth.updateUser({ password })`. Clear all password fields after success. Render the current-password input only when `hasPassword === true`; keep the existing create copy and fields otherwise.

- [ ] **Step 4: Run the password and policy tests.**

Run: `npm test -- __tests__/setAccountPassword.test.ts __tests__/passwordPolicy.test.ts __tests__/passwordPolicyHint.test.ts`

Expected: PASS, including the no-password create path and policy ticks.

### Task 3: Move account-plumbing controls into one settings section

**Files:**
- Modify: `components/profile/PubmaxxAccountHub.tsx`
- Modify: `app/u/[handle]/ProfilePageClient.tsx`
- Modify: `app/u/[handle]/profile.css`
- Modify: `__tests__/setAccountPassword.test.ts`
- Modify: `__tests__/privateIdentityEditor.test.ts` only if a mount fence belongs there

**Interfaces:**
- Consumes: Existing `PrivateIdentityEditor`, `SetAccountPassword`, `StepOutNudgePref`, and analytics controls.
- Produces: One `Account settings` heading/section containing password, private details, notifications, and analytics; public profile editing contains only public profile fields and linked socials.

- [ ] **Step 1: Add the failing single-mount and section tests.** Read the relevant source files and assert exactly one `PrivateIdentityEditor` mount and exactly one `SetAccountPassword` mount across the profile surface, the tab links to `#account-settings`, and the account hub contains an `Account settings` heading with the notifications control.

```ts
it("mounts account-plumbing editors exactly once", () => {
  const page = read("app/u/[handle]/ProfilePageClient.tsx");
  const hub = read("components/profile/PubmaxxAccountHub.tsx");
  const privateMounts = `${page}\n${hub}`.match(/<PrivateIdentityEditor\s*\/>/g) ?? [];
  const passwordMounts = `${page}\n${hub}`.match(/<SetAccountPassword\s*\/>/g) ?? [];
  expect(privateMounts).toHaveLength(1);
  expect(passwordMounts).toHaveLength(1);
  expect(page).toContain('href="#account-settings"');
  expect(hub).toContain("Account settings");
  expect(hub).toContain("<StepOutNudgePref />");
});
```

- [ ] **Step 2: Run the mount tests and confirm the intended red failure.**

Run: `npm test -- __tests__/setAccountPassword.test.ts`

Expected: FAIL because the private editor currently appears in both the profile editor and account hub, and the settings section has no explicit heading.

- [ ] **Step 3: Remove the private editor from `ProfilePageClient`'s public profile-editing surface.** Remove its import and JSX wrapper. Keep profile editor fields and social links unchanged.

- [ ] **Step 4: Restructure `PubmaxxAccountHub`.** Keep handle, founding, referral, Night Profile, memories, and account onboarding content in the account hub. Add one labelled `section` or `div` for `Account settings` containing exactly one `PrivateIdentityEditor`, exactly one `SetAccountPassword`, exactly one `StepOutNudgePref`, and the existing analytics controls. Keep the controls in the existing account card idiom and avoid duplicate helper copy.

- [ ] **Step 5: Update the profile tab label and responsive styles.** Use `Account settings` for the existing `#account-settings` tab target. Style the new group as a clear raised section, keep two columns on desktop, collapse to one column below the existing breakpoint, and preserve keyboard-visible focus and 44px controls.

- [ ] **Step 6: Run focused UI tests and inspect the source counts.**

Run: `npm test -- __tests__/setAccountPassword.test.ts __tests__/privateIdentityEditor.test.ts __tests__/profileRichRender.test.ts`

Expected: PASS with one live copy of each editor and no private editor in public profile editing.

### Task 4: Validate, review, and ship

**Files:**
- Modify: `docs/superpowers/plans/2026-08-11-account-settings.md` only if the final implementation differs materially from this plan

- [ ] **Step 1: Run lint and typecheck.**

Run: `npm run lint && npm run typecheck`

Expected: exit 0.

- [ ] **Step 2: Run one full test suite within the validation budget.**

Run: `npm test`

Expected: exit 0. Do not run another full suite; use focused tests for any repair.

- [ ] **Step 3: Browser-verify both viewports with Chrome DevTools AXI.** Start the app using the repository's standard command if needed. Check desktop and phone widths for the tab, account-settings heading, password/private-details/notifications sections, and absence of a second private-details or password copy. For an existing-password account, confirm current-password, new-password, and confirm fields. For a no-password account, confirm no current-password field.

- [ ] **Step 4: Run the review closeout pass.** Read and apply `refactor-clean`, `code-review`, and `write-docs` in that order. Check `git diff`, generated-file churn, and the single-mount fence before committing.

- [ ] **Step 5: Commit, rebase on fresh `origin/main`, push only the feature branch, and open the PR.**

```bash
git add app/api/auth/change-password/verify/route.ts components/auth/SetAccountPassword.tsx components/profile/PubmaxxAccountHub.tsx 'app/u/[handle]/ProfilePageClient.tsx' 'app/u/[handle]/profile.css' lib/handlePasswordSignIn.ts __tests__/changePasswordVerifyRoute.test.ts __tests__/setAccountPassword.test.ts __tests__/privateIdentityEditor.test.ts docs/superpowers/plans/2026-08-11-account-settings.md
git commit -m "feat: add account settings password management"
git fetch origin main
git rebase origin/main
git push -u origin fm/feature-account-settings
gh-axi pr create --base main --head fm/feature-account-settings --title "feat: add account settings password management" --body-file <pr-body-file>
```

Expected: committed branch, pushed feature branch, and PR URL returned by `gh-axi`.
