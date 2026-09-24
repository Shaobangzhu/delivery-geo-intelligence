# Data model and API

The application uses the native MongoDB Node.js driver. The application database is `delivery_geo_intelligence`. IDs in HTTP responses are hexadecimal MongoDB ObjectId strings. The API validates request bodies and query parameters with Zod.

## Collections

| Collection | Fields | Indexes |
| --- | --- | --- |
| `merchants` | `_id`, `name`, `category`, `location`, `city` | `location` 2dsphere |
| `deliveries` | `_id`, `merchantId`, `pickedUpAt`, optional `payout`, `distanceMiles`, `destinationLocation`, `notes` | `destinationLocation` 2dsphere; `pickedUpAt` plus `_id`; `merchantId` plus `pickedUpAt` |

A Merchant is one physical pickup location, so two branches of one brand use separate records. `category` is `restaurant`, `grocery`, `retail`, or `other`. Merchant `location` is a GeoJSON Point with coordinates in `[longitude, latitude]` order. Only verified public business locations should be submitted. No merchant or delivery records are seeded by this phase.

`merchantId` references a Merchant record. `pickedUpAt` is stored as a BSON Date. `payout` is the manually recorded gross payout; absence means unknown, while an explicit `0` means zero. The API does not default absent payout to zero. Optional `destinationLocation` is reserved for a future generalized GeoJSON Point and has a 2dsphere index. No persisted `destinationAddress` field exists.

## Endpoints

| Method and route | Behavior |
| --- | --- |
| `GET /api/health` | Returns `ok` after a MongoDB ping, or 503 if unavailable |
| `GET /api/merchants` | Lists merchants by name |
| `POST /api/merchants` | Creates a merchant with `name`, `category`, `location`, `city` |
| `GET /api/deliveries` | Lists deliveries with filters and pagination |
| `GET /api/deliveries/:id` | Gets one delivery |
| `POST /api/deliveries` | Creates a delivery for an existing merchant |
| `PATCH /api/deliveries/:id` | Changes supplied fields; `null` clears optional payout, distance, or notes |
| `DELETE /api/deliveries/:id` | Deletes a delivery and returns 204 |

The create and patch Delivery requests accept `merchantId`, `pickedUpAt`, `payout`, `distanceMiles`, and `notes` as applicable. They reject `destinationAddress`, `destinationLocation`, and other unknown fields. The History-oriented Delivery response exposes `hasDestinationLocation` but never exposes coordinates. Synthetic destination points may be inserted directly into an isolated test database for controlled index tests; the public API cannot write them.

`GET /api/deliveries` accepts:

- `search`: case-insensitive literal substring of merchant name.
- `category`: one of the four Merchant categories.
- `from` and `to`: ISO 8601 timestamps with timezone offsets. `from` is inclusive; `to` is exclusive.
- `sort`: `newest` (default), `oldest`, `payoutDesc`, `payoutAsc`, `distanceDesc`, or `distanceAsc`.
- `page`: positive integer, default 1.
- `pageSize`: integer from 1 to 100, default 20.

List responses contain `data` and `pagination` with `page`, `pageSize`, `total`, and `totalPages`. A malformed ID or request returns 400. A well-formed missing delivery returns 404. A missing referenced merchant returns 422. All API errors avoid echoing request contents or database errors.

## Verification data

Integration tests use a uniquely named temporary database on the DGI MongoDB service and delete it afterward. Test merchants are explicitly synthetic and use synthetic coordinates. The tests do not contain customer addresses, real destination coordinates, or fabricated delivery history.
