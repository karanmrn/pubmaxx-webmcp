# WebMCP Challenge submission

## Links

- Verified preview: `https://chengdu-ndpx8fznc-pubmax69.vercel.app/webmcp`
- Public source: `https://github.com/karanmrn/pubmaxx-webmcp`
- Public demo video: `YOUTUBE_URL_PENDING`

Do not replace a pending value until the URL is public and verified.

## Project description

### Why this use case is a strong fit for WebMCP

Planning a pub crawl combines personal intent with facts the product must own: listed pubs, route order, alternatives, walking totals, live London context, and evidence quality. WebMCP lets an agent call these exact capabilities with bounded inputs instead of guessing from pixels or scraping prose. PUBMAXX stays the authority for venue and route facts.

### How it creates a better user experience

The person and agent work on one visible Agent Night Board. Search and London context remain available beside the route. Every route change has a revision. A person can inspect reasons, alternatives, warnings, and provenance, swap a Stop, then continue with the exact order in PUBMAXX Plan. Unsupported browsers and registration failures keep the same manual controls, so the page never becomes a dead end.

### What people and agents can do together now

An agent can discover five purpose-built actions, gather bounded evidence, draft a grounded route, revise one Stop using server-provided alternatives, and hand the result into the full planner. The person can guide and verify each step on screen. Before WebMCP, an agent had to operate an unstructured click path and infer state from changing UI. It had no typed revision check or canonical Plan handoff.

### How WebMCP was implemented

The top-level `/webmcp` client registers five tools through `document.modelContext.registerTool`. Each tool has a closed JSON Schema, runtime validation, accurate read-only and untrusted-content annotations, and cancellation support. One abort-owned lifecycle removes registrations on unmount. Tool callbacks and manual controls call the same actions and shared board state. Existing same-origin PUBMAXX APIs remain the only search, context, and route authorities. No WebMCP package, polyfill, database migration, sign-in, secret, or new provider was added.

## Demo script, 2 minutes 35 seconds

### 0:00 to 0:20 - Problem

Open `https://chengdu-ndpx8fznc-pubmax69.vercel.app/webmcp`.

"Planning a London night needs personal taste, but venue and route claims still need a trusted product source. This is the PUBMAXX Agent Night Board, one visible surface for a person and a browser agent."

### 0:20 to 0:40 - Native tools

Show `Agent tools ready`. Ask the agent to list the WebMCP tools.

"The page registers five narrow browser-native tools. They exist only on this route. No extension, sign-in, or API key is needed."

### 0:40 to 1:05 - Shared evidence

Ask the agent to search for a Victoria pub and read London context. Show both evidence blocks together.

"Search is limited to the curated PUBMAXX index. London context is capped, labelled as external evidence, and cannot steer another tool. Each result remains visible until that tool replaces it."

### 1:05 to 1:40 - Grounded route

Ask: "Draft three pubs in Victoria." Show Revision 1, ordered Stops, reasons, walking time, confidence, and warnings.

"The agent does not invent this route. It calls the existing grounded PUBMAXX planner. Revision checks stop two actions from overwriting each other."

### 1:40 to 2:05 - Human-directed change

Ask the agent to swap Stop 2. Show Revision 2 and `Needs refresh`.

"A swap can use only an alternative already returned by the server. It skips duplicates and clears totals, confidence, proof, and other claims tied to the old sequence."

### 2:05 to 2:25 - Exact handoff

Ask the agent to open the route in PUBMAXX. Show `/plan` with the same ordered Stops.

"The board writes the existing canonical Plan draft before navigation. A swapped route arrives with its refresh requirement, so old evidence cannot become a lockable claim."

### 2:25 to 2:35 - Source

Show the public repository root, licence, README WebMCP snippet, tests, and implementation files.

"The complete source is public under MIT, with third-party data terms preserved."
