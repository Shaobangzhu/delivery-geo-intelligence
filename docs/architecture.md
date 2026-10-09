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

Dashboard All-category Total Earnings queries payments by the resolved Los Angeles calendar date range and combines their received amounts with known delivery payouts. Category and merchant earnings remain Delivery-only. This is cash-basis accounting, with no coverage allocation, per-delivery adjustment, migration, or efficiency analytics. ArcGIS and destination privacy are unaffected.

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

Dashboard queries still project only received amounts and payment dates. A.0 introduced no extra income or Dashboard KPI. Real statements, private exports, and credentials are not committed. A.1 adds the independent operating/cost foundation below; A.2 efficiency and AI assistance remain deferred.

## A.1 operating sessions and vehicle assumptions

History retains its existing Delivery and Prop 22 sections and adds Uber Eats Sessions plus a collapsed vehicle/annual-mileage panel. Three primary navigation pages remain. Centered Session, Vehicle, and Annual Mileage modals use the existing dialog/focus pattern. React requests Express session/settings APIs; native MongoDB stores `deliverySessions`, the singleton `vehicleEconomics`, and year-keyed `vehicleTaxYears` in the same DGI database/container/volume.

Session timestamps are UTC BSON Dates; React converts explicitly to/from America/Los_Angeles, independent of the browser's own timezone. For supported modern dates (2000–2100), skipped DST wall times are rejected and repeated times offer the two actual instants. Elapsed duration is derived rather than persisted.

Each Delivery may hold a single optional `sessionId`. Session DTO membership is derived from those references; no duplicate persisted ID arrays exist. Candidate deliveries are only suggestions from the chosen interval, and the user checks them explicitly. Linking rejects missing deliveries (422) and ownership by a different session (409). The existing process-level reference-write queue serializes association changes, session deletion, and Delivery deletion. Session deletion unlinks before removing the session; Delivery deletion needs no reverse-array cleanup. Unrelated Delivery facts survive these writes.

This protection is for the existing single Express process. Multiple collections are not updated in a MongoDB transaction on this standalone Docker deployment. A write failure can leave incomplete linking, and a multi-process deployment would need transactions or equivalent database enforcement. There is no inferred timing relationship, cascade deletion, migration, or automatic Session backfill.

Vehicle/annual initialization is an explicit CLI or UI action using `$setOnInsert` and fixed unique `_id` keys. It inserts missing confirmed records, never overwrites edits, and is absent from normal startup. The API calculates session costs from the current profile with a pure service; it persists observations/assumptions, not derived costs. Settings changes refresh displayed previews and do not modify past Session records. Historical profile versions and expense ledgers are not implemented.

Annual mileage separates Uber Eats, Realtor, and other purposes; it does not aggregate or assume deduction eligibility from sessions. Only sourced 2024/2025 deduction rates are supported. Economic cost and deduction previews do not enter cash-basis Dashboard earnings or Prop 22 reconciliation. No new dependencies, external vehicle APIs, timers, tracking, GIS layers, AI, or tax-return engine are added. **A.2 — DEFERRED:** net earnings, efficiency, profitability rankings, and optimization.
