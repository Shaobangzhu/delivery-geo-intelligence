# Delivery Geo Intelligence

Delivery Geo Intelligence is a local Web GIS proof of concept for exploring **personally observed** last-mile delivery activity around Eastvale, California. It helps the observer maintain records and examine where pickups and privacy-reduced destinations concentrate. These records are a convenience sample: maps and rankings do not describe overall demand, residents' preferences, or the whole delivery market. The image in docs/ui.ux.design.png is a design mockup, not a source of live statistics.

## Dashboard calendar scope

Time filters are **Week**, **Month**, a native **Year** dropdown, and **All**. Week remains Monday–Sunday in `America/Los_Angeles`. Year lists Current and descending past years starting in **2026**, expanding automatically as the local year changes; it selects the full calendar year. All covers detailed DGI observations from **2026-01-01 through today in Los Angeles**, with yearly chart buckets. Category and remembered year remain independent; filters update cards, GIS datasets and Efficiency together without recreating the mounted MapView.

The shared API accepts `period=week|month|year|all`, `category`, and optional `year` in Year mode only. `year` and deterministic `asOf` cannot be combined. Invalid or future years return 400. See [Dashboard date rules](docs/dashboard.md).

Official 2024/2025 annual aggregates stay separate from detailed analytics; no annual financial amount or trip is converted into Dashboard income or a map observation. Early 2026 backfill may be incomplete. All-category income still uses known Delivery payouts plus actual Prop 22 receipts in the selected payment-date range; category income excludes adjustments. Whole-session/strategy rules and unknown costs remain unchanged; Settlement Efficiency uses its own coverage periods. Ask DGI's seven tools support detailed All and Year scopes while historical official questions use the existing annual tool.

## Implemented application

React, TypeScript, Vite, and React Router provide three primary pages:

- **Dashboard** (/dashboard): period/category filters, summary cards, charts, merchant rankings, and an ArcGIS map.
- **History** (/history): paginated Delivery CRUD, Prop 22 payments, Uber Eats sessions, vehicle/annual-mileage settings in centered modals, and read-only Uber Annual Statements. Delivery addresses are cleared after save.
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
- **PROMPT B — IMPLEMENTED:** On-demand Ask DGI, OpenAI Responses function calling, seven read-only aggregate tools (the original six plus annual statements), and evidence-backed metric display.
- **PROMPT C — IMPLEMENTED:** Deterministic AI evaluation, request-bound evidence/scope guards, aggregate privacy projection, failure diagnostics and frontend reliability tests. Mock validation does not establish real model accuracy.
- **FUTURE — DEFERRED:** Advanced Agent evaluation, deployment, and autonomous optimization.
- **DEFERRED:** Rate-based statutory verification and historical legal rates. A multi-city settlement cannot use one Eastvale wage without evidence of applicable jurisdictions and rates. No such assumptions are made here.

## Ask DGI — AI Operations Analyst (Prompt B)

The existing Dashboard contains an expandable **Ask DGI** panel. Suggested questions populate its textarea; pressing Ask is the only trigger for OpenAI requests. Page loads, filter changes, record edits, and deterministic analytics never trigger AI calls. Specify the desired period/category in the question: AI scope is independent of the displayed Dashboard filters. Questions can cover cash income, recorded-delivery/session efficiency, explicit strategies, latest Prop 22 work periods, modeled costs, unavailable profit, and supported History backfills. The model is instructed to answer Chinese questions in Chinese; guarded comparison explanations are rendered in Chinese by the server. Source metric labels remain English. Real model language performance is not yet evaluated.

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
| `get_annual_uber_summary` | `years` (1–2 distinct completed years), `includeMonthly` boolean | Independent annual statements, source reconciliation, calculated annual rates and same-definition changes |

Period is week/month/year; category is all/restaurant/grocery/retail/other. JSON schemas require every property; optional dates/IDs use null. Zod validates before database access. The original tools call the frozen services directly; the annual tool calls its separate deterministic annual service through the existing process read/write queue; they cannot mutate records, generate query expressions, browse, or run code. Different tool reads are not one shared snapshot.

