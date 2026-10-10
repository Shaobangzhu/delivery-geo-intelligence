# Dashboard analytics

`GET /api/dashboard` returns all Dashboard cards, charts, rankings, and map datasets in one response. Query parameters use one validated backend filter definition:

| Parameter | Values | Default |
| --- | --- | --- |
| `period` | `week`, `month`, `year`, `all` | `week` |
| `category` | `all`, `restaurant`, `grocery`, `retail`, `other` | `all` |
| `year` | Integer from 2026 through the trusted current Los Angeles year; Year mode only | current year (or the year of `asOf`) |
| `asOf` | ISO calendar date, `YYYY-MM-DD` | current date in `America/Los_Angeles` |

Periods use Los Angeles calendar time. A week begins Monday and ends before the next Monday; a month or year follows the local calendar. The response includes UTC `start` and exclusive `endExclusive` instants, local `startDate` and inclusive `endDate`, and the time zone. `asOf` is intended for deterministic requests and tests; the Dashboard uses the current date.

The response contains `summary`, `categoryDistribution`, `pickupTimeline`, `topMerchants`, and `map`. The same period and category filter is applied to every dataset. Week and month timelines contain daily buckets; Year contains twelve monthly buckets; All contains yearly buckets from 2026 through the resolved reference year. Timeline counts use one pass over observations, including explicit empty buckets. Zero buckets are actual zero counts for the selected period.

`map.pickupVolume` contains observed merchant pickup locations with delivery counts. `map.merchantDiversity` contains active merchant locations, categories, and one `distinctMerchantCount` unit per merchant. A separate `GET /api/dashboard/destination-heatmap` endpoint returns only grouped persisted generalized coordinates and counts needed for heatmap rendering. Its query uses the same period and category definition. The metric alone determines representation; there is no separate map display selector.


## Historical Year and detailed All scope

The native Year dropdown defaults to Current Year, generates descending Los Angeles calendar years down to **2026**, and remembers the selection within the page session. Current follows the clock into a new year; an explicitly selected historical year remains selected. Time and category selections are independent. A minute timer and focus/visibility refresh advance an open page after a local date rollover. Preferences are not persisted.

All covers **2026-01-01 through the current Los Angeles calendar date**. Its exclusive end is the following local midnight, so future calendar days are excluded. It is detailed DGI history, not a combination of annual statements. The full selected calendar year is used in Year mode, including Current Year. All chart labels are full years; Year chart titles identify the selected year.

All three endpoints (`/api/dashboard`, `/api/dashboard/destination-heatmap`, `/api/efficiency`) use the same strict schema and resolver. Examples:

```text
/api/dashboard?period=year&year=2026&category=grocery
/api/dashboard/destination-heatmap?period=year&year=2026&category=grocery
/api/efficiency?period=all&category=all
```

`year` is valid only in Year mode; supplying both `year` and `asOf` is rejected (no precedence). With Year and only `asOf`, its calendar year is selected for legacy deterministic requests. With neither, the trusted current LA year is selected. All may use an explicit `asOf` from 2026-01-01 through the trusted current local date. Week/Month retain their existing deterministic `asOf` behavior. Invalid/malformed/future years, unknown fields and conflicting combinations return HTTP 400 on each endpoint. Boundaries use `[start, endExclusive)` with LA DST offsets, leap days and year transitions.

Request identity includes period, category, applicable year and local reference date. Superseded requests are aborted and ignored; previous widgets are hidden while updating, while the mounted MapView is retained. Destination requests use the same identity and only persisted generalized cells. There are no new GIS layers or destination inspection controls.

**Data limitations:** detailed tracking starts in 2026; January 1–September 23 backfill may be incomplete, with regular tracking from September 24 onward. Counts describe recorded observations, not proof that all activity was recorded. Official 2024/2025 Uber reports remain independent aggregates and never supply Dashboard earnings, Delivery/Session rows or map locations. Session/strategy metrics still include whole intervals only, exclude/count crossings without splitting, and retain ratio-of-sums and unknown-cost rules. Settlement Efficiency retains its own biweekly coverage and selection independently.

## Pickup Volume map

The browser uses only `VITE_ARCGIS_API_KEY` for the basemap. The private backend geocoding key remains server-side. The map is centered on the Eastvale area; each active physical merchant is a separate feature, even when names match.

One `Map` owns the basemap and two client-side `FeatureLayer`s: public merchants and generalized destination cells. One `MapView` remains mounted across metric and filter changes. The layers have explicit point schemas and start empty. `applyEdits()` adds, updates, or removes features when the filtered responses change. The metric determines the canonical representation on the existing layers:

