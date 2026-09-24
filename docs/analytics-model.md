# Analytics model

All dashboard datasets use the same validated `period` and `category` filters. Periods follow the Los Angeles calendar: Monday-start week, calendar month, or calendar year. A category selects deliveries by their pickup merchant's category. `all` includes every observed category. The displayed range is inclusive in local calendar dates and uses an exclusive UTC end instant for database queries.

## Pickup Volume

Pickup Volume answers: where is the largest amount of personally observed pickup activity occurring? Each physical merchant record is a separate public point. Heatmap weight is that merchant's filtered delivery count; Points mode shows its public location, with size based on that count. Two stores of one brand remain separate features.

## Merchant Diversity

Merchant Diversity answers: where is the widest variety of distinct observed merchants? For the filtered deliveries, the backend groups by merchant ID. Each active merchant contributes exactly one unit, equivalent to `COUNT(DISTINCT merchantId)` over the selected period and category. The heatmap weights each active merchant location equally; Points mode shows those public locations. Repeat pickups at one location do not increase its diversity weight.

This PoC uses a point density heatmap, so visual overlap suggests nearby variety. It does **not** calculate distinct merchants per fixed neighborhood, grid, or hexagon. The map radius and zoom affect the visual impression. A true spatial bin analysis can be added when observations justify it; the current view must not be interpreted as a measured grid-level count.

## Destination Heatmap

Destination Heatmap answers: where does privacy-reduced observed destination activity concentrate? The server reads only persisted generalized `destinationLocation` values for filtered deliveries and groups equal generalized coordinates into cells with `count`. The dedicated `GET /api/dashboard/destination-heatmap` response contains only `{ cells: [{ location, count }] }`. It supplies the generalized coordinates required by ArcGIS, without addresses, delivery IDs, merchant details, or exact geocoder results.

The UI renders these cells only through a heatmap. There are no destination point markers, popups, coordinate readouts, tables, or single-destination inspection controls. Category wording is “observed destination activity associated with … deliveries.” It does not imply residential preferences or population-wide demand.

The same period and category filter applies to the destination endpoint and the main dashboard response. An area with multiple generalized records receives a higher heatmap weight. Rounding to generalized cells and a heatmap do not guarantee anonymity; sparse observations remain a limitation.

## Earnings

Known payouts alone contribute to totals and averages. Missing payout is distinct from a recorded `$0`. Each average reports its known-payout `sampleCount`.
