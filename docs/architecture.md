# Architecture

## Current topology

```text
Browser
  → React + Vite (127.0.0.1:5173)
  → Express (127.0.0.1:3000)
  → MongoDB in DGI Docker Compose (127.0.0.1:27017)
```

The frontend and backend run directly on the host. Docker Compose runs only MongoDB, with DGI-specific credentials, container, and persistent named volume. The backend connects to MongoDB on startup, creates spatial and History query indexes, and exposes Merchant, Delivery, and Dashboard APIs. React has three primary routes: Dashboard, History, and Merchants.

The Compose image uses MongoDB 7.0 because MongoDB 8.0 failed to start under this Docker Desktop environment's Linux kernel. The DGI volume is separate from other projects.

## Public Merchant flow

```text
Merchants form → verified public business address → Express
  → ArcGIS stored geocode (forStorage=true) → exact business GeoJSON Point
  → persist publicAddress + exact location on one physical Merchant record
  → History merchant selector and Dashboard pickup analytics by merchantId
```

Two locations of one brand have separate Merchant IDs. Editing an address corrects the pickup point for every delivery referencing that ID; a genuinely moved store should be a new Merchant. A referenced Merchant cannot be deleted (HTTP 409); delivery records are never cascade deleted. Earlier Merchant records without a saved public address retain their existing point until corrected.

The local Express process serializes Merchant deletion with Delivery creation and merchant reassignment. It rechecks the Merchant immediately before the Delivery write, so a destination geocode in progress cannot create an orphan Delivery after a Merchant is deleted in this process. This is a single-process safeguard, not a cross-process transaction. A future multi-instance deployment would need database-enforced or transactional referential handling.

## Residential destination data flow

```text
History form
  → transient destination address
  → Express
  → ArcGIS stored geocoding
  → deterministic coordinate generalization
  → discard address and exact coordinate
  → persist generalized GeoJSON Point in MongoDB
  → filtered analytics
  → ArcGIS destination heatmap only
```

Residential addresses and exact geocoded residential coordinates are not stored or logged by the application. The Delivery API accepts a transient address and rejects direct destination coordinates. The frontend ArcGIS key is browser-consumed; the backend geocoding key remains server-only. Observed records and derived analysis are a personal observational dataset, not representative of overall delivery demand.

## Period earnings adjustments

History sends independent Prop 22 CRUD requests to Express `/api/earnings-adjustments`; Zod validates them and the native driver stores `earningsAdjustments` with a payment-date query index. These documents have no merchant or Delivery relationship. Coverage dates are optional inclusive statement dates.

Dashboard All-category Total Earnings queries payments by the resolved Los Angeles calendar date range and combines their received amounts with known delivery payouts. Category and merchant earnings remain Delivery-only. This is cash-basis accounting, with no coverage allocation, per-delivery adjustment, or migration. Separate efficiency views below do not change normal cash-basis earnings. Unsafe monetary aggregates are unavailable rather than reported as partial income. ArcGIS and destination privacy are unaffected.

## A.0 settlement audit flow

```text
Uber statement → manual entry in existing History payment modal
  → optional official settlementDetails on the same EarningsAdjustment ID
  → Express/Zod validation → existing MongoDB earningsAdjustments
  → pure backend reconciliation on detail/create/update response
  → saved diagnostic summary in the centered modal
```

Nested PATCH writes merge and validate the resulting document, then update only supplied fields with dotted MongoDB paths; siblings survive. Explicit null clears a field or the whole optional object. Legacy records require no migration. The list DTO envelope is unchanged.

`backend/src/settlement.ts` owns the deterministic `reported_guarantee` comparison. It does not access MongoDB, Delivery data, providers, or an LLM. A future sourced rate-based method can be a separate diagnostic calculator; A.0 makes no wage assumptions. React fetches the saved detail result with abort/active guards, never replaces entered money, and hides stale diagnostics after edits. Reopen after saving for the new result. Native details/summary provides progressive disclosure within the existing modal and focus management.

Dashboard queries still project only received amounts and payment dates. A.0 introduced no extra income or Dashboard KPI. Real statements, private exports, and credentials are not committed. A.1 adds the independent operating/cost foundation below; A.2/A.2.1 implement separate efficiency views. Prompt B adds optional read-only explanations below.

## A.1 operating sessions and vehicle assumptions

