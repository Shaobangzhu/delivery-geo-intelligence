# Data model and API

The application uses the native MongoDB Node.js driver. The application database is `delivery_geo_intelligence`. IDs in HTTP responses are hexadecimal MongoDB ObjectId strings. The API validates request bodies and query parameters with Zod.

## Collections

| Collection | Fields | Indexes |
| --- | --- | --- |
| `merchants` | `_id`, `name`, `category`, `publicAddress`, `location`, `city` | `location` 2dsphere |
| `earningsAdjustments` | `_id`, `type`, `paymentDate`, `amount`, optional `coverageStartDate`, `coverageEndDate`, `notes` | `paymentDate` descending |
| `deliveries` | `_id`, `merchantId`, `pickedUpAt`, optional `payout`, `distanceMiles`, `deliveryDurationSeconds`, `destinationLocation`, `notes` | `destinationLocation` 2dsphere; `pickedUpAt` plus `_id`; `merchantId` plus `pickedUpAt` |

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

## Verification data

Integration tests use a uniquely named temporary database on the DGI MongoDB service and delete it afterward. Test merchants use synthetic public-address tokens and coordinates returned by a mock geocoder. The tests do not contain customer addresses, real destination coordinates, or fabricated real delivery history.
