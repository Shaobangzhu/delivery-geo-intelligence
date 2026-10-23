# Provider observability (contract v1)

This milestone adds backend-only, in-process observations for `mongodb`, `arcgis_geocoding`, and `openai`. No frontend page, paid health probe, persistent telemetry collection, or external monitoring service is introduced.

## Architecture and retention

`backend/src/observability/collector.ts` projects inputs through an explicit Zod allowlist and retains at most 10,000 completed operation samples across all three providers. Invalid observations are dropped. Each sample contains only provider/operation enums, process-clock completion timestamp, outcome, infrastructure evidence, duration, sanitized error category, and numeric AI counts/usage. No request ID, model name, tool name, prompt, response, payload, address, coordinate, URL, namespace, credential, or raw exception is copied into the collector. Additional object fields are discarded before storage; objects from diagnostics and driver events are not retained.

Rows expire after 24 hours. Reads filter the exact interval `(now - window, now]`, with `window=1h` or `24h`. Writes also prune expired rows. Capacity eviction drops the oldest row; `incomplete=true` indicates that an evicted row would belong to the requested window. Each response exposes `startedAt`: windows extending before startup are also necessarily partial. Restart discards everything. State and counts are per process, not cluster-wide. Timestamp ordering assumes a normally advancing process wall clock; durations are clamped nonnegative. There is no durable history, billing ledger, statistical confidence guarantee, or sensitive-data redaction after ingestion: unsafe fields are never ingested.

Production wiring lives in `index.ts`. The existing MongoDB startup requirement, index initialization, loopback binding, shutdown handling, and `/api/health` response remain intact. Existing environment validation still requires MongoDB and the backend ArcGIS credential; missing OpenAI configuration is allowed. Library/test callers can explicitly represent any provider as unconfigured or configuration-unknown. The observability clock and health probe are injectable for deterministic testing.

## Instrumentation and definitions

- **MongoDB:** Enable native driver's `monitorCommands` on the existing client. Listen only to completion events; read `commandName` and `duration`, never the command, reply, failure object, collection, or namespace. Map names to `database_read`, `database_write`, or `database_other`. Count completed commands, including failed commands; these are not HTTP requests or logical business transactions. A logical operation may issue several commands/getMore calls. Pool/server-selection failures before command dispatch may have no completion event. Ping/handshake/endSessions events are excluded. No extra query accompanies normal operations.
- **MongoDB status probe:** Reuse `db.command({ping: 1}, {timeoutMS: 1500})`. A 1.5-second application deadline also bounds even a stuck fake adapter. Concurrent requests share one probe and completion is cached for five seconds, including failures. Exactly one `health_ping` sample is recorded per probe; it is distinct from business command metrics. Health pings are included in MongoDB total counts/latency and exposed separately in `operations.health_ping`; they must not be interpreted as business throughput. Legacy `/api/health` pings are excluded from command metrics. A late result after deadline cannot create a second sample. An uncooperative fake adapter may remain pending internally; production uses the driver's own timeout as well.
- **ArcGIS:** One sample per completed server geocoding lookup, covering request and response parsing time. Merchant and destination lookups share the instrumentation. Residential coordinates are still generalized by the existing destination wrapper and never enter telemetry. `no_match` and `low_confidence` are expected outcomes: separate counters, not infrastructure failures. They are evidence that the provider responded. HTTP 429 and JSON provider error code 429 map to `rate_limit`. Abort expiry maps to `timeout`; other fetch failures map to `network`. Public geocoding error codes/status behavior remains compatible. Observer exceptions are swallowed without changing results or thrown business errors.
- **OpenAI:** Reuse `createAnalyst`'s existing completion diagnostics callback. Each callback records one `analyst_request` with end-to-end latency. `requestCount`/`ai.analystRequests` count analyst attempts, while `ai.providerCalls` sums actual SDK invocations and `ai.providerErrors` sums failed invocations. Never add calls to analyst request counts. Input validation/configuration failures may have zero provider calls. SDK timeouts add a safe diagnostic category while preserving the existing public AnalystError code. Usage sums only reported token counts; missing usage is `null`, not estimated. `ai.usageSamples` counts reported exchanges, which can be less than provider calls; mixed available/missing totals are therefore partial, not total billing usage. An explicitly reported zero remains zero. Provider-call latency is not separately measured; displayed OpenAI latency is end-to-end analyst latency. Requests that fail before emitting diagnostics or during process termination are not observed.

The collector is best effort and never throws into business recording paths. Geocoding and MongoDB adapters additionally isolate observer failures; the existing analyst callback guard remains in place. Reads of `/api/system/metrics` perform no database or paid provider requests and create no samples. `/api/system/status` probes MongoDB only.

## Status state machine

States derive from retained evidence within the response window (status uses 24h):

| Condition | State |
| --- | --- |
| Explicitly unconfigured | `not_configured` |
| No infrastructure success/failure observation in window | `not_yet_verified` |
| Only successful infrastructure evidence | `operational` |
| Failure evidence and no success evidence | `unavailable` |
| Both success and failure evidence | `degraded` |

A successful operation after a recent outage stays `degraded` until failure evidence ages out. Configuration alone never proves connectivity. OpenAI request rejection/validation with no provider call supplies no connectivity evidence. A provider response followed by analyst validation failure can prove reachability without successful analyst output. ArcGIS expected no-match/low-confidence responses prove reachability but do not increment successful geocoding result counts. Operational is historical evidence, not a current uptime promise; always display timestamps/window/sample counts. Capacity loss can hide older evidence, so clients must display the incomplete indicator.

