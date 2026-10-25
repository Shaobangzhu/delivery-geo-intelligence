# Deterministic Chromium E2E

This suite exercises the built React application, React Router, real Express/Zod routes, the MongoDB native driver and a disposable MongoDB 7.0.24 database. It does not use production startup, dotenv, the application Docker Compose stack or a developer database. Playwright and its matching browser revision are pinned by `@playwright/test` 1.64.1 in the root lockfile. Chromium is the only browser project.

## Local execution

Use Node from `.nvmrc` (22.23.4) and npm 10.9.0:

```sh
npm ci
npx playwright install --only-shell chromium
npm run test:e2e
```

Playwright starts both servers automatically: `e2e:backend` compiles the backend and runs the dedicated synthetic harness on `127.0.0.1:4310`; `e2e:frontend` builds a separate offline artifact and previews it on `127.0.0.1:4311`. Both servers must be fresh; occupied ports fail rather than reusing a development server. No environment file or live provider key is required. Keep these ports free. First-time package, browser and MongoDB binary downloads require network access; test execution itself uses only loopback HTTP and the isolated MongoDB connection. The default MongoDB binary requires native OS support, as in existing backend integration tests.

```sh
npm run typecheck:e2e     # Strict checks for Playwright config/TypeScript tests
npm run test:e2e:repeat   # Every smoke test three times, zero retries
npm run test:e2e -- --grep 'History:'  # Independent workflow run
npm run test:e2e:report   # Open local HTML diagnostics
```

For interactive Chromium debugging, first install the full Chromium browser (`npx playwright install chromium`), then run `npm run test:e2e:debug`. Local default is headless with zero retries. Use `npx playwright show-trace <local-trace.zip>` for a failing attempt; do not upload traces to a public service. Run `npm run quality:check` and `npm run security:check` alongside E2E before a PR. E2E is a separate blocking CI stage; adding it does not silently change the existing `npm test` unit/integration contract.

## Synthetic fixtures and database isolation

`e2e/server.mjs` owns the data. Each attempt resets two merchants (`Synthetic Cafe`, `Synthetic Market`), three deliveries, and one $5 Prop 22 receipt. All business/destination strings are explicitly synthetic; coordinates around `[0.01, 0.01]` are synthetic points in the ocean, never copied from a residence. Delivery payouts are $12.50, $7.50 and $10; dates span two weeks. The application clock and browser Date are fixed at `2026-03-08T20:00:00Z`; real timers continue running. Week totals are two deliveries/$25 including the receipt; restaurant-only month totals are two deliveries/$22.50 excluding the receipt. Efficiency uses the actual recorded duration/mileage denominators.

By default, a new MongoMemoryServer owns an ephemeral port and temporary storage. It never consumes `MONGODB_URI`. For CI service mode, only `DGI_TEST_MONGO_MODE=service` and the exact guarded `DGI_CI_MONGO_URI` format from [CI](ci.md) are accepted. This service must be a newly created disposable container with synthetic credentials and no persistent volumes. Never point it at an existing server. `TestMongoClient` maps `e2e_test` into `dgi_ci_test_<24 hex hash>`. An additional exact namespace assertion precedes every destructive drop. Production database names and arbitrary URIs cannot become cleanup targets.

The loopback-only harness exposes `/__e2e/ready`, `POST /__e2e/reset` and `POST /__e2e/provider-failure`. These routes exist only in the test entrypoint, never in production `createApp`. Reset recreates indexes/data and a fresh real observability collector/app; provider-failure records one synthetic rate-limit event through that collector. The fixed data/observer and fresh browser context are restored before every test and retry. One worker serializes access to the fixture database. Do not enable more workers without introducing per-worker servers/databases. Normal shutdown drops only the guarded test database, closes the driver and stops temporary MongoDB. A killed host/process can prevent graceful cleanup; CI container teardown and OS temporary storage remain the final boundary.

## Coverage and external-provider boundary

| Workflow | Critical assertions |
| --- | --- |
| Dashboard | Root redirect, real summary and efficiency values, category/period recalculation, real generalized heatmap response, SDK-adapter feature updates, one view across filters, destroy on navigation, browser-session observation |
| Dashboard failure | Injected SDK readiness rejection produces a visible map error and unavailable browser status; analytics still work |
| History | Existing records, required fields, duration validation, create with injected geocoder, edit payout, persisted state after reload, no transient address in delivery response |
| Merchants | List, required fields, create/geocode, edit, reload, delete unused merchant, block deletion of a merchant with history |
| Settings | Unknown/no observation differs from unavailable, no invented 100% rate, refresh reflects real collector change, no model invocations, 1h/24h selection |
| Settings resilience | Both APIs 503, metrics-only 503 preserving status, malformed successful response, partial provider outage with healthy MongoDB |
| Mobile | 390px Settings has no page-level horizontal overflow and all four primary routes remain usable |

