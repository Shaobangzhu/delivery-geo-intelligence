# Architecture

## Phase 1 topology

```text
Browser
  → React + Vite (127.0.0.1:5173)
  → Express (127.0.0.1:3000)
  → MongoDB in DGI Docker Compose (127.0.0.1:27017)
```

The frontend and backend run directly on the host. Docker Compose runs only MongoDB, with DGI-specific credentials, container, and persistent named volume. Phase 1 exposes a backend health route but does not yet connect application routes to MongoDB.

The Compose image uses MongoDB 7.0 because MongoDB 8.0 failed to start under this Docker Desktop environment's Linux kernel. The DGI volume is separate from other projects.

## Planned later data flow

```text
History form
  → transient destination address
  → Express
  → ArcGIS stored geocoding
  → deterministic coordinate generalization
  → discard address and exact coordinate
  → persist generalized GeoJSON Point in MongoDB
  → analytics
  → ArcGIS Dashboard
```

This flow is a plan, not an implemented Phase 1 feature. Residential addresses and exact geocoded residential coordinates must not be stored or logged. The frontend ArcGIS key will be browser-consumed; the backend geocoding key must remain server-only. Observed records and derived analysis must be described as a personal observational dataset, not representative of overall delivery demand.
