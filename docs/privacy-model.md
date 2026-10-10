# Residential destination privacy model

## Public pickup locations versus private destinations

A Merchant is one physical **public business** pickup location. Its verified `publicAddress` and exact stored-geocoded GeoJSON `location` may be persisted and displayed. Merchant points are not rounded by destination privacy rules. Two stores with the same brand name remain separate records with separate IDs.

A Delivery destination is a private residential location. Its raw address is transient request input; the exact geocoder point is transient process data. Only a generalized `destinationLocation` is persisted. Delivery responses do not expose the address or point. The two geocoding workflows share only the lower-level stored ArcGIS lookup and remain separate after it returns an exact point.

The destination address is transient form input. The backend passes it to ArcGIS stored geocoding, obtains an exact coordinate in memory, reduces coordinate precision, and persists only the resulting GeoJSON Point. Neither `destinationAddress` nor the exact residential geocoder coordinate is a MongoDB field. Delivery API responses expose only `hasDestinationLocation`, not an address or coordinates. The application does not log request bodies, ArcGIS payloads, or provider error text.

```text
transient address → Express → ArcGIS stored geocode → exact coordinate in memory
                                                    ↓
                                         deterministic rounding
                                                    ↓
                                   generalized GeoJSON Point → MongoDB
```

## Coordinate reduction

`DESTINATION_COORDINATE_DECIMALS` controls rounding of WGS84 longitude and latitude to 0, 1, or 2 decimal places. The default is 2. At approximately 34° north, two decimal places form cells about 0.9 km east-west by 1.1 km north-south; rounding can move a point by roughly half a cell on each axis. These are approximations, not a fixed-radius privacy guarantee. Lower settings are coarser. The operation is a pure, deterministic function: the same input and setting produce the same point.

Precision reduction is **not guaranteed anonymity**. Repeated observations, sparse areas, or other information can still reveal patterns. Destination visualization avoids individual destination points and popups.

Changing the precision setting affects new or replaced destinations only; existing stored points are not recalculated automatically.

## Boundaries and limitations

- The private ArcGIS key is read only by the backend from `ARCGIS_GEOCODING_API_KEY`.
- Merchant public address corrections change the pickup point associated with every historical Delivery referencing that Merchant ID. A moved store should be recorded as a new Merchant; temporal Merchant location history is not implemented.
- The address is sent to ArcGIS over HTTPS in a POST body. ArcGIS necessarily receives it to geocode; it is not stored by this application's database or application logs.
- Exact coordinates and address strings exist briefly in process memory during the request; JavaScript does not provide a reliable memory-wipe guarantee.
- API writes reject direct `destinationLocation` input. The only application write path for a destination is geocode and generalize.
- Error responses do not include the address, provider response, or key.
- The dedicated destination heatmap API returns only grouped, persisted generalized coordinates and counts needed for heatmap rendering. It does not return addresses, exact geocoder results, delivery IDs, or per-delivery details. These generalized coordinates are transport data for ArcGIS, never a coordinate readout or list in the interface.
- Destination mode uses a heatmap-only layer with popups and individual point rendering disabled. Switching into this mode closes an open merchant popup and hides the public merchant layer. Time and category changes replace destination cells rather than keeping a previous filter's locations visible.
- Free-text notes must not be used for customer addresses or other private location details; this boundary concerns the dedicated destination field and cannot classify every possible free-text note.

No real address, exact residential coordinate, or fabricated delivery history is included in code, tests, or documentation.

## Prompt B: AI explanation data boundary

The on-demand Ask DGI endpoint sends the submitted question and compact domain aggregates to OpenAI. It excludes stored Delivery/Session/Payment notes, Merchant names/addresses, exact/generalized destination points, raw map payloads and credentials. Settlement dates and aggregate financial observations can be transmitted. Prompt C removes settlement record IDs from tool results; only request-scoped evidence/source identifiers are needed. An ID or private content explicitly typed into the submitted question is still transmitted. Questions are user input: do not paste private addresses, notes or secrets. The application does not claim automatic detection/redaction of everything a user might type.

