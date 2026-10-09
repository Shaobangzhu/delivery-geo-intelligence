# Data model and API

The application uses the native MongoDB Node.js driver. The application database is `delivery_geo_intelligence`. Merchant, Delivery, Payment, and Session IDs in HTTP responses are hexadecimal MongoDB ObjectId strings. The vehicle profile is a singleton and annual records are keyed by numeric tax year. The API validates request bodies and query parameters with Zod.

## Collections

| Collection | Fields | Indexes |
| --- | --- | --- |
| `merchants` | `_id`, `name`, `category`, `publicAddress`, `location`, `city` | `location` 2dsphere |
| `earningsAdjustments` | `_id`, `type`, `paymentDate`, `amount`, optional `coverageStartDate`, `coverageEndDate`, `notes`, `settlementDetails` | `paymentDate` descending |
| `deliveries` | `_id`, `merchantId`, `pickedUpAt`, optional `sessionId`, `payout`, `distanceMiles`, `deliveryDurationSeconds`, `destinationLocation`, `notes` | `destinationLocation` 2dsphere; `pickedUpAt` plus `_id`; `merchantId` plus `pickedUpAt`; sparse `sessionId` |
| `deliverySessions` | `_id`, `startedAt`, `endedAt`, optional `strategy`, `totalDrivenMiles`, `taxEligibleBusinessMiles`, `notes` | `startedAt` descending plus `_id` |
| `vehicleEconomics` | `_id: "primary"`, vehicle name, energy/tire costs, optional tire life and marginal depreciation | built-in unique `_id` only |
| `vehicleTaxYears` | `_id: taxYear`, `taxYear`, annual vehicle miles and miles by purpose, `taxMethod` | built-in unique `_id` only |

A Merchant is one **physical pickup location**, not a brand. Two branches of one brand use separate IDs, even when they share a name. `category` is `restaurant`, `grocery`, `retail`, or `other`. `publicAddress` is a verified public business address; `location` is its exact stored-geocode GeoJSON Point in `[longitude, latitude]` order. New Merchant writes require an address and reject client-supplied coordinates. Earlier records can lack `publicAddress`; they retain their existing location until a verified address correction is supplied. No merchant or delivery records are seeded.

`merchantId` references a Merchant record. `pickedUpAt` is stored as a BSON Date. `payout` is the manually recorded gross payout; absence means unknown, while an explicit `0` means zero. The API does not default absent payout to zero. Optional `destinationLocation` holds a generalized GeoJSON Point and has a 2dsphere index. No persisted `destinationAddress` field exists.

`deliveryDurationSeconds?: number` is manually observed elapsed delivery duration from delivery history/Uber Eats records, stored as positive integer seconds. It is not derived from `pickedUpAt`. For example, 1 hr 12 mins 35 secs becomes `4355`. Missing means unknown/not yet entered, not zero. POST may omit the field; when supplied it must be a finite positive integer. PATCH accepts a positive integer to set/replace, `null` to `$unset`, or omission to preserve. API responses include the field only when present. No migration, estimates, or automatic backfill is performed.

The centered Add/Edit modal uses optional Hours (integer >= 0), Minutes (0–59), and Seconds (0–59). Blank components count as zero only when another component is entered; an all-blank group represents unknown duration. An entered total of zero is invalid. Known durations prepopulate the components; blanking all three clears a previously recorded duration. History shows formatted units or `—` for unknown values. **DEFERRED:** duration averages, distributions, rankings, earnings/hour, and other Dashboard analytics.

## Earnings adjustments

`EarningsAdjustment` is independent of Delivery and Merchant. Current type is only `prop22_guarantee`. `paymentDate` is a valid date-only `YYYY-MM-DD` string and `amount` is a finite positive USD number with at most two decimal places. Coverage dates are optional as a pair, valid date-only strings, with start <= end; no coverage period or 14-day interval is inferred. Notes are optional, trimmed, and limited to 2000 characters.

