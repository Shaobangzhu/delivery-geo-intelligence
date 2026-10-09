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

Delivery History captures optional observed delivery duration from your delivery history/Uber Eats record. Add/Edit uses Hours, Minutes, and Seconds; MongoDB stores one positive integer `deliveryDurationSeconds`. Missing duration means unknown or not yet recorded, never zero. Existing records can be manually backfilled, corrected, or cleared by leaving all three fields blank. No migration or automatic backfill is performed. History displays concise durations; duration analytics are **DEFERRED**.

History also manages **Prop 22 Payments** as independent `EarningsAdjustment` records (`prop22_guarantee`). The secondary Add Prop 22 Payment action opens a centered modal; a separate newest-first table supports edit and confirmed delete. `paymentDate` is a `YYYY-MM-DD` date, while optional paired coverage dates capture the period shown in your Uber record.

The centered payment modal labels the authoritative income **Amount Received**. Its collapsed **Settlement Details (Optional)** section captures official Uber-reported engaged time, engaged miles, eligible earnings **excluding tips**, and guaranteed earnings. Blank means unknown; a reported zero is retained. Engaged Hours/Minutes/Seconds become one nonnegative `engagedSeconds` integer. These observations are never inferred from Delivery duration, distance, or payouts. Existing payments can be backfilled in place without a migration or a duplicate record.

After saving, reopen the payment to see backend-derived reconciliation: `max(0, reported guarantee − eligible earnings excluding tips)`, compared with the received amount using integer cents and an inclusive one-cent tolerance. Status is Matched, Needs review, or Insufficient data. Edits hide the old result until saved and reopened. Uber statements are the source of truth; offsets, corrections, or separate components can cause a mismatch that this simple comparison cannot explain. Calculated values are diagnostic and never replace received money.

Dashboard **All** Total Earnings combines known delivery payouts with Prop 22 amounts received within the resolved Los Angeles calendar range. Category-specific and merchant earnings remain delivery payouts only: no Prop 22 allocation is attempted. Coverage dates do not affect current totals. Delivery payout is the delivery-level amount; entering an adjustment never changes or duplicates Delivery payouts. **DEFERRED:** coverage-period efficiency, earnings/hour, earnings/mile, and merchant/category allocation.

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

## Deferred operations-analysis roadmap

- **A.1 — IMPLEMENTED:** Operating sessions, explicit Delivery links, personal vehicle assumptions, cost completeness, and annual business-mileage history.
- **A.2 — DEFERRED:** Efficiency/net-earnings analytics, earnings/hour or earnings/mile, merchant profitability, and per-delivery/merchant/category allocation.
- **FUTURE — DEFERRED:** AI operations analyst, OpenAI/tool calling, AI explanations, and autonomous optimization.
- **DEFERRED:** Rate-based statutory verification and historical legal rates. A multi-city settlement cannot use one Eastvale wage without evidence of applicable jurisdictions and rates. No such assumptions are made here.
