# Blocking GitHub Actions CI

`.github/workflows/ci.yml` runs for pull requests targeting `main`, pushes to `main`, and manual dispatch. There are no path filters that silently skip required checks. Jobs use Ubuntu 24.04, Node **22.23.4** from `.nvmrc`, npm **10.9.0**, `npm ci`, and the committed root lockfile. Official actions are pinned to inspected commit SHAs. The Mongo image is pinned to 7.0.24 plus its manifest digest. No deployment or badge-only gate is introduced.

## Check names and local equivalents

These are the exact job/check display names (not workflow file paths):

| Required check | Local command | Limit |
| --- | --- | --- |
| ESLint | `npm run lint` | 15 min |
| TypeScript | `npm run typecheck` | 15 min |
| Production build | `npm run build:quality` | 15 min |
| Backend unit tests | `npm run test:backend:unit` | 15 min |
| Frontend unit tests | `npm run test:frontend` | 15 min |
| Offline AI evaluation | `npm run eval:ai` | 15 min |
| MongoDB integration tests | `npm run test:backend:integration` | 20 min |
| Coverage | `npm run test:coverage && npm run coverage:check` | 20 min |
| Dependency security | `npm run security:check` | 10 min |
| E2E smoke (Chromium) | `npm run test:e2e` | 15 min |
| Quality gate | Aggregate requiring every preceding job to succeed | 2 min |

The six independent fast checks are matrix jobs with fail-fast disabled. Integration, coverage and security run independently. E2E waits for the fast checks, including the production build, then provisions its own service and offline application build. `Quality gate` runs with `always()` and explicitly requires `success` for every dependency; failed, skipped or cancelled stages cannot turn it green. No `continue-on-error` is used. Bash pipeline failure propagation is retained when tee writes diagnostic logs. Workflow concurrency cancels superseded work for the same PR/ref; cancelled work cannot satisfy the required latest checks.

`npm run quality:check` remains the credential-free local suite (lint, types, production-mode build, full coverage tests, offline AI evaluation) and now also enforces coverage floors. `npm run security:check` is separate because it requires current registry audit data; run it before opening a PR. Chromium E2E is also separate: install the browser with `npx playwright install --only-shell chromium`, then `npm run test:e2e`; see [E2E isolation and diagnostics](e2e-testing.md). Independent unit/integration commands match the CI stages. `npm test` still runs all tests. Normal `npm run build` retains application environment loading; CI's `build:quality` uses the same production bundling with environment files disabled. No global NODE_ENV=test overrides production compilation.

## Isolation and environment

CI does **not** run the application's `docker-compose.yml`: that stack requires local credentials and uses a persistent application volume. Each integration/coverage/E2E job instead creates a fresh service container with no persistent application volume, a healthcheck, and a random mapped port. All three database jobs have their own container. The only service credentials are deliberately public, synthetic workflow literals:

| Variable | Source / value |
| --- | --- |
| `MONGO_INITDB_ROOT_USERNAME` | Service only: `dgi_ci` |
| `MONGO_INITDB_ROOT_PASSWORD` | Service only: `synthetic_ci_only` |
| `MONGO_INITDB_DATABASE` | Service only: `dgi_ci_test` |
| `DGI_TEST_MONGO_MODE` | Integration/coverage/E2E jobs: `service` |
| `DGI_CI_MONGO_URI` | Test step only: `mongodb://dgi_ci:synthetic_ci_only@127.0.0.1:<assigned-port>/dgi_ci_test?authSource=admin` |
| `OPENAI_API_KEY`, `ARCGIS_GEOCODING_API_KEY`, `VITE_ARCGIS_API_KEY` | Explicitly empty: clients are injected/mocked, not authenticated |
| `TZ` | `UTC` |

No real `.env` file is copied/read, and no GitHub secrets are required. The test runner alone sets internal `DGI_TEST_SCOPE`, `DGI_TEST_MONGODB_URI`, `MONGODB_URI` and NODE_ENV=test in the test child. Do not manually set those internal URI markers. ArcGIS mock-specific synthetic keys are supplied within tests. The offline AI runner uses scripted providers, contains no live client/database initialization, rejects accidental global fetch, and has been verified deterministically (39 assertions/scenarios); it is blocking.

