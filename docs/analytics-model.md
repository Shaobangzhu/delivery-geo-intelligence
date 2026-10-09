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

Every category-specific view excludes adjustments. Merchant rankings, averages, popup earnings, delivery counts, timelines, and map datasets remain Delivery-based. Delivery payout must represent the delivery-level amount, while Prop 22 is entered separately; no amount is duplicated across deliveries. A.2 Core and A.2.1 provide distinct efficiency views below; individual adjustment allocation remains **DEFERRED**.

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

**DEFERRED:** A secondary rate-based estimate requires sourced applicable wage jurisdictions and compensation rates. One Eastvale rate is not assumed to cover a multi-city statement. Prop 22 mileage compensation, IRS deductions, and actual vehicle costs are distinct and none are calculated in A.0. Individual adjustment allocation and per-delivery optimization remain deferred. A.2 Core below implements unadjusted delivery/session efficiency; A.2.1 separately implements actual settlement-period adjustment analysis.

## A.1 personal session economics

This model describes the user's 2022 Tesla Model Y Long Range and confirmed operating choices; it is not a generic EV or fleet-cost model. A complete operating Session includes driving/time outside active deliveries. Session strategy labels describe Wide-Area Marathon (2024), Home-Based Multi-Order (2025), and Eastvale Local-Only (2026), plus Other. They do not establish optimality and are never assigned automatically by year.

Four independent mileage concepts coexist: Delivery distance, official Prop 22 engaged miles, independently recorded total Session driving, and manually identified IRS-eligible business miles. None substitutes for another. Official engaged seconds also remain distinct from Delivery duration and elapsed Session time. No mileage or time observation is inferred from linked Deliveries.

The initial incremental energy **cash** rate is $0.00/mi, based on the user's reported near-zero net household electricity bill with 8.8 kW solar/SCE NEM 2.0 and home-only charging during Uber Eats work. Opportunity cost is outside this version. The observed four-tire Pirelli Scorpion replacement cost is $1,600; it is not evidence of lifespan or a guaranteed future replacement price. Paid repairs to date are $0, the recall was free, and America's Tire rotations/alignment have no cash cost. This does not imply zero future repair risk. DIY washing and cabin filters are excluded; insurance/other ownership costs are not modeled.

```text
tireRate = replacementSetCost / configuredExpectedLife
modeledCostPerMile = energyCashRate + tireRate + marginalDepreciationRate
sessionComponentCost = recordedTotalDrivenMiles × configuredComponentRate
```

Only known rates and independently recorded miles are multiplied. Unknown tire life or depreciation remains null; an explicit zero remains valid. The known + estimated subtotal sums available raw components, then rounds once to cents. Component display amounts are rounded separately and can differ from the rounded subtotal by a cent. Full economic cost is returned only when all three components are computable. Unknown Session miles makes all amounts unavailable, even if the energy rate is known zero. Nonfinite/out-of-range monetary outputs become unavailable. Tire wear is amortized estimation and marginal depreciation is an economic assumption, not a recorded cash expense or a tax depreciation calculation.

All previews use the **current** vehicle profile, without historical snapshots. Changing tire assumptions can revise historical Session previews without changing Session observations. Complete means complete within the three modeled categories; excluded costs remain excluded. A.1 does not deduct these amounts from Dashboard earnings or calculate net earnings, hourly rates, or merchant profitability.

## Annual mileage and Standard Mileage boundaries

Confirmed history attributes all reported 2024–2025 business mileage to Uber Eats: 5,737 / 13,350 = approximately 42.97%, and 2,310 / 11,549 = approximately 20.00%. Realtor/other purposes are explicitly zero. Future unknown purpose categories prevent a claimed complete business total or percentage. Known components are still reported separately. Annual observations are not aggregated from Session miles, avoiding duplicate or inferred eligibility.

The stored tax method is `standard_mileage`. Deduction preview uses entered reported business miles only for sourced supported years:

