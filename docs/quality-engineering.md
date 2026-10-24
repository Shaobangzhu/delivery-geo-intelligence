# Software quality baseline

Measured on 2026-10-22 with Node **22.12.0**, npm **10.9.0**, and disposable MongoDB **7.0.24**. The machine-readable observation is [quality-baseline.json](quality-baseline.json). This is a measured starting point, not an assertion of production readiness.

## Repository audit

Before this milestone, the root already exposed `typecheck`, `build`, and `test`, forwarding to the two npm workspaces. There was one committed root npm v3 lockfile, no ESLint configuration, no coverage provider/configuration, and no numeric coverage thresholds. `npm run typecheck` passed before implementation. The original backend test command compiled TypeScript and ran `node --test test/*.test.mjs`; the frontend used `vitest run`. Historical test counts in README were not treated as current measurements.

The backend had 11 native test files, combining pure domain tests and HTTP/MongoDB integration tests. Nine files imported `dotenv/config` and used `MONGODB_URI` from the environment; integration tests generated unique database names and dropped those databases in cleanup. That avoided ordinary collection collisions but still required access to a user-configured server. The application Docker Compose stack uses credentials and a persistent volume, so it is deliberately not used for quality checks. Original secret-loading test commands were not executed during this audit.

The frontend has 17 Vitest files using jsdom, React Testing Library, jest-dom, and user-event. Tests cover navigation, forms, async responses, cancellation, analytics, map controller behavior, and calendar utilities. Fetch/API fixtures are synthetic; map tests replace the ArcGIS runtime. Backend geocoding tests inject fetch implementations; AI tests inject scripted Responses clients. `backend/test/annualFixture.mjs` and `backend/evals/fixtures.ts` supply synthetic annual/analytics observations. There are no committed personal import files required by tests.

Both workspace TypeScript configurations retain `strict`, `noUnusedLocals`, `noUnusedParameters`, and `skipLibCheck`. Backend targets ES2022/NodeNext; frontend targets ES2022/Bundler with React JSX. Backend typechecking now also checks the existing evaluation TypeScript project. Backend builds clean only their generated `dist` directory, then emit source maps with embedded source for coverage remapping. Frontend builds typecheck before Vite bundles the application. ArcGIS produces the existing warning about chunks larger than 500 kB; no limit was raised or warning suppressed.

Application dependency versions retained from the original lockfile include React/React DOM 19.3.0, React Router 7.18.4, Vite 8.3.0, ArcGIS 5.1.25, Express 5.2.1, Zod 4.6.5, MongoDB driver 7.6.0, OpenAI SDK 7.31.0, and TypeScript 7.0.2.

Compatibility fixes and tooling decisions:

- The original jsdom 30.1.1 and several transitive dependencies require newer Node 22 patch versions than 22.12. jsdom is pinned to 26.1.0. During verification, jsdom 27.4/28.1 returned comma-separated selector results grouped by element type for nested forms, rather than document order; the existing Shift+Tab test correctly failed by focusing Notes instead of Save. A standalone nested-form reproduction confirmed the environment defect. jsdom 26.1 passes the unchanged focus assertions. Root and frontend both declare the same version because hoisted Vitest resolves this optional peer from the root.
- Backend Node declarations are pinned to 22.10.2, matching the Node 22.12-era API, instead of allowing Node 26 APIs in backend code.
- ESLint 9.39.5 and typescript-eslint 8.55.0 support the minimum runtime. Newer ESLint/visitor-key dependencies require Node 22.13+. ESLint 9 has an upstream end-of-support notice; update it when the supported minimum can advance. The parser has its own supported TypeScript 5.9.3 at the root; both application workspaces continue compiling with TypeScript 7.0.2. No peer dependency checks were bypassed.
- Flat ESLint configuration covers backend/frontend TypeScript, React Hooks, native `.mjs` tests/helpers, evaluation sources, and configuration files. Generated output/dependencies are ignored. Recommended correctness rules and the two core Hooks rules are enforced with zero warnings; React Compiler-specific rules and type-aware linting are not enabled in this baseline. Destructuring used to omit fixture fields is allowed with `ignoreRestSiblings`. TypeScript unused-symbol checks remain enabled. The map initialization effect now lists its stable `home` state value; it still initializes once per mount.