`frontend/vite.e2e.config.ts` disables env files, clears both private Home coordinates, supplies a synthetic public map key and replaces only `./arcgisRuntime` with `e2e/arcgis-runtime.mjs`. Production Vite configuration/output remains separate (`dist` versus ignored `dist-e2e`). The actual DashboardMap component/controller still initialize, apply feature edits, handle failures, destroy views and publish browser-session status. The adapter validates feature IDs and emits test-only lifecycle/count events without coordinates or arbitrary errors. Visiting Settings directly still shows **Not Yet Verified** for the browser SDK. An operational browser observation in these tests means the adapter initialized, **not real ArcGIS availability**.

Backend geocoding is injected at `createApp`, accepts only synthetic input prefixes and records synthetic events; no ArcGIS transport is created. OpenAI is unconfigured and no SDK client is instantiated. Backend global fetch throws; browser requests outside the exact frontend loopback origin are blocked and fail the test. Service workers are blocked. Only system endpoint fault scenarios intercept API responses; normal CRUD, analytics, health probing and successful status/metrics use the real backend/database. Unknown tokens remain unknown. Refresh asserts the sole injected geocoding failure count remains one and model invocations remain zero, so page reads cannot manufacture paid-provider calls.

Known gaps: actual ArcGIS SDK loading/WebGL/tiles/rendering accuracy, live geocoding correctness, OpenAI model quality, browser-specific behavior outside Chromium, full accessibility audits, visual regression, load/performance SLOs, multi-user concurrency, replica sets, session/annual/vehicle workflows and every CRUD edge case. Existing unit/integration/fault suites continue covering lower-level validation/privacy. The current map controller can report a queued feature-update failure after an initial readiness rejection; E2E asserts the visible unavailable outcome rather than assuming the initial message remains the latest one. This milestone does not alter that production behavior.

## CI and failure diagnostics

The **E2E smoke (Chromium)** job runs after the six required fast checks, including Production build. It uses `npm ci`, installs only the Chromium headless shell plus Ubuntu dependencies, and owns a new authenticated MongoDB service. Job timeout is 15 minutes; Playwright global limit is 5 minutes, each test 30 seconds, assertions/actions 8 seconds, navigation 15 seconds, and each server startup 120 seconds. CI permits one retry to collect comparison evidence for transient runner issues. `failOnFlakyTests: true` keeps the gate red if any test passes only after retry; no known flaky test is excused. `Quality gate` requires E2E success, including when it is skipped/cancelled. The required GitHub check list in [CI](ci.md) must be updated by an administrator; workflow edits do not activate branch rules.

`reports/e2e/` contains HTML, JSON, JUnit, per-test execution metadata (Node/browser/project/retry/dataset), and, on failure, screenshots, DOM error context and Playwright traces. Failure traces are retained even with zero retries; video is disabled. CI also saves execution logs and always uploads available diagnostics with seven-day retention. Startup/install failure may leave no browser artifacts, and still fails the check. Reports/build artifacts are Git-ignored.

Artifacts are safe by construction: fresh synthetic data, no persisted browser profile, env loading disabled, private Home coordinates cleared, loopback allowlist, sanitized harness error messages and no raw provider client/payload. Screenshots/traces are **not a general-purpose redaction engine**. Never repoint the suite at a private instance or add real addresses/credentials to fixtures. Traces include request bodies/DOM/source; fixture and mock changes require privacy review before uploading. Never upload database files, `.env`, an arbitrary workspace or a normal private frontend build.

## Measurement and triage

Classify failures as: application regression (UI/API/validation), data isolation/fixture, SDK-adapter contract, test locator/assertion, browser/OS/runner provisioning, server/database startup, or external download availability. Inspect first-attempt artifacts before considering a rerun. Do not add arbitrary sleeps, broaden exception swallowing, remove assertions or increase retries to hide a failure.

The JSON report records overall duration/start time and per-attempt duration/status/retry; JUnit/HTML retain individual outcomes. Track each CI run's commit, OS/toolchain, first-attempt failures, retry recoveries and recurring test identities. Over a rolling set of comparable runs, report first-attempt failure rate and retry-recovery count with the exact denominator and classification. Preserve a separate reviewed aggregate history beyond the seven-day artifact window if long-term trends are needed. `test:e2e:repeat` is a short diagnostic for deterministic repetition, not historical evidence of a production flakiness rate. No long-term stability claim is made from this milestone.

## Actual verification (2026-10-23)

Node 22.23.4 / npm 10.9.0 and Playwright Chromium 156.0.8078.4 were used on macOS arm64. Measured Playwright reporter durations include automatic server startup/builds in these warm-cache runs; initial browser/package downloads and GitHub runner provisioning are separate.

| Execution | Actual result | Reported duration |
| --- | --- | --- |
| `npm run test:e2e`, default temporary MongoDB | 9/9 passed, zero retries/skips | 10.9 s |
| `npm run test:e2e:repeat`, fresh authenticated Docker MongoDB service | 27/27 passed, zero retries/skips | 13.7 s |
| `CI=1 npm run test:e2e`, same disposable service | 9/9 passed, all on first attempt | 7.2 s |
| `CI=1 npm run test:e2e`, fresh clean `npm ci` installation | 9/9 passed, all on first attempt | 6.4 s |

