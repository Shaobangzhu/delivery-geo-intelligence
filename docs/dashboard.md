# Dashboard analytics

`GET /api/dashboard` returns all Dashboard cards, charts, rankings, and map datasets in one response. Query parameters use one validated backend filter definition:

| Parameter | Values | Default |
| --- | --- | --- |
| `period` | `week`, `month`, `year` | `week` |
| `category` | `all`, `restaurant`, `grocery`, `retail`, `other` | `all` |
| `asOf` | ISO calendar date, `YYYY-MM-DD` | current date in `America/Los_Angeles` |

Periods use Los Angeles calendar time. A week begins Monday and ends before the next Monday; a month or year follows the local calendar. The response includes UTC `start` and exclusive `endExclusive` instants, local `startDate` and inclusive `endDate`, and the time zone. `asOf` is intended for deterministic requests and tests; the Dashboard uses the current date.

The response contains `summary`, `categoryDistribution`, `pickupTimeline`, `topMerchants`, and `map`. The same period and category filter is applied to every dataset. Week and month timelines contain daily buckets; year timelines contain monthly buckets. Zero buckets are actual zero counts for the selected period.

`map.pickupVolume` contains observed merchant pickup locations with delivery counts. `map.merchantDiversity` contains active merchant locations, categories, and one `distinctMerchantCount` unit per merchant. A separate `GET /api/dashboard/destination-heatmap` endpoint returns only grouped persisted generalized coordinates and counts needed for heatmap rendering. Its query uses the same period and category definition. Destination Heatmap has no local Heatmap/Points toggle.

## Pickup Volume map

The browser uses only `VITE_ARCGIS_API_KEY` for the basemap. The private backend geocoding key remains server-side. The map is centered on the Eastvale area; each active physical merchant is a separate feature, even when names match.

One `Map` owns the basemap and two client-side `FeatureLayer`s: public merchants and generalized destination cells. One `MapView` remains mounted across metric and filter changes. The layers have explicit point schemas and start empty. `applyEdits()` adds, updates, or removes features when the filtered responses change. The merchant layer powers both local modes:

- **Heatmap:** `HeatmapRenderer.field = deliveryCount` weights density by personally observed pickup count, rather than assigning equal weight to every merchant.
- **Points:** `SimpleRenderer` uses a size visual variable on `deliveryCount` to show specific public merchant locations.

Merchant Diversity uses the same public layer with `merchantWeight = 1` for every distinct active merchant. Its heatmap shows nearby observed merchant variety rather than repeated pickup volume. Points mode shows individual public merchants. This PoC does not calculate a distinct-merchant count per grid or hex cell.

The merchant `PopupTemplate` contains only merchant name, category, observed deliveries, total known earnings, average earnings, and its sample count. It has no destination field. The destination layer has popups disabled and only a count-weighted heatmap renderer. Entering destination mode closes open popups and hides the merchant layer. The layer is the data and styling definition; the `LayerView` is the view-specific rendering instance created by `MapView`. Its `updating` property drives the map progress indicator. The backend has already applied the period and category filters, so the LayerView does not repeat those filters.

React owns the map container. Async module loading and `whenLayerView()` check cancellation before attaching handles. Renderer changes replace only `layer.renderer`; filter changes edit only the relevant layer's features. Queued edit sequences skip superseded responses. On unmount, event and watcher handles are removed and `view.destroy()` releases the view and layers. Metric switching does not recreate the view.

Total earnings sums only deliveries with a known payout and returns `{ value, sampleCount }`. When none have a known payout, `value` is `null`. A recorded `$0` payout contributes one sample. Merchant total and average earnings use the same known-payout rule and each ranking row returns `sampleCount`. Merchants with no known payouts cannot lead the total or average earnings cards. Ranking ties use sample count and then merchant name and ID for stable results.

Only observed records contribute to analytics. Merchant names and rankings come from MongoDB; no sample merchant ranking is built into the UI. Destination addresses and exact geocoder coordinates are absent from the dashboard response. Generalized destination coordinates should not be described as guaranteed anonymous.