`/api/earnings-adjustments` supports GET (newest payment date first, ID breaks ties) and POST. `/:id` supports GET, PATCH, and DELETE, with the existing hexadecimal ObjectId validation and 404 for missing records. PATCH validates the resulting coverage pair, preserves omitted fields, and supports `null` to clear coverage dates or notes. Clearing coverage requires both dates to be removed together. Amount and payment date cannot be cleared. No Delivery migration or modifications occur.

## Endpoints

| Method and route | Behavior |
| --- | --- |
| `GET /api/health` | Returns `ok` after a MongoDB ping, or 503 if unavailable |
| `GET /api/merchants` | Lists merchants by name with `deliveryCount` |
| `GET /api/merchants/:id` | Gets one Merchant with `deliveryCount` |
| `POST /api/merchants` | Geocodes and creates a Merchant from `name`, `category`, `publicAddress`, `city` |
| `PATCH /api/merchants/:id` | Changes supplied metadata; re-geocodes only when `publicAddress` changes |
| `DELETE /api/merchants/:id` | Deletes an unused Merchant; returns 409 if any Delivery references it |
| `GET /api/deliveries` | Lists deliveries with filters and pagination |
| `GET /api/deliveries/:id` | Gets one delivery |
| `POST /api/deliveries` | Creates a delivery for an existing merchant |
| `PATCH /api/deliveries/:id` | Changes supplied fields; `null` clears optional payout, distance, duration, or notes |
| `DELETE /api/deliveries/:id` | Deletes a delivery and returns 204 |

The create and patch Delivery requests accept `merchantId`, `pickedUpAt`, `payout`, `distanceMiles`, `deliveryDurationSeconds`, `notes`, and transient `destinationAddress` as applicable. They reject direct `destinationLocation` and other unknown fields. The backend geocodes and generalizes a supplied address before writing only `destinationLocation`. The History-oriented Delivery response exposes `hasDestinationLocation` but never exposes coordinates. Synthetic destination points may be inserted directly into an isolated test database for controlled index tests; the public API cannot write them directly.

Merchant list/detail responses include `deliveryCount`, derived from Delivery references, plus the public address and exact business point when available. Normal metadata edits preserve `location`; an address edit replaces both `publicAddress` and the exact point. Because Deliveries reference `merchantId`, an address edit is a correction to the pickup location for existing history. A moved store should be created as a separate Merchant. Deletion does not reassign or cascade-delete Deliveries.

`GET /api/deliveries` accepts:

- `search`: case-insensitive literal substring of merchant name.
- `category`: one of the four Merchant categories.
- `from` and `to`: ISO 8601 timestamps with timezone offsets. `from` is inclusive; `to` is exclusive.
- `sort`: `newest` (default), `oldest`, `payoutDesc`, `payoutAsc`, `distanceDesc`, or `distanceAsc`.
- `page`: positive integer, default 1.
- `pageSize`: integer from 1 to 100, default 20.

List responses contain `data` and `pagination` with `page`, `pageSize`, `total`, and `totalPages`. A malformed ID or request returns 400. A well-formed missing delivery returns 404. A missing referenced merchant returns 422. All API errors avoid echoing request contents or database errors.

## A.2.1 settlement completeness metadata

`EarningsAdjustmentDocument` adds only optional `sessionCoverageConfirmed?: boolean`. Legacy absence means unconfirmed; explicit false/true are accepted by the existing strict POST/PATCH schemas and returned through existing payment responses. Omitted PATCH preserves the flag; null and string coercion are rejected. The Payment modal sends the flag only when manually changed. No defaults, automatic completeness inference, new collection, index, or migration are introduced. The flag never changes the actual received amount, A.0 reconciliation, or cash-basis earnings. It remains stored even if coverage dates are cleared or structural checks fail.