Service mode is opt-in and accepts only the exact synthetic credential pair, loopback host, numeric port, `dgi_ci_test` URI path and `authSource=admin`. Any production/remote URI is rejected before connection. Every real database test imports a guarded test client. It rejects absent or non-test database names, then maps synthetic suite names into `dgi_ci_test_<24 hex hash>`; hashing keeps MongoDB namespace limits safe and cleanup deterministic. All `dropDatabase` operations consequently target only that namespace. Guard regression tests reject the real DGI database name without connecting. The service credentials have administrative rights only inside this newly created disposable container; the guards complement, rather than replace, ephemeral server isolation. This is not a sandbox for arbitrary untrusted test code.

Unit tests are explicitly separated via `test.integration` registration. Unit scope does not start/connect MongoDB; fake DB/API tests can still bind loopback HTTP servers. Integration scope registers only real-driver roots, retaining all native nested `t.test` assertions. Full coverage scope registers everything. Excluded-scope tests are not registered (not silently marked passing/skipped); full-scope coverage remains the completeness check. Existing suites were not migrated to a different framework. The runner has per-test 30-second deadlines and a two-minute process watchdog so leaked handles cannot hang indefinitely.

Without service mode, integration/full tests retain automatic fresh MongoMemoryServer provisioning and cleanup. For exact service parity locally, start an explicitly new `mongo:7.0.24` container with the synthetic init variables above and a random loopback port, then set only the two public `DGI_TEST_*` service variables listed above. Never point this at an existing personal MongoDB instance. No app database changes are required.

## Coverage enforcement

`coverage:check` uses the original measured `docs/quality-baseline.json` as immutable initial floors, independently per workspace and metric:

| Workspace | Statements | Branches | Functions | Lines |
| --- | --- | --- | --- | --- |
| Backend | 93.71 | 90.86 | 95.86 | 93.71 |
| Frontend | 89.08 | 84.33 | 87.38 | 92.00 |

Missing, empty or below-floor reports fail the process. Full coverage runs keep every production module in scope, including unimported entrypoints, with no new exclusions. The recorded original snapshot is not rewritten to manufacture a pass. These evidence-based floors are below the most recent local observations and can be raised after stable CI runs; do not lower them to accommodate a regression. Provider/Node updates require review of actual numerator/denominator changes and meaningful tests if needed. Numeric comparison is per provider (c8 versus Vitest), never averaged across workspaces. The coverage job collects before enforcing, so available reports survive a threshold failure.

## Dependency policy

Both production-only (`--omit=dev`) and full dependency-tree npm audits are blocking at **high/critical**, including transitive findings and findings without an automatic fix. Production dependencies are evaluated separately because they ship/run with the app. Development dependencies also execute untrusted PRs/builds and can compromise CI, so their actionable high/critical findings also block. Moderate/low findings are visible and require triage/review but are not blocking under this initial policy. There is no automatic exception, `audit fix --force`, blanket ignore, or hidden continue-on-error. Registry/network/audit-service errors fail closed and require retry rather than bypass.

Any future waiver must be explicitly approved by a repository maintainer/security owner in a reviewed policy change, identify the exact advisory/version/scope, explain reachability/mitigation, name an owner and expiry, and retain all other checks. No waiver is currently implemented or needed. The initial audit found 2 high and 3 moderate findings; compatible Vite 8.3.5, Vitest/coverage-v8 5.0.5 and source-map-js lockfile fixes removed them. Vitest's changed assertion generic types required an explicit typed jest-dom matcher augmentation; strictness and runtime assertions were retained. npm still reports the existing ESLint 9 upstream support notice, which is not an npm vulnerability advisory.

## Artifacts, permissions and failure behavior

All check/test/security jobs upload **available** reports with `if: always()`, including on command failure. Names are unique per matrix check or job, retention is seven days, and absent early-failure artifacts cause a warning rather than hiding the original failure. JUnit lives in `reports/backend-{unit,integration,all}.xml` and `reports/frontend.xml`; workflow tee logs live under reports. Coverage HTML/LCOV/JSON is uploaded separately for backend/frontend. Full reports are not expected when install/startup fails; the gate still fails.

