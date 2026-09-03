# Pub crawl baseline proof - 2026-08-11

Production build passed before changes. Server used the keyless planning flags from `AGENTS.md`, including friend-member rehydration. Browser checks used 390px and 1440px viewports.

| Surface | Result | Evidence |
| --- | --- | --- |
| `/plan` describe-first | `crawl in Camden for 5` generated 3 distinct grounded venues. `for 5` correctly meant group size 5. | [390 initial](screenshots/crawl-baseline/01-plan-describe-390.png), [390 generated](screenshots/crawl-baseline/14-plan-3-stops-correct-390.png), [1440 initial](screenshots/crawl-baseline/23-plan-describe-1440.png), [1440 generated](screenshots/crawl-baseline/25-plan-3-stops-1440.png) |
| Stop swap | Stop 1 changed to `The Oxford Arms`; status announced the change. | [390](screenshots/crawl-baseline/15-plan-swap-390.png) |
| Stop removal | Draft fell to 2 stops and `Lock it in` stayed disabled. | [390](screenshots/crawl-baseline/16-plan-remove-390.png) |
| Host share | Share page showed 3 numbered stops, route link, invite link, WhatsApp, copy, and new-link controls. | [390](screenshots/crawl-baseline/17-plan-share-host-390.png), [1440](screenshots/crawl-baseline/26-plan-share-1440.png) |
| Map route | Build mode showed 3 mapped stops, 2 walking legs, total distance/time, and the active crawl. Stop 1 opened its detail sheet with `In plan`; the route panel listed all three stops. | [390 map](screenshots/crawl-baseline/19-map-route-panel-390.png), [1440 map](screenshots/crawl-baseline/28-map-route-panel-1440.png) |
| `/crawls` | Route packs and curated 5-10 stop crawl links rendered. | [390](screenshots/crawl-baseline/20-crawls-390.png) |
| Borough crawl | Camden page rendered `Start a crawl from cheapest pubs` and crawl links. | [390](screenshots/crawl-baseline/21-borough-camden-390.png), [1440](screenshots/crawl-baseline/22-borough-camden-1440.png) |

## Observations before code changes

- The current planner and map handled 3 stops end to end under the correct keyless production environment.
- The first guest redaction observation was reproduced with a server missing `PUBMAX_FRIEND_MEMBER_REHYDRATION_V2=1`. After restart with the repository-required flag, host route/share and map flows rendered correctly. No code change was made for that observation.
- Existing copy and optimizer logic were hard-coded to three stops. This is the extension target.