Coverage dates retain their inclusive ISO date meaning. Derived A.2.1 analysis resolves LA midnight boundaries and uses existing Delivery pickup times and explicit `sessionId` links; it stores no analytics results. `GET /api/efficiency/settlements` returns `{ data, limit: 20, totalSettlements, hasMore }` with newest-first settlement aggregates, confirmation/structural status, counts, rates, costs, and reasons. Output contains no Delivery IDs, notes or destination coordinates. Limits fail closed rather than truncating input cohorts; see [analytics model](analytics-model.md). No uniqueness constraint or automatic merging is applied to overlapping payments. A.2.2 final audit remains deferred.

## Verification data

Integration tests use a uniquely named temporary database on the DGI MongoDB service and delete it afterward. Test merchants use synthetic public-address tokens and coordinates returned by a mock geocoder. The tests do not contain customer addresses, real destination coordinates, or fabricated real delivery history.

## A.1 Session and vehicle data

```ts
interface DeliverySessionDocument {
  _id: ObjectId;
  startedAt: Date;
  endedAt: Date;
  strategy?: "wide_area_marathon" | "home_based_multi_order" | "eastvale_local_only" | "other";
  totalDrivenMiles?: number;
  taxEligibleBusinessMiles?: number;
  notes?: string;
}
interface VehicleEconomicsProfile {
  _id: "primary";
  vehicleName: "2022 Tesla Model Y Long Range";
  energyCashCostPerMile: number;
  tireReplacementSetCost: number;
  expectedTireSetLifeMiles?: number;
  marginalDepreciationCostPerMile?: number;
}
interface VehicleTaxYearRecord {
  _id: number; // unique tax year, no duplicate year records
  taxYear: number;
  totalVehicleMiles: number;
  uberEatsBusinessMiles: number;
  realtorBusinessMiles?: number;
  otherBusinessMiles?: number;
  taxMethod: "standard_mileage";
}
```

Session input requires offset-aware ISO timestamps and `endedAt > startedAt`; UTC instants are stored as BSON Dates. `sessionDurationSeconds` is returned as `(end-start)/1000`, never persisted. Miles are optional finite nonnegative observations, with explicit zero valid. If both are provided, IRS eligible business miles cannot exceed total session miles. Missing miles remain absent. Strategy is optional per session; no year-based assignment or automatic reconstruction from Delivery timestamps occurs. Notes are trimmed and limited to 2000 characters.

`DeliveryDocument.sessionId?: ObjectId` is the sole persisted association and has a sparse query index. Existing unassociated deliveries remain valid. Session requests may supply distinct `deliveryIds` (maximum 500) to explicitly replace membership. Omission preserves links; `[]` unlinks all. Responses derive `deliveryIds` and safe `linkedDeliveries` summaries (ID, merchant ID, pickup instant) from Delivery references; they do not expose destination coordinates. A normal time/mileage edit preserves links even outside the edited interval. Deletion unlinks and retains Deliveries; deleted Deliveries cannot leave stale reverse arrays. Direct client assignment through Delivery POST/PATCH remains unsupported.

The vehicle profile's initial values are name above, energy cash cost `0`, and observed replacement-set cost `1600`; tire life and marginal depreciation are absent. Cost fields must be finite/nonnegative; tire life must be positive and produce a finite wear rate. Settings PATCH omission preserves values; `null` clears optional life/depreciation. Costs and coverage history are not linked to Prop 22, merchants, or customer destinations.

Annual miles must be finite/nonnegative; the sum of **known** purpose components cannot exceed total vehicle miles. There is no independently maintained business total: API sums components. It returns `knownBusinessMiles` for partial observations, and `reportedBusinessMiles`/`businessUsePercentage` only when Realtor and other purposes are also known. Zero total vehicle miles makes the percentage unavailable. Missing future Realtor/other miles are unknown, not zero. Annual PUT replaces the year's observations; omitted optional categories clear them. Years 2000–2100 are accepted.