The OpenAI key is read only on the backend from `OPENAI_API_KEY`, never a VITE variable or response field. Optional `OPENAI_MODEL` selects a supported Responses/function-calling model. Existing frontend/private ArcGIS credential separation and residential generalization remain unchanged. Tool schemas reject arbitrary fields/query operators; their fixed allowlist only calls existing read-only services through the process coordination queue. No filesystem, shell, network-search or write tools exist. Retrieved values are treated as data rather than instructions, and no raw free-text records enter the model context.

User questions, answers, provider errors and tool payloads are not persisted or logged. With `NODE_ENV=development`, logs contain only generated request ID, model, allowlisted tool names/count, latency, provider-call/error counts, cumulative tool bytes, supplied per-exchange token totals/details and outcome. Errors expose controlled codes/messages, not SDK objects or keys. HTTP responses use `Cache-Control: no-store`; OpenAI requests use `store: false`. These settings do not assert that the provider retains no data under its own policies. Existing privacy limits of observational data remain applicable.

React renders answers as escaped plain text. Close/unmount aborts pending requests; there is no chat collection or long-term memory. Numeric metrics are rendered from this request's evidence, but qualitative LLM explanations can still be mistaken or manipulated; this is not a complete prompt-injection or semantic correctness guarantee. No live provider test was performed, and mocked tests use only synthetic records in isolated databases.


## Prompt C: evaluated aggregate boundary

A recursive allowlist removes unknown fields, unnecessary record IDs, notes, public addresses, map data and destination coordinates before tool output enters provider context. Strings are restricted to domain enums, canonical ISO dates and server-authored limitations/backfill instructions; injected record text in a retained date/reason field produces a controlled failure. Tool schemas accept no arbitrary filters, URLs, filesystem paths, shell operations, write actions or client credentials. Adversarial synthetic sentinels test these exclusions across the original six tools and the added annual aggregate tool.

Evidence IDs are valid only for the current successful tool executions. Selected values carry exact scope, units, sample/completeness metadata, including unknown versus recorded zero. Cross-scope/cohort comparisons use server-authored limitations rather than model comparative prose. This does not guarantee anonymity, detect every private detail in user questions or eliminate every misleading qualitative statement. React response validation and escaping protect the rendering boundary; neither is a model truth guarantee.

Default evaluation requires no production credentials or records and makes zero live OpenAI calls. Integration tests create/drop isolated synthetic test databases only and compare domain records before/after AI reads. No real data reset, private report export, persistent conversation, new telemetry store or automatic live test is implemented. Live requests still transmit the user's question plus selected aggregate evidence to OpenAI with `store: false`; they do not run wholly on the local machine, and cancellation does not guarantee zero provider charges.

## Private historical Uber statements

Original PDFs remain in private local storage. Reviewed aggregate-only JSON is ignored under `private-exports/uber-annual/`; public fixtures/docs use synthetic financial values. The strict annual schema rejects legal/home identifiers, masked/unmasked TINs, account numbers, PDF contents/paths and arbitrary source text. MongoDB retains only source availability, operational/financial annual and monthly observations and an internal import time. Read DTOs exclude IDs/import timestamps and fail safely if stored records contain unsupported fields.

Import does not invoke ArcGIS or OpenAI and writes only `uberAnnualSummaries`. History loading likewise makes no AI calls. On explicit Ask DGI submission, selected aggregate annual facts may be sent to OpenAI through the same strict projection/evidence boundary; original PDFs/JSON/identifiers never become provider payloads. Human-readable CLI discrepancy amounts are private financial output: do not commit captured logs/screenshots. Annual statements never create historical GIS or individual delivery records. Existing residential-address/geocode/generalization boundaries remain unchanged.
