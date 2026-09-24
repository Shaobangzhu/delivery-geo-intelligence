# Delivery Geo Intelligence

Delivery Geo Intelligence is a local-first Web GIS proof of concept for personally observed last-mile delivery activity around Eastvale, California. Phase 1 provides the application shell, API health endpoint, and a dedicated local MongoDB service. Maps, delivery records, and analytics are planned for later phases.

## Requirements

- Node.js 22.12 or newer and npm
- Docker Desktop with Docker Compose

## Local setup

1. Run `npm install` at the repository root.
2. Copy `.env.example` to `.env` and replace the MongoDB password with a local value. Keep this file private.
3. Copy `backend/.env.example` to `backend/.env`. Set `MONGODB_URI` with the same username and password as the root `.env`. URL-encode special characters in the URI password. `ARCGIS_GEOCODING_API_KEY` may stay empty for Phase 1.
4. Optionally copy `frontend/.env.example` to `frontend/.env`. The ArcGIS key is unused in Phase 1; the browser mapping key belongs in `VITE_ARCGIS_API_KEY` when mapping is implemented.
5. Start MongoDB with `npm run db:up`.
6. In separate terminals, run `npm run dev:backend` and `npm run dev:frontend`.

Open <http://127.0.0.1:5173>. The routes are `/dashboard` and `/history`; `/` redirects to `/dashboard`. The API health endpoint is <http://127.0.0.1:3000/api/health>.

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

The MongoDB container publishes port 27017 on `127.0.0.1` only. It uses its own `dgi_mongodb_data` named volume. Frontend and backend run on the host. No database content or environment credentials belong in Git.

See [architecture](docs/architecture.md) for the current topology and planned data flow.
