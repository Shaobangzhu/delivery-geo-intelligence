# Server-side stored geocoding

The backend uses the ArcGIS World Geocoding Service `findAddressCandidates` operation for both public Merchant business addresses and transient residential destination addresses. It sends a POST request to the fixed service URL, with the address in the form body and `ARCGIS_GEOCODING_API_KEY` in the `X-Esri-Authorization` header. The key never enters a Vite variable or frontend bundle.

The request sets `f=json`, `forStorage=true`, `outSr=4326`, `outFields=Addr_type`, `maxLocations=1`, and `matchOutOfRange=false`. The backend does not put the address or key in the request URL. A lower-level stored geocoder validates and returns an exact WGS84 Point. The two write workflows then handle that Point differently.

## Acceptance of a candidate

The service accepts only the top candidate when it:

- has a score of at least 90;
- is a `PointAddress`, `Subaddress`, or `StreetAddress` match;
- supplies finite longitude and latitude within WGS84 ranges; and
- reports spatial reference 4326.

An empty candidate list returns `no_match` (422). A low-score or less precise match returns `low_confidence` (422). Invalid coordinates or spatial reference return `unusable_result` (502). HTTP or ArcGIS service errors return `provider_error` (502), and network failures or timeouts return `network_error` (503). Responses contain only these generic codes, never the input address or ArcGIS error details.

## Merchant writes

`POST /api/merchants` accepts `name`, `category`, `publicAddress`, and `city`. The server stored-geocodes the verified public business address and persists both `publicAddress` and the **exact** business `location` Point. The client does not supply coordinates. `PATCH /api/merchants/:id` preserves `location` when only name, category, or city changes. An explicitly changed `publicAddress` is stored-geocoded and replaces the business address and exact point together. A failed geocode leaves the record unchanged. This path does not call destination coordinate generalization.

## Delivery writes

`POST /api/deliveries` accepts an optional `destinationAddress` along with the normal Delivery fields. When supplied, the backend geocodes it, immediately rounds the exact WGS84 coordinate, and writes only the generalized `destinationLocation` GeoJSON Point. The address and exact point are discarded. When omitted, the delivery has no destination location.

`PATCH /api/deliveries/:id` leaves the existing destination unchanged unless a new `destinationAddress` is explicitly supplied. A replacement follows the same geocode-and-generalize path. There is no reverse geocoding of an existing generalized destination. A failed geocode does not create or update a delivery.

Unit tests mock HTTP responses from ArcGIS and verify exact business points versus generalized destinations. Integration tests inject synthetic geocoders and use an isolated MongoDB database. Tests do not make billable ArcGIS requests or include real residential addresses.

ArcGIS operation reference: [findAddressCandidates](https://developers.arcgis.com/rest/geocode/find-address-candidates/). Header guidance: [HTTP authorization headers](https://developers.arcgis.com/documentation/security-and-authentication/reference/http-authorization-headers/).
