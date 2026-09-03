## Summary

<!-- What does this PR change, and why? -->

## Security checklist

- [ ] No new self-asserted-handle write path without `gateHandleAction` / JWT
- [ ] New `/api/*` routes use `assertServerEnv()` + `jsonNoStore` (no CORS allow-origin)
- [ ] Secrets stay out of client bundles / logs (`ADMIN_TOKEN`, service role, salts)
- [ ] Visibility / privacy: hidden or friends/legacy content cannot leak via feed, comments, reactions, notifications, or storage URLs
- [ ] Uploads (if any) go through magic-byte + EXIF strip seams
- [ ] Tests cover ownership denial and/or visibility gates for changed routes

## Test plan

- [ ] `npm run typecheck`
- [ ] Focused vitest suite(s) for touched routes/stores
- [ ] Vercel CI green
