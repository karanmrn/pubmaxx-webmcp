import "server-only";

// The server-only door onto the Context.dev wrapper.
//
// The implementation lives in `lib/contextDev.ts` because a plain-node CLI
// (scripts/whatson/eventsRefresh.mjs, through lib/events/contextDevProvider.ts)
// has to import it, and the `server-only` marker package THROWS on import
// outside a React Server Component. App code imports THIS module, so a client
// component that reaches for the key path is still a build error.

export * from "@/lib/contextDev";