- **2024:** $0.67/mi, effective January 1–December 31, per [IRS Notice 2024-08](https://www.irs.gov/irb/2024-02_IRB).
- **2025:** $0.70/mi, effective January 1–December 31, per [IRS Notice 2025-05](https://www.irs.gov/pub/irs-drop/n-25-05.pdf).

These yield $3,843.79 and $1,617.00 on the confirmed historical totals. Rates are selected by exact tax year and never carried forward. 2026/later and incomplete purpose totals display unavailable. The preview assumes the manually entered annual business classification; it does not verify eligibility, prepare returns, or estimate tax savings. No greater-than-50% threshold is imposed on ordinary Standard Mileage. Standard Mileage accounts for ordinary vehicle costs, including a tax depreciation component; the application calculates no additional actual-expense or tax depreciation deductions. [IRS business use of car guidance](https://www.irs.gov/taxtopics/tc510) explains the distinction.

A deduction is not cash received, Prop 22 income, actual repair/energy expense, or an addition to profit. It does not determine marginal economic depreciation or a Prop 22 mileage rate. Starting/returning home is not automatically classified as deductible. No Session-level deduction or Realtor trip tracking is performed. **DEFERRED:** merchant profitability, individual adjustment allocation, optimization, and vehicle/tax external-service integrations. Prompt B explains these existing calculations without extending them.

## A.2 Core: deterministic efficiency

`backend/src/efficiency.ts` isolates MongoDB reads from pure delivery/session mathematics. `GET /api/efficiency` reuses the validated Dashboard period/category/asOf definition and Los Angeles period resolver. It returns fixed-size aggregates: `filters`, `deliveryEfficiency`, `sessionEfficiency`, five `strategyComparison` groups, and `dataQuality`. It does not return individual records, IDs, notes, addresses, coordinates, or tax history; no new indexes or persisted metrics are introduced.

Delivery payout per recorded hour is `sum(payout) / sum(recordedDurationSeconds / 3600)` for deliveries with known finite nonnegative payout and positive duration. Per-mile payout uses the analogous cohort with positive delivery distance. The numerator and denominator always come from the same cohort. Zero payout participates; missing payout does not. Recorded duration is not official Prop 22 engaged time. These are gross payout rates, not profit.

Sessions are included only when `startedAt >= period.start`, `endedAt <= period.endExclusive`, and duration is positive. Overlapping sessions crossing either boundary are excluded, counted once for that selected period, and never split. A session ending exactly at the boundary belongs to the preceding period; a session starting there belongs to the next. The same selection rule governs all-session and strategy aggregates, including DST periods. Linked revenue uses every explicitly associated Delivery regardless of its pickup date or merchant category. No timestamp matching or annual-mileage substitution occurs.

For each session, known payout sums only known linked payouts. Missing linked payout prevents a complete revenue rate and economic-profit estimate. No links means unknown attribution, not zero revenue. Hourly rates require complete linked revenue and valid elapsed duration; mileage rates additionally require positive session miles. Missing miles prevents profit; known zero miles permits zero modeled costs/profit but no per-mile rate. Full profit requires linked records, all payouts, positive duration, known miles, and complete `calculateVehicleCost()` output. Profit is linked payout minus full A.1 cost; its hourly rate divides by complete elapsed session hours. No IRS deduction, tax, or unallocated Prop 22 adjustment enters these calculations.

Aggregates report a metric's `value` or null, `unit`, `sampleCount`, `excludedCount`, and deduplicated reasons. Delivery samples count deliveries; session samples count sessions. Known payout totals include partial observations (sessions with at least one known payout), with missing-payout counts/reasons alongside them. Known/estimated cost-component totals include partial A.1 estimates and remain labeled partial. Full cost and profit totals sum their own eligible cohorts; excluded counts must be read with each metric. Profit can be available for a subset while other sessions remain incomplete. Aggregate session and profit hourly/mileage rates use sums within their corresponding eligible cohort, never arithmetic means of row-level rates. Empty cohorts or nonfinite results are null. Cost basis is the current profile, not a historical snapshot.

Session/strategy output has `categoryScope: "all"`, `selection: "whole_interval"`, and `profitBasis: "pre_tax_excluding_unallocated_prop22"`. Category filters affect Delivery metrics only. Splitting multi-category session revenue by category without attributable time/miles would be misleading. Stored strategies form four named groups and Unclassified; no strategy is inferred or recommended. Group output includes counts, partial known payout, known duration/miles, weighted rates, costs/profit, and completeness.

Data quality distinguishes missing payout/duration/distance from known zero, deliveries without session association, sessions without miles/links, incomplete modeled costs, missing linked payouts, unclassified strategy, and period-boundary exclusions. A.2.2 also reports `sessionsWithIncompleteAssociations`; a pending Session adds `incomplete_session_associations` and cannot supply complete revenue/rates/profit, even when current linked payouts appear complete. Partial known payout remains labeled an observation. Zero denominators are reflected in rate exclusions rather than counted as missing. Delivery quality uses filtered pickup-period records; session quality uses all-category whole sessions. Normal Dashboard cash-basis earnings and A.0 reconciliation remain unchanged; unsafe monetary aggregates now return null instead of nonfinite values or incomplete cash totals. A.2.1's separate settlement-period view follows below; it does not allocate payments to Core's sessions or strategies.

## A.2.1 settlement-period efficiency

`settlementEfficiency.ts` computes read-only results. Cash basis uses receipt dates as before. Work-period basis selects Delivery `pickedUpAt` in the inclusive statement dates resolved to `[LA start midnight, LA midnight after end)`. DST follows the same calendar utilities as Dashboard. Pickup time and date-only boundaries are analytical approximations of Uber attribution/cutoffs. Coverage is never inferred from payment date. Each settlement adds its actual adjustment exactly once to known covered payouts; guarantees, expected reconciliation amounts, engaged time/miles, annual IRS miles, deductions, and tax do not enter revenue or denominators.

The optional `sessionCoverageConfirmed` boolean is a manual declaration that all relevant deliveries/sessions were recorded. Absent/false is unconfirmed. It is not inferred from counts, is not reset by analytics, and cannot independently prove absent records do not exist. Structural checks evaluate separately. Every covered Delivery needs known payout and an explicit link to an existing, valid session wholly within the interval. Included sessions need positive duration, finite nonnegative total mileage, linked deliveries with known payouts, and pickups inside both coverage and their session interval. All overlapping boundary-crossing sessions are counted/excluded and block coverage. Overlapping included sessions, unlinked or dangling/outside links, invalid session times, and sessions without deliveries block rates. Half-open adjacent sessions/settlement intervals do not overlap.

Every stored valid settlement period is checked for overlap, including duplicate intervals and older records omitted from the recent response. Affected results are blocked; adjustments are neither merged nor summed, and records are not deleted. Recorded gross revenue is null for overlapping settlements or incomplete payouts. Otherwise it may show known recorded payouts plus the actual payment while coverage is unconfirmed; this is not independently complete observed history. Partial known revenue and counts remain visible when gross revenue is unavailable.

Only confirmed, structurally consistent coverage exposes complete summed raw Session hours/miles. Adjusted rates are recorded gross revenue divided by these complete denominators. There is no subset-rate fallback or engaged-time/distance substitution. Known zero miles contributes to the sum but cannot alone produce a per-mile rate. Status is unavailable for missing dates/activity, partial for blocked coverage or unavailable rates, and ready when both adjusted rates are supported. Vehicle-cost incompleteness can leave profit null even with ready earnings rates. Reasons remain actionable and retain the user's confirmation.

Current A.1 cost calculations are reused for each included session. Component/subtotal observations may be partial and show their sample counts; full period cost is exposed only after coverage passes and every included cost is complete. Profit equals gross revenue minus full cost and is pre-tax; hourly/mileage profit uses the same complete denominators. Costs are current assumptions, not historical snapshots, and complete means only the three modeled categories. Zero electricity cash cost remains the user assumption; unknown tire lifespan/depreciation is never replaced by zero. Nonfinite/unsafe outputs are null with numeric reasons.

The endpoint returns aggregates, settlement IDs and dates only, with no Delivery IDs, notes, addresses, or destination points. No metrics are persisted. It returns the 20 newest payments by payment date/ID, checks up to 1,000 payment metadata records for overlaps, and caps each Delivery/Session read and merged Delivery set at 10,000. Limits fail closed with 503, never silently compute truncated cohorts. Broad reads cover the recent periods plus all linked pickups (including outside coverage) and referenced outside sessions in a small fixed number of queries. No per-Delivery/Session/Merchant/strategy adjustment allocation, legal rate calculator, tax preparation, or prediction is implemented. Prompt B only adds explanations of these outputs.

## Prompt B explanation boundary

Ask DGI chooses among six validated read-only tools. Period summary projects Dashboard counts/cash income without map data. Delivery efficiency projects filtered recorded-delivery cohorts. Session efficiency and strategy comparison use all-category whole Sessions. Settlement efficiency selects at most five recent results (latest by default) or a matching ID within the existing service's recent twenty; it never performs an unrestricted settlement lookup. Data quality reuses Core counts plus up to five recent settlement status/reason summaries, with separate coverage scope. All tools preserve the existing process queue and deterministic outputs; no new formula, financial allocation or quality engine is introduced.

Final structured output contains a qualitative explanation and evidence IDs. Those IDs must refer to successful tool outputs from the same request; the server appends original numeric/status values and units/counts/reasons. No-tool, unknown-tool, invalid-argument, payload/round-limit, provider and unreferenced-number failures cannot return a successful analysis. Null is displayed as unavailable; observed zero is retained. Partial metrics and cohort exclusions remain explicit. The numeric-prose guard is syntactic, not complete semantic validation of an LLM answer.

An LLM may choose an inappropriate period/cohort, omit a relevant limitation, or misinterpret relationships. Read source scope/sample metadata before relying on explanations. Strategy comparisons remain descriptive; Core unadjusted rates and settlement-adjusted rates cannot establish Prop 22 improvement unless periods/cohorts/denominators align, and no new difference calculation is implemented. Suggestions are limited to existing History Delivery/Session/Payment/Vehicle forms and should use observed information only. No recommendation implies market-level demand or a tax conclusion.

Only explicit user requests trigger the model. `OPENAI_MODEL` is configurable, defaulting to documented `gpt-4.1-mini` with no reasoning setting. Three rounds/six tools/four Responses requests, 1,000 output tokens per exchange, 60 seconds, 48,000 bytes per result/128,000 total and no SDK retries bound a single request. Development token diagnostics sum provider-reported input/output tokens, including repeated input; they are not financial metrics or a dollar bill estimate. Tests mock the provider; live account/model behavior remains unverified.

## A.2.2 integrity and freeze boundaries

Dashboard, Core, and settlement multi-query HTTP reads share the existing Express process queue with domain writes. Each read therefore avoids intermediate write states in this process. Separate responses are not one shared snapshot; refresh after History edits. Native-driver service functions remain directly reusable, but callers outside these routes must provide equivalent coordination. External writers and other processes are not protected by this queue.

Session mutations first persist `associationIntegrity: "pending"`, then update fields/references. Recoverable failures restore the prior Session and membership; failed compensation or interrupted execution leaves guarded data for explicit user review. The guard is cleared only on a completed write. Included pending Sessions block settlement structural completeness even with user confirmation; complete denominators, adjusted rates, full cost/profit stay unavailable. This compensation/guard is not a transaction or a durable membership journal. Persistent outages and ambiguous acknowledgements may need manual recovery.

Date utilities retain ISO years below 100 rather than applying JavaScript's `Date.UTC` 1900 offset. Inclusive LA date boundaries, spring/fall DST, and adjacent periods retain the same semantics. Synthetic adversarial tests cover these boundaries, incomplete cohorts, association failures, concurrent PATCHes, and unsafe amounts; existing GIS/privacy and accounting regressions also pass. **A.2 CORE FROZEN** applies to this local deterministic PoC, with these limitations. Modeled profit covers only energy, tire wear, and marginal depreciation using current assumptions; it is not tax-adjusted net income. Strategy comparisons describe observed records and cannot establish causation.
