// The one public contact address for PUBMAXXING — press, privacy requests,
// data-rights requests, and anything else a reader needs to reach a human on.
//
// ONE constant on purpose: /privacy, /terms and /about (including the
// Organization JSON-LD) all read it, so moving to a company inbox later is a
// single-line change with no page left quoting a dead address. Only put an
// address here that is actually monitored — a privacy notice that names an
// inbox nobody reads is worse than no address at all.
export const CONTACT_EMAIL = "karanszdy@gmail.com";

/** `mailto:` href for the same address, so callers never rebuild the string. */
export const CONTACT_MAILTO = `mailto:${CONTACT_EMAIL}`;
