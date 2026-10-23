# Reliability and telemetry privacy tests

## Failure classification

The system API uses allowlisted categories; Settings validates the same categories. Public geocoding and AnalystError codes stay compatible. A safe telemetry category can be more specific than a public error code. No error message/payload is serialized to telemetry.

| Failure | Category | Availability evidence |
| --- | --- | --- |
| Invalid application input / grounded-answer safety rejection | `request_rejected` | No outage evidence; no-call rejection cannot establish reachability. A response followed by a domain/safety rejection may establish reachability. |
| No matching geocode | `no_match` | Successful provider response, not successful geocode; no outage penalty. |
| Low-confidence geocode | `low_confidence` | Same distinction as no-match. |
| Provider HTTP 401/403; ArcGIS token code 498/499 | `authentication` | Failed usable-provider evidence. |
| HTTP/provider code 429 | `rate_limit` | Failed evidence. |
| Fetch / OpenAI SDK connection failure | `network` | Failed evidence. |
| Deadline or recognized SDK/driver timeout | `timeout` | Failed evidence. Existing AI cancellation diagnostics can share this category. |
| Provider HTTP 500–599 | `provider_5xx` | Failed evidence, distinct from network and generic provider errors. |
| Invalid JSON/schema, missing completion structure, invalid final envelope | `invalid_response` | Failed evidence even if transport returned HTTP 200. Grounding/scope safety rejection after a structurally valid response is separate. |
| MongoNetworkError, MongoServerSelectionError, MongoTopologyClosedError, MongoNotConnectedError | `connectivity` | Failed evidence; driver exception name only is inspected. |
| Missing credential/configuration | `configuration` / explicit `not_configured` | No paid request is made; configuration alone is not reachability. ArcGIS construction fails before an attempted operation and adds no request sample. |
| Internal application exception | `internal` | No outage evidence; do not blame provider connectivity. |
| Other provider errors / unclassified Mongo command failures | `provider` | Failed evidence, without inferring raw payload semantics. |

Only retained infrastructure evidence drives status: no evidence → not_yet_verified; success only → operational; failure only → unavailable; mixed → degraded. Explicit unconfigured overrides evidence. Expected business outcomes remain separate counters. Provider availability is a windowed observation, not uptime proof. Error-category histograms and operation-success rates use different semantics.

HTTP classification is centralized in `backend/src/observability/failures.ts`; frontend enum validation includes the additive `provider_5xx` and `connectivity` categories. Mongo monitoring reads only command category/duration and the recognized error-name discriminator, never the raw command/reply, message, stack or personal-record payload. Missing/invalid numeric samples are discarded rather than coerced into success.

## Fault-injection matrix

`backend/test/reliability.test.mjs` complements the existing observability, geocoding and AI regression suites:

| Area | Deterministic probes / assertions |
| --- | --- |
| ArcGIS | Success, no_match, low_confidence, HTTP 401, 429, 500, network error, injected aborted timeout signal, malformed JSON, blank credential. Exact call/sample counts, latency and sanitized category/state verified; successful destination remains rounded to two decimals. |
| OpenAI | Scripted successful tool/evidence/final-answer loop, absent configuration, 403, 429, 503, SDK connection failure, deadline, null completion, missing usage, reported usage, two SDK calls per one analyst request. Output is actually accepted by the analyst for success cases. Sink failure does not change that answer. |
| MongoDB | Failed/successful ping, transient MongoNetworkError then recovery, single-flight/cache tests, fake-timer bounded deadline, named driver timeout, command monitoring and detach. Existing real-driver regression uses a newly provisioned disposable MongoDB process. |
| Arithmetic | Known samples 1 through 20 give mean 10.5, p50 10, p95 19 (nearest rank); sample count 20. Exact lower window boundary excluded for both 1h and 24h. Empty/restarted collector retains null latency/usage. Existing tests cover capacity loss and no double-counted ping events. |
| Privacy | Synthetic API key, Authorization field, synthetic residential address, exact synthetic destination coordinates, prompt, completion, raw Mongo command and raw exception payload. Inspect both collector serialization and JSON from status/1h metrics/24h metrics. Snapshot reads create no provider samples; status adds one marked ping. |
| Settings | HTTP 503 without parsing/displaying its body, malformed schema, forged operational state without successful evidence, inconsistent counts, real unavailable vs no observations, partial endpoint success, stale refresh, cancellation, and unknown success rate. A zero denominator never becomes 100%. |