## Reproducible installation and commands

Use Node 22.12.0 for baseline comparisons (`.nvmrc`), npm 10.9.0, and the committed root `package-lock.json`. Supported runtime majors are declared in root `engines`; odd-numbered Node releases are outside the test toolchain's supported range. Install from the repository root:

```sh
nvm use
npm ci
npm run quality:check
```

Do not run `npm install` in each workspace or recreate the lockfile. Tooling/provider updates should be reviewed with their resulting coverage changes. `npm ci` requires access to the npm registry or a pre-populated npm cache. The first backend test run downloads the pinned MongoDB binary (about 66 MiB on the measured macOS platform) from MongoDB's distribution service into `node_modules/.cache/mongodb-binaries/`. Later runs reuse it. The `-core` package has no install-time MongoDB download hook.

MongoDB must be able to start a local child process and bind an ephemeral loopback port. Linux runners need MongoDB's platform libraries (including libcurl and compatible OpenSSL); see the [upstream platform requirements](https://typegoose.github.io/mongodb-memory-server/docs/guides/known-issues/). An unavailable binary/download or startup failure fails the command; integration tests are never silently skipped or redirected to an existing database.

| Root command | Behavior |
| --- | --- |
| `npm run lint` | ESLint across source, tests, evaluation code, and configs; warnings fail. Workspace `lint` commands are also available. |
| `npm run typecheck` | Both strict application checks plus backend evaluation typecheck; no emit. |
| `npm run build` | Existing frontend production build and backend compilation. Normal frontend builds retain Vite's existing `.env` behavior. |
| `npm run build:quality` | Same frontend production compilation/bundling using `--mode quality`, with `envDir: false`, then backend compilation. No `.env` read. |
| `npm test` | All backend tests on disposable MongoDB, then all frontend tests, without coverage. |
| `npm run test:coverage` | All backend and frontend tests, with fresh coverage reports. |
| `npm run eval:ai` | Existing deterministic synthetic AI evaluation; no real provider calls. |
| `npm run quality:check` | Fail-fast lint → typecheck → credential-free build → coverage tests → mock AI evaluation. Tests run once through the coverage commands. |

The public dev, database, data initialization/import, and evaluation command names are preserved. Database/data commands are outside the quality gate and must not run against personal records during verification. Use `build:quality` when a local checkout has real `.env` files. A plain `build` can be verified in a clean checkout containing no real environment files; never substitute production credentials to make a quality check pass.

## Test isolation and execution

`backend/test/run.mjs` starts a new real MongoDB process bound to `127.0.0.1` on an ephemeral port with temporary storage. It overwrites the child test process's database URI with that process's generated URI, clears provider keys, sets UTC, and runs the sorted test files serially using native `node:test`, with a 30-second test timeout. Existing per-suite unique databases and cleanup remain. The runner stops the MongoDB process and removes temporary storage on completion, forwards SIGINT/SIGTERM to the test child, and returns failures as nonzero exit codes. Abrupt SIGKILL/host failure cannot guarantee cleanup.

Database tests import a guard instead of dotenv; direct invocation without the disposable runner fails before constructing a MongoClient. Do not set the runner's internal environment marker manually. Backend fetch permits only loopback HTTP; external ArcGIS/OpenAI requests must use existing injected stubs. Two new isolation regressions verify rejection of external fetch and rejection of a direct database test setup even when a synthetic personal-style URI is supplied. They never connect to that URI. The original 94 reported backend tests are retained; native Node reports 96 total tests including these two regressions (parent integration tests are included in Node's count).

Vitest disables environment-file loading, fixes UTC, retains per-file isolation, clears mocks, limits workers to two, and installs a fail-fast default fetch stub. Tests explicitly replace it with synthetic responses. Geocoding and model evaluation are still mocked; no real external-service accuracy is established. No real `.env` was read or modified and no personal MongoDB server was accessed during this milestone.

## Coverage measurement

