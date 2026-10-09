# Delivery Geo Intelligence

Delivery Geo Intelligence is a local Web GIS proof of concept for exploring **personally observed** last-mile delivery activity around Eastvale, California. It helps the observer maintain records and examine where pickups and privacy-reduced destinations concentrate. These records are a convenience sample: maps and rankings do not describe overall demand, residents' preferences, or the whole delivery market. The image in docs/ui.ux.design.png is a design mockup, not a source of live statistics.

## Implemented application

React, TypeScript, Vite, and React Router provide three primary pages:

- **Dashboard** (/dashboard): period/category filters, summary cards, charts, merchant rankings, and an ArcGIS map.
- **History** (/history): paginated Delivery CRUD, Prop 22 payments, Uber Eats sessions, and vehicle/annual-mileage settings in centered modals. Delivery addresses are cleared after save.
- **Merchants** (/merchants): management of verified public physical pickup locations. Two stores of the same brand are separate Merchant records.

Express and Zod validate requests. The native MongoDB Node.js driver stores Merchants and Deliveries in the DGI MongoDB container. React calls Express; Express calls MongoDB and, for address geocoding, ArcGIS. Frontend and backend run on the host; Docker Compose runs MongoDB only. / redirects to /dashboard; GET /api/health checks the API.

Dashboard filters use one backend definition for week/month/year in the Los Angeles calendar and restaurant/grocery/retail/other categories. The same resolved filter feeds cards, charts, rankings, merchant map data, and the destination heatmap request. Delivery earnings sum **known payouts only**: a missing payout is unknown, whereas a recorded $0 is known. Averages include a known-payout sample count. No mockup counts or rankings are hardcoded as data.

Each Dashboard metric determines one canonical ArcGIS representation; there is no separate map display selector:

| Metric | Display | Meaning |
| --- | --- | --- |
| Pickup Volume | Heatmap only | Intensity weighted by observed delivery count |
| Merchant Diversity | Category-coded public Merchant points only | One equal-size point per distinct observed physical Merchant |
| Destination Heatmap | Heatmap only | Generalized observed destination activity; no individual markers or popups |

One MapView survives filter and metric changes. Client-side FeatureLayer data and renderers update without recreating the view. Merchant popups show only public pickup and aggregate delivery information. [Dashboard analytics](docs/dashboard.md) explains filters and renderers.

Delivery History captures optional observed delivery duration from your delivery history/Uber Eats record. Add/Edit uses Hours, Minutes, and Seconds; MongoDB stores one positive integer `deliveryDurationSeconds`. Missing duration means unknown or not yet recorded, never zero. Existing records can be manually backfilled, corrected, or cleared by leaving all three fields blank. No migration or automatic backfill is performed. History displays concise durations; A.2 Core uses recorded duration for delivery-level efficiency, separately from official Prop 22 engaged time.

History also manages **Prop 22 Payments** as independent `EarningsAdjustment` records (`prop22_guarantee`). The secondary Add Prop 22 Payment action opens a centered modal; a separate newest-first table supports edit and confirmed delete. `paymentDate` is a `YYYY-MM-DD` date, while optional paired coverage dates capture the period shown in your Uber record.

The centered payment modal labels the authoritative income **Amount Received**. Its collapsed **Settlement Details (Optional)** section captures official Uber-reported engaged time, engaged miles, eligible earnings **excluding tips**, and guaranteed earnings. Blank means unknown; a reported zero is retained. Engaged Hours/Minutes/Seconds become one nonnegative `engagedSeconds` integer. These observations are never inferred from Delivery duration, distance, or payouts. Existing payments can be backfilled in place without a migration or a duplicate record.

After saving, reopen the payment to see backend-derived reconciliation: `max(0, reported guarantee − eligible earnings excluding tips)`, compared with the received amount using integer cents and an inclusive one-cent tolerance. Status is Matched, Needs review, or Insufficient data. Edits hide the old result until saved and reopened. Uber statements are the source of truth; offsets, corrections, or separate components can cause a mismatch that this simple comparison cannot explain. Calculated values are diagnostic and never replace received money.

Dashboard **All** Total Earnings combines known delivery payouts with Prop 22 amounts received within the resolved Los Angeles calendar range. Category-specific and merchant earnings remain delivery payouts only: no Prop 22 allocation is attempted. Coverage dates do not affect current totals. Delivery payout is the delivery-level amount; entering an adjustment never changes or duplicates Delivery payouts. A.2.1 adds a separate settlement-period efficiency view; individual/merchant/category adjustment allocation remains **DEFERRED**.