- **Pickup Volume:** a `HeatmapRenderer` weighted by `deliveryCount` shows observed pickup activity intensity. Sparse-data density tuning remains in place. It has no individual point representation.
- **Merchant Diversity:** a `UniqueValueRenderer` on `category` shows one equal-size 24px point per distinct physical merchant. Self-contained SVG symbols combine red dining, green grocery basket, purple shopping bag, and slate business icons with a white outline. Delivery count and earnings do not control size.
- **Destination Heatmap:** a `HeatmapRenderer` weighted by `count` shows generalized observed destination intensity, with no individual markers or popups.

Pickup Volume asks a quantitative intensity question; Merchant Diversity asks an entity/category question. Destination activity is privacy-sensitive, so only a heatmap is offered. This PoC does not calculate distinct merchants per grid or hex cell.

The merchant `PopupTemplate` contains only merchant name, category, observed deliveries, total known earnings, average earnings, and its sample count. It has no destination field. The destination layer has popups disabled and only a count-weighted heatmap renderer. Entering destination mode closes open popups and hides the merchant layer. The layer is the data and styling definition; the `LayerView` is the view-specific rendering instance created by `MapView`. Its `updating` property drives the map progress indicator. The backend has already applied the period and category filters, so the LayerView does not repeat those filters.

React owns the map container. Async module loading and `whenLayerView()` check cancellation before attaching handles. Renderer changes replace only `layer.renderer`; filter changes edit only the relevant layer's features. Queued edit sequences skip superseded responses. On unmount, event and watcher handles are removed and `view.destroy()` releases the view and layers. Metric switching does not recreate the view.

Delivery earnings sum only known payouts. All-category Total Earnings also includes Prop 22 payments by payment date in the resolved local range; category views exclude them. The response exposes delivery/Prop 22 amounts and separate counts, retaining `sampleCount` for known delivery payouts. With neither known payouts nor payments, `value` is `null`. Unsafe monetary aggregates also return `null`; Total Earnings cannot fall back to the remaining income component when a known component is unsafe. A recorded `$0` payout contributes one sample. Merchant total and average earnings use the same known-payout rule and each ranking row returns `sampleCount`. Merchants with no known payouts cannot lead the total or average earnings cards. Ranking ties use sample count and then merchant name and ID for stable results.

Only observed records contribute to analytics. Merchant names and rankings come from MongoDB; no sample merchant ranking is built into the UI. Destination addresses and exact geocoder coordinates are absent from the dashboard response. Generalized destination coordinates should not be described as guaranteed anonymous.

## Efficiency Analytics (A.2 Core)

Below the main Dashboard content, a separate compact section loads `GET /api/efficiency?period=week|month|year|all&category=all|restaurant|grocery|retail|other`. It shares the Dashboard's validated filters, including optional deterministic `asOf`, but does not change cards, rankings, GIS requests, or cash-basis Total Earnings. Fetch cleanup aborts and ignores superseded requests; stale efficiency values are hidden when filters change. Loading, unavailable values (`—`), errors, and retry are handled independently of the main Dashboard.

Delivery cards show gross payout per **recorded delivery hour** and per **delivery mile**, with eligible/excluded delivery counts. Session cards show payout per **complete session hour/mile**, partial known linked payout, known/estimated cost components, full modeled cost, profit, and profit/hour. Session/strategy metrics are labeled **All Categories** regardless of the category filter. Their eligible/excluded samples count sessions; partial payout or cost totals are explicitly labeled. Profit is **Pre-tax, excluding unallocated Prop 22 adjustments**, and unavailable without complete linked payouts, valid session duration, known miles, and complete A.1 costs. IRS deductions remain separate.

The strategy table shows explicitly stored labels (plus Unclassified), session counts, weighted payout/hour and payout/mile, estimated profit, and incomplete counts. It makes no recommendation. All rates are ratios of sums within the corresponding eligible cohort. Whole sessions must fit inside the selected LA calendar period; crossing sessions are excluded without splitting and reported in Data completeness. Session linkage, rather than pickup-date overlap, determines attributed revenue. Annual mileage does not supply session data. Zero denominators and unknown inputs yield unavailable rates. Costs use current A.1 settings, not historical snapshots.

The Data completeness disclosure reports missing delivery inputs, absent session links, missing session miles, partial cost/revenue, unclassified sessions, and boundary exclusions. No individual destination data is included in efficiency responses or UI. Core remains unadjusted; the separate A.2.1 view below analyzes whole settlements. Tax calculations, recommendations, individual adjustment allocation, and AI remain deferred. See [analytics methodology](analytics-model.md) for exact cohort rules.