Final responses require successful tool evidence. The model returns a qualitative `explanation`, selected `factIds`, and `comparison` (`none` or `limited`). Request-specific evidence IDs resolve only to successfully executed tools in that request. Each fact retains its tool execution, actual scope, accounting basis, cohort and units. The server renders exact deterministic amounts, metric sample/excluded counts and missing reasons; settlement scalars carry coverage/completeness counts. Null remains unavailable and recorded zero remains known.

Selected strategy evidence or facts spanning different periods/bases/cohorts/units require `comparison=limited`; otherwise the answer fails with `scope_conflict`. Limited comparisons use a server-written English/Chinese explanation and separate scoped facts, replacing untrusted comparative prose. Delivery/Session cross-scope comparisons compute no before/after difference or causal inference. A narrow annual-only exception renders already-calculated changes for the same year pair and metric definitions; mixed annual/DGI facts retain the original restriction. Ordinary model prose cannot supply digits, dates, percentages or written-out numbers; use evidence for these. Conceptual phrases such as “unknown, not zero” and “two accounting views” remain accepted. This conservative check and the structured scope guard do not prove all qualitative statements correct or the model's selected period relevant to the question.

Limits: three tool-calling rounds, six total executions, at most four Responses requests, 1,000 output tokens per request, 60 seconds total, 48,000 bytes per tool result and 128,000 total result bytes. SDK retries are disabled; limits return a controlled failure without a fabricated partial analysis. Cancellation stops further work where possible; an already-running read or provider operation may finish. Repeated explicit submissions can incur additional charges; no budget ledger is implemented.

With `NODE_ENV=development`, the backend prints only request ID, model, allowlisted tool names/count, provider-call/error counts, latency, cumulative tool bytes, outcome and provider usage. Usage preserves supplied input/output/total tokens and cached/cache-write/reasoning details for each exchange; totals sum available records, including repeated input. Missing usage is not invented. No token pricing or dollar estimate is configured. Other environments do not log this metadata. Questions, answers, SDK error objects and raw financial payloads are not logged or persisted.

OpenAI receives the submitted question and compact aggregate results, not stored notes, public/residential addresses, destination points, raw map data, credentials, or unnecessary record IDs. Tool-result text is restricted to domain enums, validated dates and server-authored limitations/backfill instructions; unknown fields are stripped recursively. Evidence and shared scope metadata replace duplicate aggregate trees in provider continuations. No cross-request financial cache is used. An ID explicitly typed into a question/tool argument is still part of that interaction. Requests use `store: false`; this does not assert zero provider retention. Do not paste private addresses or secrets into questions. Answers render as escaped plain text. No RAG, embeddings, persistent memory, writes, scheduling, streaming, new page, or deployment was added.


### AI evaluation (Prompt C plus annual extension)

```bash
npm run eval:ai
npm test
npm run typecheck
npm run build
git diff --check
```

The default evaluator uses 39 synthetic, scripted-provider scenarios (the original 32 plus three annual and four calendar scenarios) across nine categories. It needs no `.env`, production database or OpenAI credentials and makes zero real OpenAI calls. Assertions determine category results and failures return a nonzero exit status. The report measures mock request/tool counts, token fields, payload size and local duration; these are not real billing or provider latency. Existing integration tests require the local DGI MongoDB and create only isolated synthetic databases. Details and blind spots: [AI evaluation](docs/ai-evaluation.md).

**DEFERRED:** Explicitly authorized live model evaluation, real tool-selection/language accuracy measurement and published-rate billing estimates. No live OpenAI request was made in Prompt C; mock tool plans and Chinese text do not prove model behavior. No optional live command was added.

## Uber Annual Statements — implemented

History displays source-reported annual figures, calculated Net Payout per annual Online Mile/Completed Trip, expandable monthly activity, missing values and reconciliation warnings. The initial private local inputs cover 2024 and 2025; the public checkout contains no personal statements or import JSON. The collection/API start empty on a new installation. Further completed years use the same schema and CLI, including partial source availability. No new navigation page or map layer is added.