## Uber Eats sessions and personal vehicle economics (A.1)

History's **Uber Eats Sessions** section records complete operating periods with independent start/end instants, optional total driven and IRS-eligible miles, notes, and a strategy. The user-supplied strategies describe 2024 Wide-Area Marathon, 2025 Home-Based Multi-Order, and 2026 Eastvale Local-Only (local orders and returns home), plus Other. They are descriptive choices, not proven optimal strategies, and are selected per session rather than assigned from the year. Session duration is derived, including midnight/DST crossings; times display in America/Los_Angeles. A repeated fall clock hour offers a first/second occurrence choice; skipped spring times are rejected.

**Link Deliveries (Optional)** lists paginated candidates in the entered interval; only checked deliveries become linked. A Delivery has at most one `sessionId`. No timing overlap creates a permanent link. Session deletion unlinks and retains deliveries; Delivery deletion naturally removes it from derived session membership. Existing delivery fields and unassociated records remain valid.

The collapsed **Tesla Model Y — Vehicle Economics** panel stores one profile and editable annual mileage. Run `npm run data:init-a1`, or use **Initialize Missing Confirmed Records** in History, to insert missing user-confirmed records. Initialization is idempotent, preserves edits, and never runs automatically on startup.

The initial 2022 Tesla Model Y Long Range profile uses **$0.00/mi incremental electricity cash cost**, explicitly based on the user's 8.8 kW solar/SCE NEM 2.0, approximately zero net annual household electricity bill, and home-only charging while delivering. This is a personal cash-cost assumption, not an estimate of electricity opportunity cost. One observed Pirelli Scorpion four-tire replacement cost **$1,600**. Expected lifespan and marginal mileage depreciation both start unknown. Paid repairs to date are zero (the official recall was free); America's Tire rotations/alignment have no out-of-pocket cost. Washing and cabin filters are excluded. Historical zero expenses do not guarantee future zero repair risk.

Tire wear is estimated as replacement-set cost / entered expected life. Session preview multiplies independently recorded total miles by configured energy, tire wear, and marginal depreciation rates. It labels known/estimated subtotals and incomplete full economic costs rather than turning unknown assumptions into zero. Estimates use the **current profile**, including for past sessions; no historical profile snapshots exist. Complete means all three modeled components, not all vehicle ownership costs. Neither costs nor tax deductions change Dashboard income.

Confirmed annual history is **2024: 13,350 total miles / 5,737 Uber Eats miles (42.97%)**, and **2025: 11,549 / 2,310 (20.00%)**. Realtor/other business miles are explicitly zero in these years. Future missing purpose categories remain unknown. Annual records are independent of session totals and preserve one derived business-mile sum. Historical Standard Mileage deduction previews use sourced 2024/2025 rates; unsupported years or incomplete purpose totals show unavailable. These previews do not determine eligibility or tax savings. [Analytics model](docs/analytics-model.md) links the IRS sources and explains the boundaries.

## Geospatial data and privacy

A Merchant represents **one public physical pickup location**. Its verified public business address and exact stored-geocoded GeoJSON Point may be saved and displayed. A Delivery references a Merchant ID and may have payout, distance, notes, and a generalized destination Point. History displays only a safe destination state such as “Location Ready.”

Residential destination processing:

1. A transient address goes to Express and ArcGIS stored geocoding with forStorage=true.
2. The exact coordinate exists during request processing, then deterministic rounding reduces its precision.
3. The address and exact coordinate are discarded; only a generalized GeoJSON Point goes to MongoDB and aggregate destination heatmaps.

The default destination precision is two decimal places of longitude/latitude, configurable with DESTINATION_COORDINATE_DECIMALS (0–2). This is approximate spatial reduction, **not guaranteed anonymity**. Neither the dedicated address nor the exact residential geocoder Point is a database field, API response, application log, or map popup. The heatmap API transports only grouped generalized cells and counts required for rendering; the UI does not list their coordinates. Free-text notes should not contain customer addresses. [Privacy model](docs/privacy-model.md) describes limitations.

The browser reads VITE_ARCGIS_API_KEY from frontend/.env for ArcGIS map services. The server reads the separate ARCGIS_GEOCODING_API_KEY from backend/.env for stored geocoding; it must never be prefixed VITE_ or sent to React. ArcGIS application privilege configuration must be checked in ArcGIS itself. Real .env files, database data, exports, and backups stay out of Git.

## Local setup

Requires Node.js 22.12 or newer, npm, Docker Desktop, and Docker Compose.

