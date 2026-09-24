# Residential destination privacy model

The address is transient form input. The backend passes it to ArcGIS stored geocoding, obtains an exact coordinate in memory, reduces coordinate precision, and persists only the resulting GeoJSON Point. Neither `destinationAddress` nor the exact geocoder coordinate is a MongoDB field. Delivery API responses expose only `hasDestinationLocation`, not an address or coordinates. The application does not log request bodies, ArcGIS payloads, or provider error text.

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
- The address is sent to ArcGIS over HTTPS in a POST body. ArcGIS necessarily receives it to geocode; it is not stored by this application's database or application logs.
- Exact coordinates and address strings exist briefly in process memory during the request; JavaScript does not provide a reliable memory-wipe guarantee.
- API writes reject direct `destinationLocation` input. The only application write path for a destination is geocode and generalize.
- Error responses do not include the address, provider response, or key.
- The dedicated destination heatmap API returns only grouped, persisted generalized coordinates and counts needed for heatmap rendering. It does not return addresses, exact geocoder results, delivery IDs, or per-delivery details. These generalized coordinates are transport data for ArcGIS, never a coordinate readout or list in the interface.
- Destination mode uses a heatmap-only layer with popups and individual point rendering disabled. Switching into this mode closes an open merchant popup and hides the public merchant layer. Time and category changes replace destination cells rather than keeping a previous filter's locations visible.
- Free-text notes must not be used for customer addresses or other private location details; this boundary concerns the dedicated destination field and cannot classify every possible free-text note.

No real address, exact residential coordinate, or fabricated delivery history is included in code, tests, or documentation.