Frontend uses `@vitest/coverage-v8` **5.0.1**, pinned exactly with Vitest **5.0.1**. Explicit `src/**/*.{ts,tsx}` inclusion counts modules that no test imports, including `main.tsx` and the real ArcGIS runtime loader. Only tests and `src/test/` setup are excluded.

Backend uses c8 **12.0.0** around the existing native runner. c8 collects V8 coverage from the runner and test subprocesses. `all: true` and `dist/**/*.js` include every compiled application module, including unexecuted server/config/import/initialization entrypoints. TypeScript source maps remap reports to `src`. Cleaning `dist` before builds prevents deleted/renamed modules from contaminating the denominator. Evaluation code and test fixtures are not production-code coverage targets; evaluation itself is a separate required check.

Both commands clean their previous coverage data and produce the following under each workspace's ignored `coverage/` directory:

- `index.html`: browsable HTML report.
- `lcov.info`: LCOV for future CI upload.
- `coverage-summary.json`: aggregate and per-file totals.
- `coverage-final.json`: detailed Istanbul-compatible counters.

Observed baseline (all tests passed; no skips):

| Workspace | Tests / files | Production files | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- | --- | --- |
| Backend | 96 / 12 | 24 | 93.71% (2222/2371) | 90.86% (1303/1434) | 95.86% (139/145) | 93.71% (2222/2371) |
| Frontend | 120 / 17 | 36 | 89.08% (1273/1429) | 84.33% (1077/1277) | 87.38% (381/436) | 92.00% (967/1051) |

The synthetic AI evaluator passed **39/39** scenarios with **0 real provider calls**. Its scenarios and mock request counts are separate from unit/integration test counts and coverage.

V8/c8 statement mapping is line-oriented, so backend statement and line totals are identical. These are not an AST statement count equivalent to the frontend provider's counts. Branch/function denominators differ across providers, compiler output, source maps, Node/V8 versions, and unexecuted modules (c8 synthesizes zero-hit entries). Empty/type-only modules can show 100% without testing behavior. Coverage is therefore compared per workspace with a fixed toolchain, never averaged across the two. HTML rendering, timestamps, absolute report paths, and durations need not be byte-identical across runs; reproducibility means equal source scope and measured coverage counters with the same versions.

No difficult application file is excluded and no pre-existing threshold was lowered. This milestone records coverage without an arbitrary percentage gate; a report from a failing test execution is not an accepted baseline. Do not automatically overwrite the committed observation from a failed run.

## Known gaps and incremental quality gates

The current blocking gate requires lint with no warnings, strict typechecks, both build outputs, passing backend/frontend tests with no skipped tests in the measured suite, coverage generation, and all synthetic AI scenarios passing. Numeric coverage is initially reporting-only. No browser E2E, accessibility audit, mutation test, load test, or live-provider test was performed.

Priority gaps visible in the reports include:

- Server startup/shutdown and environment validation; `index.ts`, `config/env.ts`, and the two operational CLI entrypoints have zero coverage. Test these later through isolated subprocesses with synthetic configuration/storage rather than importing them against personal records.
- Real ArcGIS SDK loading, WebGL/rendering, remote tiles, geocoding semantics, and provider networking. Map controller mocks do not validate a browser/SDK integration; `arcgisRuntime.ts` and frontend bootstrapping remain unexecuted.
- Model-selected tool routing, Chinese response quality, actual provider latency/usage, and model behavior are not established by scripted Responses clients. SDK success-path/network errors require an injected transport/local fixture server before any authorized live checks.
- Additional HTTP/database outage and malformed legacy-record branches, plus frontend API error/cancel and form branches. The database is a standalone MongoDB process; replica-set transactions, distributed writers, deployment failures, and recovery after host loss are outside this suite.

Threshold strategy:

1. Retain this observation and compare repeated clean runs using the same Node/compiler/provider versions and full source scope. Diagnose instability before enforcing numeric floors.
2. In the next gate milestone, enable independent statements/branches/functions/lines floors for each workspace using the reproducible measured values as the starting floors (rounded down only to the precision supported by the runner). Do not start at a blanket 80% or aggregate the workspaces. Review any provider/Node-induced denominator changes explicitly.
3. Raise the corresponding floors in the same change that adds meaningful regression coverage for the priority gaps. Ratchet upward after stable runs; never lower an established floor, suppress failures, or exclude entrypoints/provider boundaries to improve the number. New untested production files must continue entering the denominator.
4. Add targeted changed-code review and browser E2E criteria once their fixtures/runtime are reproducible; high global coverage alone cannot protect critical financial/privacy behavior.

## Verification and CI readiness

The repository now has a local credential-free gate, a committed lockfile, a minimum-runtime pin, isolated database provisioning, and machine-readable reports. No CI workflow, deployment integration, telemetry infrastructure, or live-service credentials are introduced by this milestone.

Changed/new files (28 total):

| Scope | Files |
| --- | --- |
| Root scripts/tooling/docs entrypoint | `package.json`, `package-lock.json`, `.nvmrc`, `eslint.config.mjs`, `README.md` |
| Backend configuration | `backend/package.json`, `backend/tsconfig.json`, `backend/.c8rc.json` |
| Backend test infrastructure/regressions | `backend/test/run.mjs`, `backend/test/support/environment.mjs`, `backend/test/isolation.test.mjs` |
| Existing backend tests, replacing dotenv/ambient database URI only | `backend/test/ai.test.mjs`, `backend/test/api.test.mjs`, `backend/test/coreAudit.test.mjs`, `backend/test/dashboard.test.mjs`, `backend/test/dashboardTime.test.mjs`, `backend/test/efficiency.test.mjs`, `backend/test/sessions.test.mjs`, `backend/test/settlementEfficiency.test.mjs`, `backend/test/uberAnnual.test.mjs` |
| Frontend | `frontend/package.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/src/test/setup.ts`, `frontend/src/dashboard/DashboardMap.tsx` |
| Quality documentation/baseline | `docs/quality-engineering.md`, `docs/quality-baseline.json`, `docs/ai-evaluation.md` |

Actual executions on Node 22.12.0/npm 10.9.0:

| Verification | Observed result |
| --- | --- |
| Source-only clean copy, with no `.git`, dependencies, outputs, or real `.env` files copied | `npm ci --no-audit --no-fund` succeeded, installing 583 packages. Deprecation notices for ESLint 9 and transitive whatwg-encoding were reported; no audit result is claimed. |
| `npm run build` in that clean copy | Passed for both workspaces; existing ArcGIS chunk-size warning only. |
| `npm test` in that clean copy | Backend 96/96 and frontend 120/120 passed, no failures/cancellations/skips. |
| `npm run quality:check` in the working checkout and clean copy | Lint, typecheck, environment-free build, coverage tests, and 39/39 mock evaluations passed; zero real provider calls. |
| Coverage comparison between working checkout and clean copy | Aggregate and every per-file summary matched exactly. All 24 backend and 36 frontend production modules were accounted for, including unimported entrypoints; HTML, LCOV, summary, and detailed JSON reports existed and were nonempty. |
| Installation/build/test/gate lockfile comparison | Lockfile bytes unchanged. All original direct production dependency versions retained. |
| Dependency engine audit | No locked package engine declaration rejected Node 22.12.0. |
| `npm run lint --workspaces` and `git diff --check` | Passed. |

Compatibility investigation failures (unresolved hoisted jsdom peer and selector ordering in jsdom 27/28) were fixed, with the original focus test kept intact. An initial toolchain inspection ran on host Node 24.19.0/npm 11.17.0; its numbers were not used as the minimum-runtime baseline. No remaining failing application test was suppressed.

Future CI should run `npm ci` then `npm run quality:check` on the pinned runtime, provision no application Docker Compose/database, cache npm and the version/platform-specific MongoDB binary, and upload each workspace's coverage directory separately. Use an OS image with supported MongoDB native libraries. Cache keys should include lockfile, runtime, OS/architecture, and MongoDB version. Do not cache temporary database contents or `.env` files. Fail on test/check failure or missing expected reports; any future skip policy requires explicit review. A Node 24 matrix job is useful additional compatibility evidence but does not replace the minimum-runtime run. Installation is reproducible from the lockfile; npm registry access and the MongoDB binary remain external availability requirements.