1. Run npm install at the repository root.
2. Copy .env.example to .env and set local DGI MongoDB credentials. Keep this file private.
3. Copy backend/.env.example to backend/.env. Set MONGODB_URI for database delivery_geo_intelligence using the root Docker credentials; URL-encode special password characters. Set ARCGIS_GEOCODING_API_KEY. Set PORT if the default needs changing. Set DESTINATION_COORDINATE_DECIMALS only if a different precision is intended.
4. Copy frontend/.env.example to frontend/.env and set the distinct public-application VITE_ARCGIS_API_KEY.
5. Run npm run db:up and wait for docker compose ps to report dgi-mongodb healthy.
6. In separate terminals run npm run dev:backend and npm run dev:frontend, then open http://127.0.0.1:5173.

Add verified public business locations in Merchants, then select them when recording Deliveries in History. No Merchant/Delivery history is seeded. A.1's explicit initialization inserts only the user-confirmed vehicle assumptions and annual mileage above. The backend creates spatial and History query indexes at startup.

| Command | Purpose |
| --- | --- |
| npm run db:up | Start DGI MongoDB and wait for its healthcheck |
| npm run db:down | Stop it while retaining the named volume |
| npm run db:status / npm run db:logs | Inspect service state / logs |
| npm run dev:frontend / npm run dev:backend | Start Vite / Express |
| npm run typecheck / npm run build | Verify types / build both workspaces |
| npm test | Run backend integration and frontend interaction tests |
| npm run data:init-a1 | Insert missing confirmed vehicle/2024–2025 mileage records without overwriting edits |

Compose uses official mongo:7.0, the dgi-mongodb container, a dedicated persistent dgi_mongodb_data volume, and a healthcheck. Port 27017 is published on 127.0.0.1 only. This stack is independent of other projects' databases.

## Scope and remaining work

- **PHASE 1.5:** A true grid or hex COUNT(DISTINCT merchantId) analysis remains optional; the current diversity map displays each observed physical Merchant once as a category-coded point.
- **PHASE 2:** No second deployment phase is implemented or committed. The present system is a local, single-process PoC; scaling or multi-user use requires its own design and privacy review.
- **FUTURE:** Minimum aggregation thresholds and a deployment security model would require design before broader use.
- **DEFERRED:** CSV export, temporal Merchant location history, and application-managed backup/restore are not implemented.

See [architecture](docs/architecture.md), [data model](docs/data-model.md), [geocoding](docs/geocoding.md), [analytics model](docs/analytics-model.md), and [privacy model](docs/privacy-model.md) for implementation details.

## Efficiency Analytics (A.2 Core)

Dashboard has a compact read-only Efficiency Analytics section powered by `GET /api/efficiency`, using the existing week/month/year and category filters. Delivery gross payout per recorded hour/mile uses a ratio of sums on the same eligible cohort, never an unweighted mean of individual rates. Known zero payouts are valid; absent payouts and zero/missing denominators are unavailable. Every metric returns sample/excluded counts, units, and incomplete-data reasons.

Complete-session and strategy metrics explicitly remain **All Categories**, even when a delivery category is selected. Only sessions whose entire `[startedAt, endedAt)` interval lies within the Los Angeles calendar period are included; overlapping boundary-crossing sessions are counted and excluded without splitting. Session revenue comes solely from explicit Delivery links, including links outside the pickup-date range. Partial known payout remains visible, but payout rates require complete linked revenue; an unlinked session is not assumed to have zero revenue. Strategy groups come only from stored labels, including an Unclassified group, and are descriptive rather than optimality claims.

Estimated session profit uses complete linked payouts minus complete A.1 modeled vehicle cost, with valid duration and known miles. Partial costs stay visible and incomplete sessions are excluded from profit cohorts. Zero miles permits a known zero modeled cost, but no per-mile rate. Cost previews use current vehicle settings. Profit is **pre-tax, excluding unallocated Prop 22 adjustments**; IRS deductions are neither revenue nor vehicle cost. Existing cash-basis Dashboard earnings, rankings, settlements, and maps are unchanged. Data-quality counts identify missing observations and excluded sessions. Prompt B below adds optional explanations, not new calculations or autonomous recommendations.

## Prop 22 settlement-aware efficiency (A.2.1)

Dashboard's **Prop 22 Work-Period Efficiency** subsection has its own recent-settlement selector, independent of calendar/category filters: **All Categories · Settlement Coverage Period**. `GET /api/efficiency/settlements` returns the 20 newest payments and checks coverage conflicts against all stored settlements within documented local analysis limits. It never adds these work-period totals to cash-basis Dashboard earnings.

