# Delivery Geo Intelligence

Delivery Geo Intelligence is a local-first Web GIS proof of concept for personally observed last-mile delivery activity around Eastvale, California. The current application has Delivery History, a filtered Dashboard analytics shell, a MongoDB-backed Merchant and Delivery API, and server-side stored geocoding with destination coordinate generalization. ArcGIS map rendering remains planned for a later phase.

## Requirements

- Node.js 22.12 or newer and npm
- Docker Desktop with Docker Compose

## Local setup

1. Run `npm install` at the repository root.
2. Copy `.env.example` to `.env` and replace the MongoDB password with a local value. Keep this file private.
3. Copy `backend/.env.example` to `backend/.env`. Set `MONGODB_URI` with the same username and password as the root `.env`. URL-encode special characters in the URI password. Set the private `ARCGIS_GEOCODING_API_KEY` to use destination geocoding. The coordinate precision setting defaults to two decimal places.
4. Optionally copy `frontend/.env.example` to `frontend/.env`. The browser mapping key in `VITE_ARCGIS_API_KEY` is reserved for a later map phase; the private geocoding key belongs only in `backend/.env`.
5. Start MongoDB with `npm run db:up`.
6. In separate terminals, run `npm run dev:backend` and `npm run dev:frontend`.

Open <http://127.0.0.1:5173>. The routes are `/dashboard` and `/history`; `/` redirects to `/dashboard`. Dashboard loads filtered analytics from `GET /api/dashboard`. History loads merchants and deliveries from the API. Add Delivery geocodes the entered destination on the server, and the address is not stored. Merchant pickup locations must first be entered through the Merchant API using verified public locations. The API health endpoint is <http://127.0.0.1:3000/api/health>.

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

See [architecture](docs/architecture.md) for the current topology, [data model](docs/data-model.md) for the collections and API contract, [dashboard](docs/dashboard.md) for analytics semantics, and [geocoding](docs/geocoding.md) and [privacy model](docs/privacy-model.md) for destination handling. Merchant locations supplied to the API must be verified public pickup locations. There is no seed data in the repository.