References: [Vitest coverage](https://vitest.dev/guide/coverage.html), [c8 all-files/source-map behavior](https://github.com/bcoe/c8), [typescript-eslint flat config](https://typescript-eslint.io/getting-started/), and [temporary MongoDB package behavior](https://typegoose.github.io/mongodb-memory-server/docs/guides/quick-start-guide/).

## Blocking CI milestone (2026-10-23)

The earlier report-only policy and CI-readiness plan above describe the initial milestone. `.github/workflows/ci.yml` now implements blocking PR/main/manual checks. Current local/CI runtime is Node 22.23.4 (`.nvmrc`) and npm 10.9.0; Node 22.12 remains historical baseline evidence. All four original numeric floors per workspace are now enforced by `npm run coverage:check`, also included in `quality:check`, with no threshold reduction or source exclusions. Vite 8.3.5 and exactly paired Vitest/coverage-v8 5.0.5 are compatible security updates; the original snapshot is preserved.

Additional equivalent commands: `npm run test:backend:unit` (no database), `npm run test:backend:integration` (only real-driver suites), `npm run test:frontend`, and `npm run security:check` (production and full-tree audits, high/critical blocking). `npm test` retains all tests. All real-driver test clients now enforce a dedicated hashed test namespace. CI uses isolated authenticated MongoDB services instead of the application Compose stack; local default temporary-MongoDB behavior remains available. JUnit/coverage and synthetic diagnostics are uploaded even on failures. See [CI implementation and exact branch protection setup](ci.md) for check names, environment variables, security policy, artifacts and settings still requiring administrator action. Branch protection is not claimed active.

## Chromium E2E milestone (2026-10-23)

The initial no-E2E gap above is now partly covered by a dedicated blocking **E2E smoke (Chromium)** check. `npm run test:e2e` automatically builds/starts the real frontend/backend and isolated synthetic MongoDB; `npm run test:e2e:repeat` repeats each workflow three times without retries. `typecheck` now also checks Playwright TypeScript tests/config; lint covers E2E helpers. Production coverage scope/floors remain unchanged, and E2E workflow coverage is reported separately from c8/Vitest code coverage. Run `quality:check`, `security:check` and `test:e2e` for full local parity. See [E2E testing](e2e-testing.md) for exact boundaries, fixtures, measured duration, failure diagnostics, independent execution, gaps and the plan for historical flakiness measurement. Browser/provider connectivity is not established by the offline SDK adapter.

## CI recovery follow-up (2026-10-23)

The initial live CI runs exposed a runner/Docker argument-parsing failure before MongoDB-dependent tests could execute. All three jobs now use a shared bounded, authenticated Node-driver readiness command (`npm run test:mongo:ready`) instead of shell healthcheck strings in service options. The isolated database guards, source coverage scope, numeric floors and blocking result propagation are retained. Deterministic native readiness regressions cover safe configuration, retry/cleanup, ping and credential-free diagnostics. Current security advisories required compatible Zod 4.6.6 and body-parser 2.4.0/qs 6.16.1 updates, without policy exceptions. The actual Allure implementation referenced by Prompt 06 was absent in this clean checkout and was not invented. See [CI recovery, failure inspection and reporting limitations](ci.md#ci-service-recovery-2026-10-23).

## Allure 3 milestone

The later reporting milestone supplies the previously absent Allure implementation. Normal backend, frontend and E2E commands now emit isolated/audited results without extra application executions. `allure:test` runs one full execution per layer and generates static HTML; `allure:generate`, `allure:open`, `allure:clean` and `allure:verify` provide consolidation, local viewing, cleanup and isolated failure/privacy probes. Existing quality scripts, coverage source scope/floors, assertions and native diagnostics remain in place. The new **Allure report** CI job is also required by **Quality gate**. See [Allure reporting](allure-reporting.md) for Node 22 reporter-only restrictions, real-execution counting, skipped-case limitations, privacy and the upstream prebuilt JavaScript review required before public hosting.