`uberAnnualSummaries` stores one aggregate-only document per year. Uber Tax Summary is a platform report that says it is **not an official tax document**; separately issued 1099-K and 1099-NEC are distinct sources. Box amounts cross-check Gross Payment, not additional income. Monthly 1099-K amounts are **gross transactions**, never monthly Net Payout. NEC/miscellaneous earnings do not establish Prop 22 or get allocated to Deliveries/Sessions/strategies.

The source pipeline is implementation-time manual PDF review → aggregate-only private JSON → Zod/cents reconciliation → explicit local CLI insert → read-only API/History. There is no runtime PDF parser/upload. Financial equations use integer cents. Monthly trip, mile and gross-transaction totals are independently checked; discrepancies preserve both reported values. Monthly mismatches and transaction-count differences are warnings. Financial equation mismatches block import for review. Missing fields/months are insufficient data, not fabricated zeros; partial records may be imported. Breakdown checks require an explicit source-review completeness flag, so missing optional categories are not assumed zero.

### Private local import

Keep source files outside the repository and put reviewed JSON in Git-ignored `private-exports/uber-annual/`. Do not copy taxpayer names, addresses, TINs, account numbers or original file paths into JSON. The CLI requires exactly one explicit mode and the existing **local** DGI `MONGODB_URI` from `backend/.env`. It never calls ArcGIS/OpenAI or initializes other records.

```bash
npm run db:status
npm run data:import-uber-annual -- --file private-exports/uber-annual/2024.json --dry-run
npm run data:import-uber-annual -- --file private-exports/uber-annual/2024.json --apply
```

Repeat with another completed year's privately reviewed JSON. Run dry-run first. Identical year data (regardless of JSON key/month order or import timestamp) returns `already_imported`; changed observations return `annual_conflict`, with no overwrite. Apply is insert-only, protected by MongoDB's unique numeric `_id`. There is no automatic startup import or public annual write endpoint. Invalid input/connection failures return a safe code without echoing private values or credentials. CLI reconciliation summaries contain financial discrepancies: keep captured output private too.

`GET /api/uber-annual-summaries` returns `{ data, comparisons, limit, hasMore }`, newest year first, at most 20 years, with a valid empty result and no private document metadata. Each year includes source availability, annual observations, tax-form amounts, monthly observations, derived metrics, a highest-observed-month gross-transactions check (coverage explicit), and reconciliation. API and AI facts distinguish reported values from calculated values; import timestamps/IDs/file paths never leave the annual API.

**Boundaries:** Net Payout is not full economic vehicle profit or after-tax income. Annual Uber Online Miles differ from Session, official Prop 22 engaged and tax-eligible mileage. Per-mile rates use the reported annual value, preserving any monthly discrepancy. Hours are absent, so no annual hourly rate is calculated. Adjacent available-year changes compare identical definitions; gaps are labeled nonconsecutive, zero baseline percentages are unavailable, and missing/zero denominators produce unavailable rates. `vehicleTaxYears`, IRS calculations and frozen A.0–A.2.2 Dashboard accounting remain independent and unchanged.

**Recording workflow:** 2024–2025 are platform-reported aggregate history. January 1–September 23, 2026 detailed History backfill is in progress; September 24 onward uses maintained DGI detailed records. This is the user's recording workflow, not verified complete coverage. Aggregates never generate historical Deliveries, Sessions, merchants or GIS observations.

Ask DGI adds exactly `get_annual_uber_summary`; seven tools are registered while the six-execution budget stays unchanged. Selected aggregate annual results reach OpenAI only after an explicit Ask DGI submission. Backend-calculated changes carry year, source, definition, unit, denominator and reported/calculated provenance. The server permits a special comparison explanation only when all selected evidence is calculated annual-change evidence for the same year pair and execution. Arbitrary mixed-basis comparisons and model-supplied numeric claims remain restricted.

**DEFERRED:** runtime PDF processing, Uber synchronization, detailed historical reconstruction, annual Prop 22 allocation, tax returns/liability, new vehicle cost formulas, additional GIS layers, cloud deployment and statement correction/overwrite workflow. Conflicting inputs require manual source review outside this insert-only importer.
