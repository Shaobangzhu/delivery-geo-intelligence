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
