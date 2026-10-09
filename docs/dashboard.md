# Dashboard analytics

`GET /api/dashboard` returns all Dashboard cards, charts, rankings, and map datasets in one response. Query parameters use one validated backend filter definition:

| Parameter | Values | Default |
| --- | --- | --- |
| `period` | `week`, `month`, `year` | `week` |
| `category` | `all`, `restaurant`, `grocery`, `retail`, `other` | `all` |
| `asOf` | ISO calendar date, `YYYY-MM-DD` | current date in `America/Los_Angeles` |

Periods use Los Angeles calendar time. A week begins Monday and ends before the next Monday; a month or year follows the local calendar. The response includes UTC `start` and exclusive `endExclusive` instants, local `startDate` and inclusive `endDate`, and the time zone. `asOf` is intended for deterministic requests and tests; the Dashboard uses the current date.

The response contains `summary`, `categoryDistribution`, `pickupTimeline`, `topMerchants`, and `map`. The same period and category filter is applied to every dataset. Week and month timelines contain daily buckets; year timelines contain monthly buckets. Zero buckets are actual zero counts for the selected period.

`map.pickupVolume` contains observed merchant pickup locations with delivery counts. `map.merchantDiversity` contains active merchant locations, categories, and one `distinctMerchantCount` unit per merchant. A separate `GET /api/dashboard/destination-heatmap` endpoint returns only grouped persisted generalized coordinates and counts needed for heatmap rendering. Its query uses the same period and category definition. The metric alone determines representation; there is no separate map display selector.

## Pickup Volume map

The browser uses only `VITE_ARCGIS_API_KEY` for the basemap. The private backend geocoding key remains server-side. The map is centered on the Eastvale area; each active physical merchant is a separate feature, even when names match.

One `Map` owns the basemap and two client-side `FeatureLayer`s: public merchants and generalized destination cells. One `MapView` remains mounted across metric and filter changes. The layers have explicit point schemas and start empty. `applyEdits()` adds, updates, or removes features when the filtered responses change. The metric determines the canonical representation on the existing layers:

- **Pickup Volume:** a `HeatmapRenderer` weighted by `deliveryCount` shows observed pickup activity intensity. Sparse-data density tuning remains in place. It has no individual point representation.
- **Merchant Diversity:** a `UniqueValueRenderer` on `category` shows one equal-size 24px point per distinct physical merchant. Self-contained SVG symbols combine red dining, green grocery basket, purple shopping bag, and slate business icons with a white outline. Delivery count and earnings do not control size.
- **Destination Heatmap:** a `HeatmapRenderer` weighted by `count` shows generalized observed destination intensity, with no individual markers or popups.

Pickup Volume asks a quantitative intensity question; Merchant Diversity asks an entity/category question. Destination activity is privacy-sensitive, so only a heatmap is offered. This PoC does not calculate distinct merchants per grid or hex cell.

The merchant `PopupTemplate` contains only merchant name, category, observed deliveries, total known earnings, average earnings, and its sample count. It has no destination field. The destination layer has popups disabled and only a count-weighted heatmap renderer. Entering destination mode closes open popups and hides the merchant layer. The layer is the data and styling definition; the `LayerView` is the view-specific rendering instance created by `MapView`. Its `updating` property drives the map progress indicator. The backend has already applied the period and category filters, so the LayerView does not repeat those filters.

React owns the map container. Async module loading and `whenLayerView()` check cancellation before attaching handles. Renderer changes replace only `layer.renderer`; filter changes edit only the relevant layer's features. Queued edit sequences skip superseded responses. On unmount, event and watcher handles are removed and `view.destroy()` releases the view and layers. Metric switching does not recreate the view.

Delivery earnings sum only known payouts. All-category Total Earnings also includes Prop 22 payments by payment date in the resolved local range; category views exclude them. The response exposes delivery/Prop 22 amounts and separate counts, retaining `sampleCount` for known delivery payouts. With neither known payouts nor payments, `value` is `null`. A recorded `$0` payout contributes one sample. Merchant total and average earnings use the same known-payout rule and each ranking row returns `sampleCount`. Merchants with no known payouts cannot lead the total or average earnings cards. Ranking ties use sample count and then merchant name and ID for stable results.