## Prop 22 Work-Period Efficiency (A.2.1)

The compact subsection loads `GET /api/efficiency/settlements` independently of the calendar/category filters and remains **All Categories · Settlement Coverage Period**. A selector contains up to 20 newest payments; Refresh reloads after History edits and preserves a selection still present. Loading, safe errors, retry, empty records, and limited-list notices are handled separately from A.2 Core. It does not change any GIS layer, main earnings card, ranking, reconciliation, or Core metric.

The UI explains: “Dashboard earnings use payment dates. This section attributes actual adjustments to their reported work periods.” It shows coverage/payment dates, actual adjustment, partial known Delivery payout, recorded gross revenue, complete Session hours/miles, adjusted rates, current modeled costs/profit, and status. Gross revenue may reflect recorded payouts before confirmation, without claiming independently complete coverage. Final denominators/rates/profit are `—` unless required confirmation and checks pass. User confirmation is shown separately from structural completeness; it remains checked when later inconsistencies block results.

Actionable reasons point to missing dates/payouts/miles/links, boundary crossings, overlapping sessions or settlements, outside pickups, incomplete association writes, and incomplete vehicle assumptions. Cost breakdown shows partial component observations and sample counts; full profit requires complete A.1 costs and is pre-tax with no IRS deduction/tax calculation. Date-only LA boundaries and pickup attribution are approximations of Uber cutoffs. Payments are not apportioned to sessions, deliveries, merchants, or strategies, and work-period totals must not be added to cash-basis totals. User declarations and recorded convenience samples cannot prove all activity exists. A.2.2 audited/froze these implementations; AI remains deferred.

## A.2.2 recovery and display hardening

Core's Data completeness includes **Sessions requiring association review**. A pending Session cannot produce complete revenue/rates/profit; settlement efficiency also blocks complete period attribution. History identifies the Session as **Association review required**, and its existing centered edit modal warns the user to review selected Deliveries. Saving explicitly resubmits membership for these marked records; a notes-only API edit cannot silently clear the warning. Partial observed amounts can remain visible with their incomplete reasons.

A failed Session/vehicle-settings reload clears prior records/settings instead of retaining an editable stale profile. Existing analytics request abort/active guards, filter transitions, pending submit prevention, error/empty displays, and centered-modal focus behavior remain covered by the frontend suite. No manual browser testing was performed for A.2.2. Analytics reads are coordinated with this Express process's writes; refresh remains necessary after edits or between separate requests. No new UI page, GIS mode, or feature was introduced.

## Optional local Home reference

The Dashboard can display a fixed-size blue/white house icon labelled **Home**. It is one Graphic in the existing MapView graphics overlay, visible in Pickup Volume, Merchant Diversity and Destination Heatmap across all time/category selections. It is not an observation, FeatureLayer, heatmap weight, distance calculation or routing feature. Filters do not recreate it or recenter the map.

For a local/private instance, obtain a reliable WGS84 address-point coordinate once and set both values in Git-ignored `frontend/.env`:

```env
VITE_DGI_HOME_LONGITUDE=
VITE_DGI_HOME_LATITUDE=
```

Use the existing backend `createArcGisStoredGeocoder()` with `ARCGIS_GEOCODING_API_KEY` for a one-time local lookup (`forStorage=true`), validating the match and point before copying longitude/latitude to the ignored frontend file. Such a lookup sends the supplied address to ArcGIS; do not print or save the address, raw response or private credential. It is not a new endpoint and is not performed when the map loads. Alternatively use an independently verified WGS84 point. Never guess coordinates. Restart Vite after changing local environment values; rebuild for a private production preview.

The marker is disabled by default. Missing, partial, nonfinite or out-of-range coordinates silently omit it while the rest of the map works. Longitude precedes latitude and is bounded to ±180/±90 respectively. No location is guessed from the map center or a zero fallback.

**Privacy:** Vite bundles `VITE_` values into browser-accessible assets. Git ignore prevents source-control disclosure, not disclosure to people who can access a configured deployment. Use this feature only in a local/private instance; leave both values empty before building a shared/public application. The exact point exists in the frontend configuration, built assets and map geometry, with only the generic Home attribute and no popup or address tooltip. It is never persisted to MongoDB, sent through Express, mixed with Delivery/Merchant data, or included in AI tools/evidence. Existing destination generalization remains unchanged.