Existing geocoding tests also verify credential header placement, stored/public versus generalized/private coordinates, and safe public errors. Existing AI tests retain bounded tool calls, scope/privacy guards and real cancellation plumbing with fake SDKs. No failure case is suppressed to make the suite pass.

## Isolation and test reliability

Run `npm run quality:check` from the repository root; it executes lint, strict typecheck, credential-free builds, backend/frontend coverage tests and deterministic AI evaluation. Focused commands are `npm test -w backend` and `npm test -w frontend` (the backend script includes its disposable runner).

Providers are dependency-injected functions/SDK objects returning synthetic responses; loopback HTTP is used only for local API contracts. The backend runner refuses ambient/personal MongoDB URIs, provisions temporary storage and binds an ephemeral loopback port. No real .env, provider credential, address or personal record is required. First use may download the pinned MongoDB binary; tests do not contact paid providers. Snapshot/API reads do not call ArcGIS/OpenAI.

New deadline tests use scoped native mock timers, not sleeps; ArcGIS can take an injected timeout signal without mutating global AbortSignal. Fake clocks drive durations/window boundaries. Mocks restore after each test. Settings clears its browser-session observation store before and after each test, so order does not leak a prior lifecycle event. Fake driver listeners detach; local servers close in finally blocks. No production telemetry persistence exists: privacy tests inspect the complete retained in-memory representation, not an imaginary persistent store.

Observation-sink exceptions alone are isolated at adapter boundaries. Database/provider errors still produce controlled failure observations and public errors. Health probe recording is outside its database try/catch, preventing an observation-sink failure from being mistaken for a database failure or triggering a second record attempt. Analyst request preparation occurs before counting SDK invocations; an internal preparation failure cannot fabricate a model call.

## Known limitations

Metrics reset on restart, reflect one process, and can be incomplete after bounded-capacity eviction or process termination. Durations/quantiles include successful, failed and expected operations; tiny sample sets are not SLO estimates. Mongo command metrics cannot cover failures before command dispatch; explicit health probes complement those observations. Generic unknown Mongo errors are not deeply parsed for speculative categorization. Reported token sums may cover fewer exchanges than model-call counts, and unknown usage stays null; no cost estimation is performed.

Tests establish deterministic contracts and isolation, not real-provider availability, model quality, browser/WebGL behavior, distributed MongoDB failover or security against arbitrary third-party content. The existing ArcGIS/AI business contracts remain authoritative; safe categories are aggregate diagnostics. Synthetic sentinel tests exercise known forbidden data paths but cannot prove arbitrary free-text content harmless. No new telemetry export/persistence or business feature is introduced.

## Executed results (2026-10-23)

On Node 22.12.0/npm 10.9.0, final `npm run quality:check` passed lint, strict typechecks, credential-free builds, **133/133 backend tests**, **134/134 frontend tests**, and **39/39 synthetic AI evaluation scenarios**, with zero real provider calls. Backend tests had zero failures, cancellations and skips. The existing ArcGIS large-chunk warning remains.

The first complete gate run with the internal-failure regression failed one assertion: request preparation was classified as `provider` instead of `internal`. Moving request construction outside the SDK exception boundary fixed both classification and attempted-call counting; the final full gate passed without suppressing that test. Review also corrected malformed-response reachability, explicit 5xx/authentication/connectivity classification, and health-sink double-record/rethrow behavior. `git diff --check` passed. Historical coverage baseline files were not lowered or rewritten.