Only known synthetic test diagnostics and source-code coverage are uploaded. E2E additionally uploads only `reports/e2e/` (synthetic screenshots, retained failure traces, HTML/JSON/JUnit, execution metadata and logs), with seven-day retention. No real browser profile or application dataset is involved. E2E retries are limited to one in CI; a recovered retry still fails via `failOnFlakyTests`. The workflow supplies no production secrets, never uploads `.env`, MongoDB data, dumps, home references, browser assets or arbitrary workspace files. Review new assertions/fixtures for privacy before adding them; coverage HTML contains repository source. Workspaces from malicious PRs can emit arbitrary artifacts, so treat downloaded diagnostics as untrusted data. PR code runs with `contents: read`, no write token scopes, checkout credential persistence disabled, and no `pull_request_target` or secret-bearing deployment job. Artifact upload uses the job's built-in artifact runtime authorization.

## Required GitHub-side setup (not applied)

Workflow files alone do not enable branch protection. After pushing this change and observing actual check names, an administrator should create an **active** branch ruleset (or equivalent branch protection) targeting exactly `main`:

1. Require a pull request before merging; require at least one approval, dismiss stale approvals after new commits, require approval of the most recent reviewable push, and require all conversations resolved. Configure code owners if the repository has an actual ownership file; do not claim a nonexistent ownership policy is enforced.
2. Require the eleven exact checks listed above, including `Quality gate`. Bind them to the GitHub Actions source when the settings offer that choice. Require branches to be up to date before merging; avoid duplicate check names from unrelated workflows.
3. Block force pushes and deletion of main. Apply the rules to administrators; keep the bypass list empty and do not grant routine bot/app bypasses. Review organization/other overlapping rules for unintended bypass rights.
4. Verify with a deliberately failing PR that merge is blocked, then repair it. Do not merge that failure. Workflow existence/local validation does not prove GitHub enforcement. Fork PRs may require a maintainer's initial workflow approval under repository Actions policy.
5. Keep merge queue disabled until adding/testing a `merge_group` trigger; this workflow currently implements only the requested PR/push/manual events. Private-repository plan limitations may affect ruleset/protection availability.

I have not changed repository protection or Actions settings. Applying them through a connector/gh requires a human's explicit approval of the repository, main target, exact required checks, review requirements and empty bypass policy, plus an admin-capable token. No production credentials should be granted to this workflow. A GitHub-hosted execution remains required to confirm Ubuntu/service behavior and the exact check source identifiers after publication.

References: [GitHub workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [required checks and branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [Node release status](https://nodejs.org/en/about/previous-releases).

## Actual local verification (2026-10-23)

Node 22.23.4 / npm 10.9.0 was used. `npm ci` installed successfully from the committed lockfile. The full `quality:check` passed lint, strict types, production bundling, 134 backend tests, 134 frontend tests and 39/39 offline AI scenarios. Separate commands passed 93 unit tests and 41 real-driver integration tests with zero failures/skips. Authenticated Docker service mode was exercised with a newly created MongoDB 7.0.24 container on a random loopback port, and the default temporary-MongoDB integration mode also passed. The verification container was stopped/removed. Repeated offline evaluation produced identical scenario/category results (durations intentionally differ).

Measured coverage remained above every original floor: backend statements/branches/functions/lines **94.43 / 92.12 / 96.93 / 94.43**, frontend **89.34 / 84.66 / 87.95 / 92.30**. Deliberately setting the generated backend branch summary below its floor caused nonzero exit; deleting that report also caused nonzero exit. The original report was restored in finally and normal coverage validation passed afterward. No committed baseline/floor was modified for these probes. Both production and full dependency audits reported zero vulnerabilities. Available JUnit and coverage artifacts were produced locally.

Official actionlint 1.7.12 validated workflow YAML/schema/expressions. Additional checks verified trigger branches, read-only permissions, timeouts, absence of continue-on-error and Bash syntax. An initial misplaced dynamic service-port expression was rejected by actionlint and moved into step env. Test verification also exposed MongoDB namespace length overflow from a naive prefix and Vitest/jest-dom generic/ESM incompatibility after security patches; these were fixed without relaxing assertions or weakening types. Existing ArcGIS large build chunks and ESLint 9's upstream support notice remain warnings. Local iCloud placeholder hydration briefly delayed final reads; no tests or security checks were suppressed for it.

No GitHub-hosted run, workflow publication, branch protection activation or bypass configuration has been performed in this chat. Those remain explicitly separate GitHub-side setup/verification.