Inclusive statement coverage dates resolve to `[Los Angeles midnight on start, midnight after end)`, including DST. Covered Delivery revenue uses `pickedUpAt` as an attribution approximation and adds only the specific payment's actual received amount, never its reported guarantee or expected adjustment. Missing payout remains unknown; known zero is valid. Recorded gross revenue can be shown before session completeness is established and is not independent proof that all activity was captured.

The existing Payment modal has a manually controlled **I have recorded all Uber Eats deliveries and sessions for this settlement period** checkbox. Absent metadata is unconfirmed. Confirmation is retained even when checks fail; it never changes payment amounts or A.0 reconciliation. Complete-session hours/miles and adjusted rates require confirmation plus complete known payouts and consistent explicit links. Missing sessions/miles, unlinked deliveries, boundary-crossing or overlapping sessions, pickups outside linked sessions/coverage, and overlapping/duplicate settlements block full-period rates. No boundary splitting or payment allocation is performed. Empty activity is not assumed to be zero revenue.

Profit subtracts complete current A.1 modeled costs only when full period coverage passes; partial costs remain labeled observations from included sessions. Unknown tire life/depreciation blocks profit even when earnings efficiency is ready. Zero miles permits no per-mile denominator. No IRS deductions, taxes, or generic electricity assumptions are added. This is a user-confirmed convenience sample with approximate statement cutoffs, not independently verified complete Uber data.

## A.2.2 audit and core freeze

A.0–A.2.1 are implemented and audited. Synthetic failure-injection regressions cover partial Session association writes, compensation failures, concurrent payment PATCHes, analytics read coordination, numeric overflow, and date boundaries. All 71 backend and 80 frontend tests, typecheck, build, and whitespace checks pass. No manual browser testing was performed for this audit. ArcGIS's existing large build chunks remain a warning, not a failed build.

Session mutations mark `associationIntegrity: "pending"` before changing fields or links. Recoverable write failures restore the previous Session and associations without rewriting Delivery facts. If recovery fails or execution stops midway, the persisted marker blocks complete Session revenue/rates/profit and settlement efficiency. History shows **Association review required**; review and explicitly resubmit Delivery selections in the Session modal, or delete the Session to unlink them. This is compensation and a completeness guard, not a multi-document transaction or an automatic reconstruction of prior membership.

The single Express process queues domain writes and multi-query analytics reads together. Concurrent payment PATCHes validate the latest merged document. Separate HTTP responses are not one shared snapshot: refresh after edits. Direct database edits, other processes, and future direct domain-service callers need equivalent coordination. A persistent outage or ambiguous write acknowledgement can still require manual review; no journal, replica set, historical profile snapshot, or distributed locking is implemented.

Unsafe monetary inputs are rejected; unsafe Dashboard monetary aggregates return unavailable (`null`) instead of nonfinite values or a misleading partial total. Missing payout remains unknown and known zero remains valid. Delivery duration/distance, Session elapsed time/total driving, official Prop 22 engaged time/miles, and IRS business miles remain separate observations. User confirmation cannot override structural failures or prove that all real-world activity was recorded.

## Operations-analysis roadmap

- **A.0 — IMPLEMENTED:** Optional official settlement observations and integer-cent reported-guarantee reconciliation, without changing actual received income.
- **A.1 — IMPLEMENTED:** Operating sessions, explicit Delivery links, personal vehicle assumptions, cost completeness, and annual business-mileage history.
- **A.2 CORE — IMPLEMENTED:** Deterministic delivery/session rates, modeled pre-tax session profit, descriptive strategy comparison, and data completeness.
- **A.2.1 — IMPLEMENTED:** Settlement-period gross revenue, explicitly confirmed complete-session denominators, adjusted rates, and modeled work-period profit with consistency safeguards.
- **A.2.2 — COMPLETE · A.2 CORE FROZEN:** Final audit, integration hardening, and regression verification for the existing local PoC. Merchant profitability and individual/session/strategy adjustment allocation remain outside the implemented scope.
- **PROMPT B — IMPLEMENTED:** On-demand Ask DGI, OpenAI Responses function calling, six read-only aggregate tools, and evidence-backed metric display.
- **FUTURE — DEFERRED:** Advanced Agent evaluation, deployment, and autonomous optimization.
- **DEFERRED:** Rate-based statutory verification and historical legal rates. A multi-city settlement cannot use one Eastvale wage without evidence of applicable jurisdictions and rates. No such assumptions are made here.

## Ask DGI — AI Operations Analyst (Prompt B)