`lastSuccessAt` means last successful **infrastructure evidence**, including expected ArcGIS responses. `successCount` counts successful **operation outcomes**. `lastErrorCategory` is the latest categorized outcome in the selected window and may be an expected result; it does not alone determine status. Unknown configuration is `configured: null`; the actual startup wiring supplies booleans.

## Read-only JSON APIs

Both endpoints return HTTP 200 when a valid snapshot is available, even when a provider is unavailable. Clients must inspect provider states rather than interpret HTTP 200 as healthy. Responses use `Cache-Control: no-store`.

- `GET /api/system/status`: no query parameters; bounded/cached MongoDB probe then a 24h snapshot.
- `GET /api/system/metrics?window=1h` or `?window=24h`: explicit window required; no active probes.
- Unsupported, missing, repeated, structured, or extra query parameters yield HTTP 400 with `{"schemaVersion":1,"error":"invalid_query"}`. Input is never echoed.

Common snapshot shape:

```typescript
{
  schemaVersion: 1,
  window: "1h" | "24h",
  generatedAt: string, // ISO timestamp of read, not provider evidence
  startedAt: string,
  capacity: number,
  incomplete: boolean,
  providers: [{
    provider: "mongodb" | "arcgis_geocoding" | "openai",
    configured: boolean | null,
    status: "not_configured" | "not_yet_verified" | "operational" | "degraded" | "unavailable",
    lastSuccessAt: string | null,
    lastErrorCategory: ErrorCategory | null,
    lastUpdatedAt: string | null, // latest sample completion in this window
    sampleCount: number,
    requestCount: number,
    successCount: number,
    failureCount: number,
    noMatchCount: number,
    lowConfidenceCount: number,
    errorCounts: Record<ErrorCategory, number>,
    operations: Record<OperationCategory, number>,
    latency: { sampleCount: number, meanMs: number | null, p50Ms: number | null, p95Ms: number | null },
    ai: null | {
      analystRequests: number, providerCalls: number, providerErrors: number,
      usageSamples: number, inputTokens: number | null, outputTokens: number | null
    }
  }]
}
```

All three providers always appear. Zero counts mean zero **retained observations**, not proven zero real-world usage. Empty latency samples/timestamps/token observations use null. Mean and nearest-rank p50/p95 are calculated over completed durations (including expected and failed outcomes); quantiles expose their sample count and are not meaningful service-level objectives at tiny sample sizes. Operation categories are `database_read`, `database_write`, `database_other`, `health_ping`, `geocode`, `analyst_request`.

Error categories are `network`, `timeout`, `rate_limit`, `authentication`, `configuration`, `provider`, `invalid_response`, `no_match`, `low_confidence`, `request_rejected`, `internal`. Mongo command errors intentionally use generic `provider` rather than inspecting database exception payloads. OpenAI existing `timeout_or_cancelled` diagnostics cannot distinguish user cancellation from deadline expiry; both map to timeout, which may conservatively degrade status. No raw message/code string can become a response category.

## Browser boundary and deployment limitations

Backend geocoding observations do not measure ArcGIS Maps SDK, browser authentication, WebGL, tile/feature requests, rendering or every browser network request. The next frontend milestone should maintain separate browser-side observations from map initialization/load/error events with local timestamps, sample counts and safe categories. It must not upload addresses, geometry, keys, URLs or error text. No browser telemetry ingestion endpoint exists here.

The future Data & Settings page should fetch these APIs with a bounded timeout, validate schemaVersion, and mark the backend unavailable on network failure/invalid responses. It must not fabricate an operational JSON response or show a stale cached snapshot as current health. It should display provider configuration, observed window, last timestamps, missing/partial usage and incomplete history alongside states. No React changes are part of this milestone.

These endpoints follow the application's existing local-instance access model and loopback binding; they add no authentication layer. Even aggregate operational/token counts should be access-controlled before exposing the application beyond its private deployment. Persisting or exporting telemetry requires a separate retention/access review. No production environment file, credential, personal database record or live external API is required for tests.

## Verification

`npm run quality:check` runs lint, strict typechecks, credential-free build, all coverage tests and mock AI evaluation. `backend/test/observability.test.mjs` covers empty/missing configuration, all state transitions, quantiles/counts, exact window boundaries, capacity eviction/restart, malformed data/queries, privacy sentinels, AI partial usage and SDK timeout, ArcGIS success/generalization/no-match/low-confidence/network/rate-limit/timeout, bounded cached single-flight health probes, versioned API responses, and real command monitoring on disposable MongoDB. Providers are synthetic; no live ArcGIS/OpenAI requests are used. Existing quality-baseline.json remains the prior milestone's historical measurement, not a newly lowered threshold.

Verified on 2026-10-23 with Node 22.12.0 / npm 10.9.0: `npm run quality:check` passed lint, strict typechecks, credential-free builds, 109 backend tests (13 new observability tests), 120 frontend tests, and 39/39 synthetic AI scenarios. Backend tests had zero failures, cancellations or skips. The existing ArcGIS build chunk-size warning remains. `git diff --check` passed. No live provider calls or personal MongoDB data were used.

The Data & Settings milestone adds optional `model: string | null` and MongoDB `healthCheck: { timestamp, durationMs, outcome } | null` fields to each provider row in v1. The model is the validated configured identifier only; the health check is the latest retained ping sample, not aggregate command latency. `/settings` now consumes these observations and maintains a separate local browser lifecycle store; see [Data & Settings](data-settings.md).