Only observed records contribute to analytics. Merchant names and rankings come from MongoDB; no sample merchant ranking is built into the UI. Destination addresses and exact geocoder coordinates are absent from the dashboard response. Generalized destination coordinates should not be described as guaranteed anonymous.

## Efficiency Analytics (A.2 Core)

Below the main Dashboard content, a separate compact section loads `GET /api/efficiency?period=week|month|year&category=all|restaurant|grocery|retail|other`. It shares the Dashboard's validated filters, including optional deterministic `asOf`, but does not change cards, rankings, GIS requests, or cash-basis Total Earnings. Fetch cleanup aborts and ignores superseded requests; stale efficiency values are hidden when filters change. Loading, unavailable values (`—`), errors, and retry are handled independently of the main Dashboard.

Delivery cards show gross payout per **recorded delivery hour** and per **delivery mile**, with eligible/excluded delivery counts. Session cards show payout per **complete session hour/mile**, partial known linked payout, known/estimated cost components, full modeled cost, profit, and profit/hour. Session/strategy metrics are labeled **All Categories** regardless of the category filter. Their eligible/excluded samples count sessions; partial payout or cost totals are explicitly labeled. Profit is **Pre-tax, excluding unallocated Prop 22 adjustments**, and unavailable without complete linked payouts, valid session duration, known miles, and complete A.1 costs. IRS deductions remain separate.

The strategy table shows explicitly stored labels (plus Unclassified), session counts, weighted payout/hour and payout/mile, estimated profit, and incomplete counts. It makes no recommendation. All rates are ratios of sums within the corresponding eligible cohort. Whole sessions must fit inside the selected LA calendar period; crossing sessions are excluded without splitting and reported in Data completeness. Session linkage, rather than pickup-date overlap, determines attributed revenue. Annual mileage does not supply session data. Zero denominators and unknown inputs yield unavailable rates. Costs use current A.1 settings, not historical snapshots.

The Data completeness disclosure reports missing delivery inputs, absent session links, missing session miles, partial cost/revenue, unclassified sessions, and boundary exclusions. No individual destination data is included in efficiency responses or UI. Core remains unadjusted; the separate A.2.1 view below analyzes whole settlements. Tax calculations, recommendations, individual adjustment allocation, and AI remain deferred. See [analytics methodology](analytics-model.md) for exact cohort rules.

## Prop 22 Work-Period Efficiency (A.2.1)

The compact subsection loads `GET /api/efficiency/settlements` independently of the calendar/category filters and remains **All Categories · Settlement Coverage Period**. A selector contains up to 20 newest payments; Refresh reloads after History edits and preserves a selection still present. Loading, safe errors, retry, empty records, and limited-list notices are handled separately from A.2 Core. It does not change any GIS layer, main earnings card, ranking, reconciliation, or Core metric.

The UI explains: “Dashboard earnings use payment dates. This section attributes actual adjustments to their reported work periods.” It shows coverage/payment dates, actual adjustment, partial known Delivery payout, recorded gross revenue, complete Session hours/miles, adjusted rates, current modeled costs/profit, and status. Gross revenue may reflect recorded payouts before confirmation, without claiming independently complete coverage. Final denominators/rates/profit are `—` unless required confirmation and checks pass. User confirmation is shown separately from structural completeness; it remains checked when later inconsistencies block results.

Actionable reasons point to missing dates/payouts/miles/links, boundary crossings, overlapping sessions or settlements, outside pickups, and incomplete vehicle assumptions. Cost breakdown shows partial component observations and sample counts; full profit requires complete A.1 costs and is pre-tax with no IRS deduction/tax calculation. Date-only LA boundaries and pickup attribution are approximations of Uber cutoffs. Payments are not apportioned to sessions, deliveries, merchants, or strategies, and work-period totals must not be added to cash-basis totals. User declarations and recorded convenience samples cannot prove all activity exists. A.2.2 Final Audit & Freeze and AI remain deferred.
