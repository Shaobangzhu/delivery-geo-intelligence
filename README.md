# Delivery Geo Intelligence

Delivery Geo Intelligence is a local-first Web GIS proof of concept for personally observed last-mile delivery activity around Eastvale, California. It has three primary pages: **Dashboard**, **History**, and **Merchants**. The Dashboard renders filtered ArcGIS maps and analytics; History manages delivery records; Merchants manages public physical pickup locations.

## Requirements

- Node.js 22.12 or newer and npm
- Docker Desktop with Docker Compose

## Local setup

1. Run `npm install` at the repository root.
2. Copy `.env.example` to `.env` and replace the MongoDB password with a local value. Keep this file private.
3. Copy `backend/.env.example` to `backend/.env`. Set `MONGODB_URI` with the same username and password as the root `.env`. URL-encode special characters in the URI password. Set the private `ARCGIS_GEOCODING_API_KEY` for stored business and destination geocoding. Destination coordinate precision defaults to two decimal places.
4. Copy `frontend/.env.example` to `frontend/.env` and set `VITE_ARCGIS_API_KEY` for the browser map. The private geocoding key belongs only in `backend/.env`.
5. Start MongoDB with `npm run db:up`.
6. In separate terminals, run `npm run dev:backend` and `npm run dev:frontend`.

Open <http://127.0.0.1:5173>. The routes are `/dashboard`, `/history`, and `/merchants`; `/` redirects to `/dashboard`. Add verified public business pickup locations on Merchants, then select them in History when recording deliveries. A Merchant is one physical store, so same-brand stores need separate records. Merchant business addresses and exact geocoded points are stored; residential destination addresses are discarded after geocoding and only generalized points are stored. The API health endpoint is <http://127.0.0.1:3000/api/health>.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run db:up` | Start MongoDB and wait for its healthcheck |
| `npm run db:down` | Stop MongoDB while retaining its named volume |
| `npm run db:status` | Show the DGI Compose service status |
| `npm run db:logs` | Follow MongoDB logs |
| `npm run dev:frontend` | Start Vite on port 5173 |
| `npm run dev:backend` | Start Express on port 3000 |
| `npm run typecheck` | Typecheck both workspaces |
| `npm run build` | Build both workspaces |
| `npm test` | Run backend API integration tests against an isolated temporary database, then frontend interaction tests |

The MongoDB container publishes port 27017 on `127.0.0.1` only. It uses its own `dgi_mongodb_data` named volume. Frontend and backend run on the host. No database content or environment credentials belong in Git.

See [architecture](docs/architecture.md) for the current topology, [data model](docs/data-model.md) for the collections and API contract, [dashboard](docs/dashboard.md) for analytics semantics, and [geocoding](docs/geocoding.md) and [privacy model](docs/privacy-model.md) for the distinct merchant and destination handling. No seed data is included in the repository.