History retains its existing Delivery and Prop 22 sections and adds Uber Eats Sessions plus a collapsed vehicle/annual-mileage panel. Three primary navigation pages remain. Centered Session, Vehicle, and Annual Mileage modals use the existing dialog/focus pattern. React requests Express session/settings APIs; native MongoDB stores `deliverySessions`, the singleton `vehicleEconomics`, and year-keyed `vehicleTaxYears` in the same DGI database/container/volume.

Session timestamps are UTC BSON Dates; React converts explicitly to/from America/Los_Angeles, independent of the browser's own timezone. For supported modern dates (2000–2100), skipped DST wall times are rejected and repeated times offer the two actual instants. Elapsed duration is derived rather than persisted.

Each Delivery may hold a single optional `sessionId`. Session DTO membership is derived from those references; no duplicate persisted ID arrays exist. Candidate deliveries are only suggestions from the chosen interval, and the user checks them explicitly. Linking rejects missing deliveries (422) and ownership by a different session (409). The existing process-level reference-write queue serializes association changes, session deletion, and Delivery deletion. Session deletion unlinks before removing the session; Delivery deletion needs no reverse-array cleanup. Unrelated Delivery facts survive these writes.

This protection is for the existing single Express process. Multiple collections are not updated in a MongoDB transaction on this standalone Docker deployment. A.2.2 marks a Session with server-owned `associationIntegrity: "pending"` before changing fields/references, restores the previous fields and membership on recoverable failure, and clears the marker only after success. If compensation fails or the process stops mid-operation, guarded membership requires explicit user review/resubmission. Complete Session revenue/rates/profit and A.2.1 coverage fail closed while the marker exists. Prior membership is not durably journaled; recovery from persistent outage or ambiguous acknowledgements may need manual review. A multi-process deployment would need transactions or equivalent database enforcement. There is no inferred timing relationship, cascade deletion, migration, or automatic Session backfill.

Vehicle/annual initialization is an explicit CLI or UI action using `$setOnInsert` and fixed unique `_id` keys. It inserts missing confirmed records, never overwrites edits, and is absent from normal startup. The API calculates session costs from the current profile with a pure service; it persists observations/assumptions, not derived costs. Settings changes refresh displayed previews and do not modify past Session records. Historical profile versions and expense ledgers are not implemented.

Annual mileage separates Uber Eats, Realtor, and other purposes; it does not aggregate or assume deduction eligibility from sessions. Only sourced 2024/2025 deduction rates are supported. Economic cost and deduction previews do not enter cash-basis Dashboard earnings or Prop 22 reconciliation. No external vehicle APIs, timers, tracking, or tax-return engine are implemented. Deterministic efficiency and modeled pre-tax Session/work-period profit are implemented; merchant profitability and optimization remain deferred.

## Deterministic analytics and A.2.2 freeze

`efficiency.ts` separates MongoDB projections from pure Delivery/Session calculations; `settlementEfficiency.ts` does the same for whole statement periods. Reusable functions require no HTTP calls or AI/provider services. Delivery rates share validated Dashboard filters and matching numerator/denominator cohorts. Session/strategy results remain all-category whole intervals. Settlement efficiency has its own recent-payment scope: inclusive LA coverage dates become half-open instants, actual adjustment is added once, and explicit user confirmation plus structural checks gate complete denominators/rates/profit. Cash and work-period results are separate views of income, not additive totals.

The existing process queue now coordinates domain writes with Dashboard, destination-heatmap, Core, settlement, and Session multi-query reads. It prevents those reads from observing intermediate association changes or different write states across queries in this Express process. Payment PATCH performs read/merge/validation/write in the same queue. Separate HTTP requests are not a shared snapshot; external writes, other processes, and future direct service callers need equivalent coordination. Geocoding runs before queued writes and never holds the queue while waiting for ArcGIS.

**A.2 CORE FROZEN:** A.0–A.2.1 passed the A.2.2 synthetic regression, typecheck, and build gates. Frozen scope is the local single-process PoC, with documented nontransactional recovery and analytical limits. Prompt B reuses those calculations with the same coordination and aggregate privacy boundary, without changing the frozen services.

## Prompt B: on-demand AI Operations Analyst

```text
Dashboard Ask DGI → POST /api/ai/ask → Express orchestrator
  ↔ OpenAI Responses API (official Node SDK, function calling)
  → fixed six-tool registry → existing process read/write queue
  → Dashboard / Core / settlement domain services → MongoDB
  → aggregate-only projection → evidence + shared scope metadata → model qualitative explanation
  → server resolves evidence IDs to deterministic metric displays → React plain text
```

