# Editorial overlay

Credited link-out picks for `/out` and `/tonight`. Not a harvest. Not a What's-On kind.

`latest.json` is written by `npm run editorial:poll` (`scripts/editorial/poll.mjs`). The rail reads that static file. This repo cannot run serverless cron for ingest, so a poll is a build or manual step. The poller currently checks 14 allowlisted feeds. Its private `poll-state.json` lives under `data/editorial/`, outside public assets.

## The hard rule

Store headline, canonical URL, publish time, a 240-character tag-stripped excerpt, and the publisher name. Never store `content:encoded` or Atom content. Never scrape HTML. Never invent a start time. Never imply PUBMAXX observed the event.

Allowlist lives in `lib/editorialRss.mjs`. ArtRabbit stays out.

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-08-27T12:00:00.000Z",
  "status": "ready", // or "degraded" when a feed could not be checked
  "items": [
    {
      "source_id": "leytonstoner",
      "title": "Point Taproom opens",
      "canonical_url": "https://leytonstoner.substack.com/p/point",
      "published_at": "2026-08-16T09:00:00.000Z",
      "excerpt": "A new tap in Leytonstone.",
      "attribution_label": "Leytonstoner"
    }
  ]
}
```

GLA rows (`gla-80117`) carry this linked attribution in the rail, not as a stored field: "Contains public sector information licensed under the Open Government Licence v3.0." The link is [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/). Poll state (`poll-state.json`) is gitignored.

## Snapshot freshness

`generatedAt` records the poll time. A `ready` snapshot older than 48 hours, or one stamped in the future, is stale at read time. The rail withholds its rows and says `Picks need a fresh check.` A valid ready snapshot with no current-week rows says `No picks this week.` A degraded snapshot says that picks could not be checked. These states must not be merged.

## Refresh

```
npm run editorial:poll        # due feeds only
npm run editorial:poll -- --all
```

UA is `PubmaxxBot/1.0 (+https://pubmaxxing.com)`. One request per feed per tick. If-Modified-Since. 24h backoff on 403/429. A 200 with zero items is degraded, not empty.