The existing Dashboard contains an expandable **Ask DGI** panel. Suggested questions populate its textarea; pressing Ask is the only trigger for OpenAI requests. Page loads, filter changes, record edits, and deterministic analytics never trigger AI calls. Specify the desired period/category in the question: AI scope is independent of the displayed Dashboard filters. Questions can cover cash income, recorded-delivery/session efficiency, explicit strategies, latest Prop 22 work periods, modeled costs, unavailable profit, and supported History backfills. Chinese questions receive Chinese explanations; source metric labels remain English.

The backend uses the official `openai` Node SDK (installed 7.31.0), Responses API, strict function schemas, and a small custom loop. Configure only `backend/.env`:

```text
OPENAI_API_KEY=<existing backend-only credential>
OPENAI_MODEL=gpt-4.1-mini
```

The key already supplied remains untouched. Model omission uses the documented `gpt-4.1-mini` default, a relatively inexpensive model supporting tool calling/structured output without a reasoning step; see [official model documentation](https://developers.openai.com/api/docs/models/gpt-4.1-mini). It can still choose the wrong scope or give a mistaken interpretation. Different configured models must support Responses function calling and strict structured output; unsupported models fail safely. No speculative model IDs, extra Agent framework, or reasoning settings are used. Missing credentials/invalid model configuration disables AI with 503 while ordinary DGI APIs start normally. Restart the backend after changing configuration.

`POST /api/ai/ask` accepts only `{ "question": "How efficient were my delivery sessions?" }` with trimmed length 1–1,000. Success returns `{ requestId, answer, toolsUsed, warnings }`; invalid input returns 400, provider/tool/grounding failures return controlled 502/503 with `{ requestId, error, code }`. Responses are non-streaming and `Cache-Control: no-store`. There is no persistent chat.

| Tool | Strict arguments | Existing service / output |
| --- | --- | --- |
| `get_period_summary` | `period`, `category`, nullable `asOf` | Dashboard cash-basis counts/earnings; no merchant/map payload |
| `get_delivery_efficiency` | same | Core recorded-delivery rates and sample/completeness metadata |
| `get_session_efficiency` | `period`, nullable `asOf` | Core all-category whole-session payout, costs/profit, quality |
| `compare_strategies` | same | Core explicit strategy groups, including Unclassified |
| `get_settlement_efficiency` | nullable `settlementId`, `limit` 1–5 | Existing bounded settlement service; latest by default, ID only within its 20 recent results |
| `get_data_quality` | `period`, nullable `asOf` | Core quality plus up to five recent settlement completeness summaries |

Period is week/month/year; category is all/restaurant/grocery/retail/other. JSON schemas require every property; optional dates/IDs use null. Zod validates before database access. Tools call the frozen services directly through the existing process read/write queue; they cannot mutate records, generate query expressions, browse, or run code. Different tool reads are not one shared snapshot.

Final responses require successful tool evidence. The model returns a qualitative explanation and evidence IDs; the server validates those IDs and appends exact deterministic values, units, sample/excluded counts and reasons. Null remains unavailable, zero remains known. Unreferenced numeric prose, forged references, and no-evidence answers fail closed. This syntactic guard is not a semantic proof: scope selection and qualitative explanations can still be wrong. Cash/work-period income, partial/full costs, and descriptive/causal comparisons remain distinct. No new financial formula or before/after rate calculation is introduced.

Limits: three tool-calling rounds, six total executions, at most four Responses requests, 1,000 output tokens per request, 60 seconds total, 48,000 bytes per tool result and 128,000 total result bytes. SDK retries are disabled; limits return a controlled failure without a fabricated partial analysis. Cancellation stops further work where possible; an already-running read or provider operation may finish. Repeated explicit submissions can incur additional charges; no budget ledger is implemented.

With `NODE_ENV=development`, the backend prints only structured request ID, configured model, tool names/count, latency, summed provider input/output token usage (when available), and outcome. Questions, answers, raw tool data, credentials and earnings records are not logged or persisted. Usage sums each Responses exchange, including repeated conversation input; it is not a dollar estimate or cached-token billing breakdown. With other NODE_ENV values, those logs are off. No live provider smoke test was performed; mocked SDK tests and isolated MongoDB tests verify the local integration, not account/model access.

OpenAI receives the submitted question and compact aggregate results, not stored notes, addresses, destination points, raw map data, or credentials. Requests use `store: false`; this does not assert zero provider retention. Do not paste private addresses or secrets into questions. Answers render as escaped plain text. No RAG, embeddings, persistent memory, writes, scheduling, streaming, new page, or deployment was added.
