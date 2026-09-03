# Slice 5: Crew Chat retention

## Contract

Authorised members can read and send Crew Chat messages, report a message, and
receive private moderated attachments. Database owns 30-day expiry. Expired
content disappears before physical cleanup. A named case-specific legal hold
copies minimum evidence into a restricted table only.

## Seam

`SocialCrewChatStore` owns chat reads, writes, reports, cleanup claims, cleanup
finalisation, and legal holds. Database sets
`expires_at = created_at + interval '30 days'`. Reads require
`expires_at > now()`.

## RED cases

- One millisecond before expiry is readable. Exact expiry is absent.
- Expired content is absent from Crew and ordinary moderation reads.
- Cleanup removes body and signed attachment access.
- Cleanup racing insert cannot purge a new generation.
- Report queues review and never auto-hides.
- Legal hold retains only case evidence and never changes ordinary reads.
- Release makes held evidence purgeable.
- Block or friendship loss revokes new reads and sends.

## Playable checkpoint

Send, report, advance clock to exact expiry, and show empty Crew and ordinary
moderator lanes while the restricted held case keeps only allowed evidence.

## Verification

Run clock-bound PostgreSQL, storage cleanup, route, moderation, and legal tests.
Update privacy and terms in Slice 8 when final data shape lands.
