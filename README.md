# Delivery Geo Intelligence

Delivery Geo Intelligence is a local Web GIS proof of concept for exploring **personally observed** last-mile delivery activity around Eastvale, California. It helps the observer maintain records and examine where pickups and privacy-reduced destinations concentrate. These records are a convenience sample: maps and rankings do not describe overall demand, residents' preferences, or the whole delivery market. The image in docs/ui.ux.design.png is a design mockup, not a source of live statistics.

## Implemented application

React, TypeScript, Vite, and React Router provide three primary pages:

- **Dashboard** (/dashboard): period/category filters, summary cards, charts, merchant rankings, and an ArcGIS map.
- **History** (/history): paginated Delivery CRUD, search/filter/sort, and a centered Add Delivery modal. The address field is cleared after save.
- **Merchants** (/merchants): management of verified public physical pickup locations. Two stores of the same brand are separate Merchant records.

Express and Zod validate requests. The native MongoDB Node.js driver stores Merchants and Deliveries in the DGI MongoDB container. React calls Express; Express calls MongoDB and, for address geocoding, ArcGIS. Frontend and backend run on the host; Docker Compose runs MongoDB only. / redirects to /dashboard; GET /api/health checks the API.

Dashboard filters use one backend definition for week/month/year in the Los Angeles calendar and restaurant/grocery/retail/other categories. The same resolved filter feeds cards, charts, rankings, merchant map data, and the destination heatmap request. Earnings sum **known payouts only**: a missing payout is unknown, whereas a recorded $0 is known. Averages include a known-payout sample count. No mockup counts or rankings are hardcoded as data.

The ArcGIS map has three modes:

| Mode | Display | Meaning |
| --- | --- | --- |
| Pickup Volume | Heatmap or public Merchant points | Intensity weighted by observed delivery count |
| Merchant Diversity | Heatmap or public Merchant points | One unit per distinct observed Merchant; nearby variety is an approximation without spatial bins |
| Destination Heatmap | Heatmap only | Generalized observed destination activity; no individual markers or popups |

One MapView survives filter and mode changes. Client-side FeatureLayer data and renderers update without recreating the view. Merchant popups show only public pickup and aggregate delivery information. [Dashboard analytics](docs/dashboard.md) explains filters and renderers.

## Geospatial data and privacy

A Merchant represents **one public physical pickup location**. Its verified public business address and exact stored-geocoded GeoJSON Point may be saved and displayed. A Delivery references a Merchant ID and may have payout, distance, notes, and a generalized destination Point. History displays only a safe destination state such as “Location Ready.”

Residential destination processing:

1. A transient address goes to Express and ArcGIS stored geocoding with forStorage=true.
2. The exact coordinate exists during request processing, then deterministic rounding reduces its precision.
3. The address and exact coordinate are discarded; only a generalized GeoJSON Point goes to MongoDB and aggregate destination heatmaps.

The default destination precision is two decimal places of longitude/latitude, configurable with DESTINATION_COORDINATE_DECIMALS (0–2). This is approximate spatial reduction, **not guaranteed anonymity**. Neither the dedicated address nor the exact residential geocoder Point is a database field, API response, application log, or map popup. The heatmap API transports only grouped generalized cells and counts required for rendering; the UI does not list their coordinates. Free-text notes should not contain customer addresses. [Privacy model](docs/privacy-model.md) describes limitations.

The browser reads VITE_ARCGIS_API_KEY from frontend/.env for ArcGIS map services. The server reads the separate ARCGIS_GEOCODING_API_KEY from backend/.env for stored geocoding; it must never be prefixed VITE_ or sent to React. ArcGIS application privilege configuration must be checked in ArcGIS itself. Real .env files, database data, exports, and backups stay out of Git.

## Local setup

Requires Node.js 22.12 or newer, npm, Docker Desktop, and Docker Compose.

1. Run npm install at the repository root.
2. Copy .env.example to .env and set local DGI MongoDB credentials. Keep this file private.
3. Copy backend/.env.example to backend/.env. Set MONGODB_URI for database delivery_geo_intelligence using the root Docker credentials; URL-encode special password characters. Set ARCGIS_GEOCODING_API_KEY. Set PORT if the default needs changing. Set DESTINATION_COORDINATE_DECIMALS only if a different precision is intended.
4. Copy frontend/.env.example to frontend/.env and set the distinct public-application VITE_ARCGIS_API_KEY.
5. Run npm run db:up and wait for docker compose ps to report dgi-mongodb healthy.
6. In separate terminals run npm run dev:backend and npm run dev:frontend, then open http://127.0.0.1:5173.

Add verified public business locations in Merchants, then select them when recording Deliveries in History. No production seed dataset is committed. The backend connects to MongoDB and creates spatial and History query indexes at startup.

| Command | Purpose |
| --- | --- |
| npm run db:up | Start DGI MongoDB and wait for its healthcheck |
| npm run db:down | Stop it while retaining the named volume |
| npm run db:status / npm run db:logs | Inspect service state / logs |
| npm run dev:frontend / npm run dev:backend | Start Vite / Express |
| npm run typecheck / npm run build | Verify types / build both workspaces |
| npm test | Run backend integration and frontend interaction tests |

Compose uses official mongo:7.0, the dgi-mongodb container, a dedicated persistent dgi_mongodb_data volume, and a healthcheck. Port 27017 is published on 127.0.0.1 only. This stack is independent of other projects' databases.

## Scope and remaining work

- **PHASE 1.5:** A true grid or hex COUNT(DISTINCT merchantId) analysis remains optional; the current diversity heatmap weights each observed physical Merchant once.
- **PHASE 2:** No second deployment phase is implemented or committed. The present system is a local, single-process PoC; scaling or multi-user use requires its own design and privacy review.
- **FUTURE:** Minimum aggregation thresholds and a deployment security model would require design before broader use.
- **DEFERRED:** CSV export, temporal Merchant location history, and application-managed backup/restore are not implemented.

See [architecture](docs/architecture.md), [data model](docs/data-model.md), [geocoding](docs/geocoding.md), [analytics model](docs/analytics-model.md), and [privacy model](docs/privacy-model.md) for implementation details.