These are observed executions, not a long-term flakiness estimate. JSON reports retained retry/duration/status metadata. The E2E namespace was confirmed empty after graceful shutdown; the disposable verification container was stopped/removed and had no mounted application volume.

`npm ci` succeeded in a new source-only temporary copy without any real env files or previous dependencies. Only the three Playwright packages were added to the dependency graph; existing package versions and Linux libc metadata were preserved. The complete `quality:check` passed there: lint, strict types including E2E, production build, **134 backend** tests, **134 frontend** tests, **39/39** offline AI scenarios and all coverage floors. Backend statements/branches/functions/lines were **94.43 / 92.12 / 96.93 / 94.43**; frontend **89.34 / 84.66 / 87.95 / 92.30**. Both production/full-tree security audits reported zero vulnerabilities. Actionlint 1.7.12 and `git diff --check` passed. GitHub-hosted Ubuntu execution and branch-rule activation remain unverified until publication; no protection settings were changed.

Initial E2E runs correctly exited nonzero and produced screenshots/error context/traces. Two required-field selectors incorrectly used exact label text including hidden required markers; role/name selectors fixed them. A duration assertion expected `15m` while the existing UI renders `15 mins`; it was corrected to the actual contract. The SDK failure assertion was aligned with the existing queued-update error behavior described above, preserving the unavailable-status assertion and production code. An initial lint error for the browser-only adapter was resolved with file-scoped browser globals. During verification, a local report-file open stalled and overlapping frontend coverage commands triggered Vitest's directory lock; the second run was rejected rather than corrupting reports. Serial clean-copy execution passed without weakening checks. Existing large ArcGIS production chunks and ESLint 9 support notices remain warnings.

References: [Playwright web servers](https://playwright.dev/docs/test-webserver), [retry semantics](https://playwright.dev/docs/test-retries), [trace viewer](https://playwright.dev/docs/trace-viewer).

## CI startup recovery

The original live E2E job failed in Docker service creation before Chromium or Playwright ran; it was not an E2E assertion result. The workflow now creates the unchanged ephemeral MongoDB image without quoted Docker health options, then executes `npm run test:mongo:ready` with the dynamic port after `npm ci`, before browser installation and test servers. A readiness failure exits nonzero and saves `reports/mongodb-readiness.log` alongside any available E2E diagnostics. Playwright server/global errors in the execution log are distinct from per-test failures in JSON/JUnit/HTML; screenshots/traces require that a browser test actually started. See [CI recovery](ci.md#ci-service-recovery-2026-10-23) for the confirmed cause, fresh-commit verification and the absent Allure milestone. Existing synthetic fixtures, external-provider isolation, timeouts, retries and failure-artifact privacy boundaries are unchanged.

## Consolidated Allure reporting

The later [Allure 3 integration](allure-reporting.md) adds `allure-playwright` to the same smoke execution. No application test is repeated just to generate Allure. Audited results are isolated under `artifacts/allure-results/e2e/chromium/`; existing Playwright reports remain available separately. Failure PNGs require the synthetic fixture boundary, and traces failing bounded content inspection are omitted from publishable Allure artifacts. CI additionally verifies the reporters with temporary intentional-failure probes before smoke tests. Probe results do not enter application counts. Neither a generated report nor a successful report job can make a failed/flaky E2E Quality gate pass.

## README showcase screenshot

[`images/settings-synthetic.png`](images/settings-synthetic.png) is a genuine Chromium capture of the implemented Data & Settings page on **2026-10-25**, not the design concept in `ui.ux.design.png`. It shows the overview and complete provider panel at a 1440px desktop width. Unknown browser/geocoding states and unconfigured AI are intentional observations, not fabricated healthy statuses.

Capture used the existing `e2e/server.mjs` fixture/reset entrypoint, an additional ephemeral tmpfs MongoDB container with synthetic credentials and guarded test namespace, and `vite.e2e.config.ts`. The browser clock used the existing fixture instant `2026-03-08T20:00:00Z`; backend observation timestamps are actual capture-time measurements. No production `.env`, personal records, private Home coordinates or browser profile entered the capture. Browser requests outside the offline frontend origin were blocked; the capture recorded zero external requests and zero page errors.

For a new capture, start the two existing offline server commands (`npm run e2e:backend` and `npm run e2e:frontend`) using the default disposable MongoDB or the exact guarded service environment described above. Reset with `POST http://127.0.0.1:4310/__e2e/reset`, open `/settings` on port 4311 in a fresh isolated browser, and wait for the heading, enabled refresh control and metrics table. Keep the same external-request deny policy and leave private coordinates empty. Capture the complete overview/provider panels; inspect the image before publishing. Stop the test servers and dispose only their test database afterward. Do not repoint this procedure at the normal personal application on ports 5173/3000.

The SDK adapter is an offline lifecycle boundary; the image establishes neither live ArcGIS connectivity nor real WebGL/basemap rendering. OpenAI was unconfigured and geocoding injected. No decorative map imagery or usage statistics were added to the screenshot.
