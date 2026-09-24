# Dashboard analytics

`GET /api/dashboard` returns all Dashboard cards, charts, rankings, and map datasets in one response. Query parameters use one validated backend filter definition:

| Parameter | Values | Default |
| --- | --- | --- |
| `period` | `week`, `month`, `year` | `week` |
| `category` | `all`, `restaurant`, `grocery`, `retail`, `other` | `all` |
| `asOf` | ISO calendar date, `YYYY-MM-DD` | current date in `America/Los_Angeles` |

Periods use Los Angeles calendar time. A week begins Monday and ends before the next Monday; a month or year follows the local calendar. The response includes UTC `start` and exclusive `endExclusive` instants, local `startDate` and inclusive `endDate`, and the time zone. `asOf` is intended for deterministic requests and tests; the Dashboard uses the current date.

The response contains `summary`, `categoryDistribution`, `pickupTimeline`, `topMerchants`, and `map`. The same period and category filter is applied to every dataset. Week and month timelines contain daily buckets; year timelines contain monthly buckets. Zero buckets are actual zero counts for the selected period.

`map.pickupVolume` contains observed merchant pickup locations with delivery counts. `map.merchantDiversity` contains active merchant locations, categories, and counts. `map.destinationHeatmap` groups stored generalized destination points and counts them. The frontend currently shows a map placeholder and switches its dataset and local Heatmap/Points control state; ArcGIS renderers are deferred. Destination Heatmap has no local Heatmap/Points toggle.

Total earnings sums only deliveries with a known payout and returns `{ value, sampleCount }`. When none have a known payout, `value` is `null`. A recorded `$0` payout contributes one sample. Merchant total and average earnings use the same known-payout rule and each ranking row returns `sampleCount`. Merchants with no known payouts cannot lead the total or average earnings cards. Ranking ties use sample count and then merchant name and ID for stable results.

Only observed records contribute to analytics. Merchant names and rankings come from MongoDB; no sample merchant ranking is built into the UI. Destination addresses and exact geocoder coordinates are absent from the dashboard response. Generalized destination coordinates should not be described as guaranteed anonymous.