Explicit idempotent initialization (`npm run data:init-a1` or History's initialize button) uses `$setOnInsert`: 2024 has 13,350 total/5,737 Uber Eats miles; 2025 has 11,549 total/2,310 Uber Eats miles. Both use Standard Mileage with Realtor/other miles explicitly zero. It preserves user edits and creates no Delivery/Session records. No migration or startup overwrite occurs.

| Route | Behavior |
| --- | --- |
| `GET /api/delivery-sessions` | Newest-first Session DTOs with derived links, duration, and current-profile vehicle-cost preview |
| `GET /api/delivery-sessions/:id` | One Session DTO; 404 if absent |
| `POST /api/delivery-sessions` | Create session, optionally link explicitly selected Deliveries; 201 |
| `PATCH /api/delivery-sessions/:id` | Validate merged observations; omitted fields/links preserved; `null` clears optional fields |
| `DELETE /api/delivery-sessions/:id` | Unlink all Deliveries and remove Session; 204 |
| `GET /api/vehicle-economics` | `{ data: profileOrNull, historicalMileage: derivedAnnualDtos }` |
| `POST /api/vehicle-economics/initialize` | Insert only missing confirmed profile/history; idempotent |
| `PATCH /api/vehicle-economics` | Update initialized singleton; 404 if not initialized |
| `PUT /api/vehicle-mileage/:taxYear` | Validate/replace year's annual observations; 201 create or 200 edit |

Malformed IDs/inputs return 400; unavailable selected Deliveries return 422; an association owned by another Session returns 409. Cost DTOs expose nullable `rates`, component `amounts`, `knownAndEstimatedCost`, `fullEconomicCost`, `missingComponents`, and `completeness` (`complete`, `partial`, `unavailable`). Computed estimates, percentages, and deductions are not stored.

## Optional official settlement observations (A.0)

The existing `earningsAdjustments` collection is extended, with no migration, competing collection, or new index:

```ts
{
  _id: ObjectId,
  type: "prop22_guarantee",
  paymentDate: string, // YYYY-MM-DD; date actual money was received
  amount: number, // positive USD, at most two decimals; authoritative receipt
  coverageStartDate?: string,
  coverageEndDate?: string,
  notes?: string,
  settlementDetails?: {
    engagedSeconds?: number, // nonnegative safe integer, official engaged time
    engagedMiles?: number, // nonnegative finite observation, not rounded in storage
    eligibleEarningsExcludingTips?: number, // nonnegative USD, at most two decimals
    reportedGuaranteedAmount?: number // nonnegative USD, at most two decimals
  }
}
```

Currency is bounded to a safe integer-cent range. Settlement zero is valid and differs from missing. Delivery duration and distance are manually recorded delivery observations; they do not substitute for official engaged time or miles. Delivery payouts are not used to derive eligible earnings. Tips do not enter the guarantee comparison. No statement files/screenshots, reconciliation output, expected amount, or other redundant calculations are persisted.

Coverage dates remain an inclusive pair of statement dates and may be equal. No automatic inference from payment date or timestamp conversion occurs. If a future calculation needs an exact window, interpret `[start date midnight, midnight after end date)` in `America/Los_Angeles`; Uber's actual cutoff hour may differ. A.0 does not allocate income over that window.

POST accepts optional `settlementDetails`; its fields cannot be null. PATCH omission preserves existing values. A nested partial object merges with its existing siblings; a field's `null` removes that field, and `settlementDetails: null` removes the entire object. Empty nested PATCH objects are rejected. The resulting document is validated before MongoDB dotted `$set`/`$unset` writes. Amount/date and original identity are preserved unless explicitly edited. Clearing all observations in the modal clears the object. Existing records with no details remain editable with blank controls.

GET list retains `{ data: [...] }`. GET detail, POST, and PATCH return `{ data, reconciliation }`. The derived result includes `method: "reported_guarantee"`, `status`, `receivedAdjustment`, nullable `expectedAdjustment`/`difference`, and `tolerance: 0.01`. Missing or unusable comparison inputs produce `insufficient_data`. A documented method identifies this calculation independently of any future sourced rate-based verification.

Uber statements supply the manually entered observations and receipts. No real statement is part of the repository or test fixtures.
