// Host-facing invite card helpers (Wayfinder 4.2 UX). Pure formatting only —
// create/revoke stay on the existing collaboration store.

export function formatInviteExpiry(expiresAt: string, now: Date = new Date()): string {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return "Expiry unknown";
  const ms = end - now.getTime();
  if (ms <= 0) return "Expired";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `Expires in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `Expires in ${hours} h`;
  const days = Math.round(hours / 24);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export function invitePrivacyBlurb(): string {
  return "One-use private link. Until they join, guests see the inviter, broad area, time window, and vibe, never the full stop list.";
}
