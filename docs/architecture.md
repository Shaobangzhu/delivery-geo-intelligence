# Architecture

## Current topology

```text
Browser
  → React + Vite (127.0.0.1:5173)
  → Express (127.0.0.1:3000)
  → MongoDB in DGI Docker Compose (127.0.0.1:27017)
```

The frontend and backend run directly on the host. Docker Compose runs only MongoDB, with DGI-specific credentials, container, and persistent named volume. The backend connects to MongoDB on startup, creates spatial and History query indexes, and exposes Merchant, Delivery, and Dashboard APIs. React has three primary routes: Dashboard, History, and Merchants.

The Compose image uses MongoDB 7.0 because MongoDB 8.0 failed to start under this Docker Desktop environment's Linux kernel. The DGI volume is separate from other projects.

## Public Merchant flow

```text
Merchants form → verified public business address → Express
  → ArcGIS stored geocode (forStorage=true) → exact business GeoJSON Point
  → persist publicAddress + exact location on one physical Merchant record
  → History merchant selector and Dashboard pickup analytics by merchantId
```

Two locations of one brand have separate Merchant IDs. Editing an address corrects the pickup point for every delivery referencing that ID; a genuinely moved store should be a new Merchant. A referenced Merchant cannot be deleted (HTTP 409); delivery records are never cascade deleted. Earlier Merchant records without a saved public address retain their existing point until corrected.

## Residential destination data flow

```text
History form
  → transient destination address
  → Express
  → ArcGIS stored geocoding
  → deterministic coordinate generalization
  → discard address and exact coordinate
  → persist generalized GeoJSON Point in MongoDB
  → filtered analytics
  → ArcGIS destination heatmap only
```

Residential addresses and exact geocoded residential coordinates are not stored or logged by the application. The Delivery API accepts a transient address and rejects direct destination coordinates. The frontend ArcGIS key is browser-consumed; the backend geocoding key remains server-only. Observed records and derived analysis are a personal observational dataset, not representative of overall delivery demand.
