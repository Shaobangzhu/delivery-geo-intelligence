# Analytics model

All dashboard datasets use the same validated `period` and `category` filters. Periods follow the Los Angeles calendar: Monday-start week, calendar month, or calendar year. A category selects deliveries by their pickup merchant's category. `all` includes every observed category. The displayed range is inclusive in local calendar dates and uses an exclusive UTC end instant for database queries.

## Pickup Volume

Pickup Volume answers: where is the largest amount of personally observed pickup activity occurring? Each physical merchant record remains a separate feature, even when brand names match. A heatmap is the only representation, weighted by that merchant's filtered delivery count. It expresses observed activity intensity without individual point or size encoding.

## Merchant Diversity

Merchant Diversity answers: where are the distinct physical merchants I have observed, and what categories do they belong to? For the filtered deliveries, the backend groups by merchant ID. Each active merchant contributes exactly one unit, equivalent to `COUNT(DISTINCT merchantId)` over the selected period and category. Repeat pickups do not create additional diversity points.

The only representation is an equal-size category point map. A `UniqueValueRenderer` on `category` combines color with an icon: restaurant red/dining, grocery green/basket, retail purple/shopping bag, and other slate/business. All markers are 24px; delivery count, earnings, and popularity do not affect size.

The map shows observed entities and categories, not a distinct-merchant count per fixed neighborhood, grid, or hexagon. Nearby symbols may overlap at small scales. **PHASE 1.5:** true spatial bin analysis remains deferred until observations justify a defined spatial unit.

## Destination Heatmap

Destination Heatmap answers: where does privacy-reduced observed destination activity concentrate? The server reads only persisted generalized `destinationLocation` values for filtered deliveries and groups equal generalized coordinates into cells with `count`. The dedicated `GET /api/dashboard/destination-heatmap` response contains only `{ cells: [{ location, count }] }`. It supplies the generalized coordinates required by ArcGIS, without addresses, delivery IDs, merchant details, or exact geocoder results.

The UI renders these cells only through a heatmap. There are no destination point markers, popups, coordinate readouts, tables, or single-destination inspection controls. Category wording is “observed destination activity associated with … deliveries.” It does not imply residential preferences or population-wide demand.

The same period and category filter applies to the destination endpoint and the main dashboard response. An area with multiple generalized records receives a higher heatmap weight. Rounding to generalized cells and a heatmap do not guarantee anonymity; sparse observations remain a limitation.

## Earnings

Known delivery payouts alone contribute to merchant/category totals and merchant averages. Missing payout is distinct from a recorded `$0`. Each average reports its known-payout `sampleCount`.

## Cash-basis Total Earnings

For Category=All, Total Earnings = known Delivery payouts + Prop 22 adjustments whose `paymentDate` is between resolved local `startDate` and `endDate`, inclusive. Canonical date strings compare in calendar order, avoiding timestamp/timezone conversion for payment dates. Coverage dates are statement metadata and do not allocate current earnings.

The summary returns `value`, nullable `deliveryEarnings`, `prop22Earnings`, `deliveryPayoutSampleCount`, and `prop22PaymentCount`. Existing `sampleCount` remains the known delivery payout count. No known payouts and no payments yields `value: null`; payments alone produce their sum with zero delivery samples. A recorded zero payout is still known. Monetary combined sums are rounded to cents.

Every category-specific view excludes adjustments. Merchant rankings, averages, popup earnings, delivery counts, timelines, and map datasets remain Delivery-based. Delivery payout must represent the delivery-level amount, while Prop 22 is entered separately; no amount is duplicated across deliveries. **DEFERRED:** coverage-period allocation and duration/distance efficiency research.

## A.0 settlement reconciliation: diagnostics, not income

The pure backend `reconcileSettlement` function takes one received adjustment and its optional settlement observations. It uses only Uber's reported guarantee and eligible earnings **excluding tips**:

```text
expectedCents = max(0, round(reportedGuaranteedAmount × 100)
                        − round(eligibleEarningsExcludingTips × 100))
differenceCents = round(amount × 100) − expectedCents
```

An absolute difference of at most one cent is `matched`; a larger difference is `mismatch`. A missing, nonfinite, negative, non-cent, or unsafe comparison input is `insufficient_data`, with null expected amount/difference. Valid official zero is included. Integer-cent comparison handles binary floating-point subtraction such as 0.30 − 0.20 without unsafe currency equality. Received amount stays authoritative; results are derived on demand and not persisted.

A mismatch is a request for statement review, not proof of underpayment. Offsets, corrections, and separate payment components may invalidate this limited formula; no reason is invented. Engaged time/miles are retained for audit but do not influence this primary comparison.

Cash-basis Total Earnings still uses **only actual received `amount` by paymentDate**, plus known delivery payouts for All. The guarantee, expected adjustment, coverage dates, engaged time/miles, and difference do not affect income. Category-specific summaries, merchant earnings/rankings, charts, delivery counts, and all GIS datasets remain unchanged. No biweekly payment is spread across deliveries or merchants.

**DEFERRED:** A secondary rate-based estimate requires sourced applicable wage jurisdictions and compensation rates. One Eastvale rate is not assumed to cover a multi-city statement. Prop 22 mileage compensation, IRS deductions, and actual vehicle costs are distinct and none are calculated in A.0. Coverage allocation, per-delivery optimization, and efficiency KPIs remain deferred.
