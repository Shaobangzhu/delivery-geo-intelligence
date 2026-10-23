# Data & Settings

The fourth primary route, `/settings`, presents actual system observations alongside Dashboard, History and Merchants. It uses existing DGI colors, typography and plain CSS, with no UI framework or automatic polling. It is a read-only operations view, not an environment/credential editor.

## Sources and refresh

The page independently requests `/api/system/status` and `/api/system/metrics?window=1h` (or `24h`). Refresh fetches both again with browser cache disabled. Status always reflects 24h backend evidence; the selectable window applies to request metrics and usage. The status endpoint may perform a MongoDB ping, cached by the backend for five seconds; it never probes paid ArcGIS/OpenAI services. Visiting this page does not initialize a map or contact a paid provider.

Request effects abort on window change/unmount, discard late completions, and impose an eight-second network timeout. Responses are validated and projected into frontend types: exact schema version/window, one of each provider, enum states/errors, timestamps, nonnegative finite numbers, integer counters and required operation/error maps. Unknown fields are discarded. Malformed snapshots are unavailable rather than fabricated healthy data; response bodies and raw exceptions are never rendered. Partial endpoint success remains useful. Retained status is explicitly marked stale during refresh or after status failure; failed metric requests clear the current metrics rather than presenting a previous window as fresh.

Backend contract v1 has two additive, optional-for-old-clients fields: `model` (safe configured OpenAI model identifier or null), and `healthCheck` (MongoDB-only most recent retained ping timestamp/duration/outcome or null). Old responses without these fields display unavailable metadata. Ping duration is never substituted with general command latency. Database connection strings, server addresses and database names are not exposed.

## Meaning and limits

- System cards and three backend provider entries use backend observations. Configuration alone does not establish operational status. Zero sample counts mean no retained observations, not proof of zero actual traffic. Unknown duration, timestamps and tokens display unavailable/not observed.
- MongoDB counts represent commands, including separately marked status pings; ArcGIS counts represent geocoding lookups; OpenAI request counts represent end-to-end analyst attempts. The request total sums these observation categories and is not an HTTP throughput or billing metric. Model invocations appear separately. Success rate is successful operation outcomes / retained operation samples; expected no-match/low-confidence geocodes are not infrastructure failures, but do not count as successful geocodes.
- p50/p95 come from the backend and display duration sample counts. Latest success/error are window-bound observations, not live availability guarantees. History resets on backend restart, begins at process start, and can be truncated at collector capacity; capacity loss is called out.
- AI usage uses only reported input/output token counts. Missing usage stays unknown; mixed usage is explicitly marked partial using reported exchange counts versus invocations. Timeout may include cancellation. No cost or missing-token estimates are made.
- ArcGIS Maps SDK is **browser-session observation**, stored only in a tiny `useSyncExternalStore` module. The existing map controller publishes successful initialization after view/layer readiness; generic initialization, layer initialization and layer update failure categories are recorded at existing error boundaries. Missing map configuration is a separate state. Navigation retains the last event/time; reload clears it. Without an observation the page says **Not Yet Verified**. This store contains no error object/message, keys, addresses, geometry or network payloads and sends nothing to the backend. Map behavior and data flow remain otherwise unchanged. These events cannot establish health of every browser request or remote tile service.

Responsive cards collapse from four columns to two/one; details collapse to one column. Wide metrics stay within a named, keyboard-focusable horizontal scroll region. Statuses include text, form controls have labels, tables have captions and scoped headers, and errors use alerts. jsdom tests cover structure and interactions, not pixel layout, WebGL or actual mobile browser rendering.

## Verification

`npm run quality:check` verifies lint, strict types, credential-free builds, coverage tests and synthetic AI evaluation. Settings tests cover routing, actual fixture rendering, empty/unavailable/partial data, refresh/window changes, cancellation, malformed/sensitive fields, sanitized errors, capacity warnings and browser-session persistence. Existing map tests verify lifecycle observation alongside persistent-view behavior. No real credentials, personal database or live paid service is needed.

Verified on Node 22.12.0/npm 10.9.0: the complete quality gate passed with 110 backend tests, 129 frontend tests and 39/39 synthetic AI evaluation scenarios. After adding one additional stale-refresh regression, lint, frontend typecheck and all 130 frontend tests passed. The existing ArcGIS chunk-size build warning remains. No manual browser/mobile visual assessment was performed.