`ai/provider.ts` creates only a server-side SDK client; `ai/tools.ts` owns strict schemas, Zod validation, typed handlers and aggregate projections. `ai/projection.ts` strips unknown record fields recursively and validates domain text/dates. `ai/evidence.ts` binds facts to request-specific IDs, executions, accounting bases and cohorts. `ai/agent.ts` bounds execution, tool payloads and time, validates final structured output, and emits metadata only. `ai/routes.ts` validates the HTTP boundary, generates request IDs, handles safe errors and client cancellation. App registration injects the existing queue; no HTTP round-trip, independent calculation engine, write tool, model-generated query, or new collection is used.

Six tools are `get_period_summary`, `get_delivery_efficiency`, `get_session_efficiency`, `compare_strategies`, `get_settlement_efficiency`, and `get_data_quality`; schemas/service mappings and configuration are listed in README. A request pins calendar resolution time, but separate tool reads can see later completed edits. No queue is held during OpenAI requests. Already-running MongoDB operations are not forcibly cancelled; a cancelled queued tool checks its signal before reading.

`OPENAI_API_KEY` stays in backend environment only. `OPENAI_MODEL` defaults to documented `gpt-4.1-mini`; invalid AI configuration disables just the endpoint. SDK retries are off; three rounds/six executions/four provider requests and per-response token, payload and 60-second limits prevent indefinite loops. Structured final explanations cannot supply their own numeric metric values; server-rendered evidence preserves null/zero, units, sample counts and reasons. This does not guarantee the model selected the right scope or qualitative interpretation.

Only explicit Ask submissions contact OpenAI. The panel is independent of Dashboard filters, aborts on close/unmount, prevents duplicate submits and clears stale results. Development diagnostics contain request metadata/token totals only, with no prompts, replies or tool payloads. Provider storage is disabled for Responses (`store: false`); no persistent conversation or local telemetry database exists. Mocked tests cover SDK exchanges and safe failures; isolated MongoDB integration confirms no domain mutation. Live OpenAI access is unverified in this milestone.


## Prompt C: grounding and reliability boundary

The frozen financial services and six-tool registry remain unchanged in purpose. Runtime Zod schemas now require every declared argument; nullable `asOf`/`settlementId` must be explicitly present. Validation precedes the coordinated read. Settlement IDs are used for internal selection but removed from tool results. Only allowlisted aggregate keys, finite numbers, booleans, nulls, domain enums and validated ISO dates cross the projection boundary. Server-authored limitations and supported backfill workflows are included separately.

Evidence has a random request prefix and per-execution provenance. Repeating one tool with different scopes cannot overwrite earlier scopes. Currency/rate facts retain units; metric objects retain sample/excluded counts and reasons, while settlement facts carry supplied coverage, payout and complete-cost counts/status. Provider continuations carry evidence with shared source descriptors rather than another copy of the full aggregate tree. No new financial calculation or financial-data cache was introduced.

The final JSON adds a required `comparison` enum to explanation/fact IDs. Strategy selections and differing scope/basis/cohort/unit combinations require `limited`. The server substitutes a deterministic comparison limitation (Chinese for Chinese questions) and separately scoped values. Ordinary prose remains conservatively checked for numeric claims and unsupported action/comparative claims. This is not a general natural-language truth verifier: selecting an irrelevant but valid period or an incorrect nonnumeric explanation is still possible.

Responses/tool call IDs and arguments are validated before execution, including duplicate call IDs. Provider auth/rate/configuration failures receive safe codes, without SDK details. Cancellation propagates browser AbortController → Express close → orchestrator signal → SDK request options; queued reads check the same signal. Synthetic local HTTP tests exercise this chain at the provider boundary. In-flight database reads and remote work/billing cannot be guaranteed to stop. SDK retries remain disabled and all Prompt B limits are retained.

Diagnostics add actual provider-call/error counts, cumulative serialized tool bytes and supplied per-exchange token detail fields. Invalid usage shapes fail safely; omitted usage/details remain absent rather than estimated. There is no prompt/answer/tool-payload log. The frontend validates successful API envelopes, renders escaped text, focuses the question input, permits explicit retry and ignores late success/failure from cancelled requests. The existing Dashboard/GIS lifecycle is unchanged.

`backend/evals/` runs typed synthetic fixtures against scripted Responses mocks without environment loading, MongoDB connections or live SDK calls. See [ai-evaluation.md](ai-evaluation.md) for categories, failure probes, measurement limits and the separation between deterministic finance, orchestration, grounding and real model quality.
