# Allure 3 reporting

Allure is a diagnostic report, not a replacement for test exit codes, JUnit, coverage thresholds or the CI Quality gate. No hosting/deployment is configured. The generated site is static HTML/JS/assets and can be served by a static host after the publishing review below.

## Supported versions and boundaries

The lockfile pins Allure CLI **3.22.1**, and `allure-node-test`, `allure-vitest`, `allure-playwright` and `allure-js-commons` **3.14.0**. Verification uses the project's `.nvmrc` (**Node 22.23.4**, npm 10.9.0). Java and Allure 2's `allure-commandline` are unnecessary.

| Layer | Integration | Existing tools retained |
| --- | --- | --- |
| Backend | Native `--test-reporter=allure-node-test/reporter`; JSON `ALLURE_NODE_TEST_CONFIG` | `node:test`, assertions, spec/JUnit reporters, guarded MongoDB harness, c8 |
| Frontend | `allure-vitest/reporter` and `allure-vitest/setup`, matcher logging disabled | Vitest/coverage-v8 5.0.5, React Testing Library, jsdom, JUnit |
| E2E | `allure-playwright`, `detail: false` | Chromium smoke tests, synthetic fixtures, existing HTML/JSON/JUnit and failure diagnostics |

**Node 22 uses reporter-only mode.** There is no `--import allure-node-test/setup`, preload, or backend call to the Allure runtime API. Full runtime integration needs Node 26.1+; runtime steps/attachments/labels are consequently unavailable to backend tests here. Native names, suite labels, status and measured duration are still collected. Nested native test roots and their child tests are separate real execution records, as emitted by the adapter.

The Vitest adapter supports the public `TestRunner` used by Vitest 5. Its declared legacy `@vitest/runner` peer is installed at published **4.1.11**; no `@vitest/runner@5.0.5` exists. Vitest and coverage-v8 remain at matching 5.0.5; neither framework nor assertions were migrated. Allure's peer dependency hoists Vitest to the root, so the same 5.0.5 coverage provider is also explicitly declared at the root to keep fresh-install provider resolution working. Adapter 3.14 omits static `test.skip` cases that have no execution result. Executed/dynamically skipped cases are reported. This limitation must be considered when comparing Allure totals with runner collection totals; the current application frontend suite has no skipped cases.

Official documentation: [native Node reporter](https://allurereport.org/docs/node-test/), [configuration](https://allurereport.org/docs/node-test-configuration/), [Vitest](https://allurereport.org/docs/vitest/), [Playwright configuration](https://allurereport.org/docs/playwright-configuration/), [Allure 3 configuration](https://allurereport.org/docs/v3/configure/), [generation](https://allurereport.org/docs/v3/generate-report/), [local viewing](https://allurereport.org/docs/v3/view-report/). Installed CLI help and actual generation, rather than Allure 2 command assumptions, determine the scripts.

## Results architecture

```text
artifacts/
  .allure-raw/                  # quarantined adapter output: never upload/publish
    backend/{all,unit,integration}/
    frontend/{unit,coverage}/
    e2e/chromium/
  allure-results/               # audited, projected JSON and permitted attachments
    backend/{all,unit,integration}/
    frontend/{unit,coverage}/
    e2e/chromium/
  allure-merged/                # deterministic flat CLI input
  allure-summary.json           # layers, actual outcomes/exit codes, audit counts
  allure-verification.json      # reporting probe results, no raw probe diagnostics
  allure-report/index.html      # generated static site with all supporting assets
```

Every supported command replaces its own execution directory, preventing append-only stale results. Do not run the same layer/execution concurrently in one checkout. Different CI jobs have isolated checkouts. Start a new consolidated local run with `allure:clean` or `allure:test`; an individual command deliberately preserves other layers so sequential aggregation works. Aggregation requires matching commit and CI run IDs, rejects duplicate result identities, missing/changed files and collisions, and processes directories/files in a fixed order. It never fabricates results for a suite that failed before collection.

`dgi-manifest.json` records a checksum inventory, observed status counts and original test exit code. Only allowlisted Git SHA, branch, numeric CI run ID (or `local`), Node runtime, `local`/`github-actions` category, layer, execution and synthetic dataset category are retained. Raw environment, host/user names, CI URLs and provider configuration are not copied. Local uncommitted edits are not represented by the Git SHA; record the working-tree state when distributing a local report. Hashes detect accidental changes, not a malicious actor able to replace both the artifact and its manifest.

The existing CI separately executes unit, integration and coverage jobs. Allure consumes those executions without adding another application test run. Coverage's backend `all` and frontend `coverage` executions remain distinct from unit/integration scopes. The consolidated count is **executions**, not unique tests, coverage percentage or a flakiness denominator. Execution labels/history IDs prevent these independent batches from becoming fake retries. Timings and adapter UUIDs naturally vary; reproducibility means the same fixtures, outcome collection and generation process, not byte-identical HTML.

## Local commands

```sh
nvm use
npm ci
npx playwright install --only-shell chromium
npm run allure:test
npm run allure:open
```

`allure:test` cleans only Allure paths, runs the backend, frontend and E2E suite once each, then generates the report. Each later layer still runs if an earlier suite fails; the first failing test exit remains nonzero even if report generation succeeds. No live OpenAI/ArcGIS service or production credential is needed. MongoDB defaults to the existing temporary-process harness; a first run may download its pinned binary. The guarded disposable service alternative is documented in [CI](ci.md) and [E2E](e2e-testing.md). Never supply a developer/application database URI.

To collect selected existing executions instead:

```sh
npm run allure:clean
npm run test:backend:unit
npm run test:backend:integration
npm run test:frontend
npm run test:e2e
npm run allure:generate
# Diagnostic report when an entire layer was unable to start:
npm run allure:generate -- --allow-partial
npm run allure:open
npm run allure:clean
```

The existing `npm test`, `test:coverage` and E2E commands automatically write Allure results during their normal execution. There is no reporting-only rerun. `allure:generate` requires all three layers by default; `--allow-partial` visibly records missing layers in the summary. Neither option changes failed outcomes or test exits. `allure:open` binds **127.0.0.1**. Use HTTP serving rather than `file://`, and preserve the entire report directory when moving it.

`npm run allure:verify` runs isolated synthetic **pass/fail/skip probes** through all three real adapters, checks nonzero failing exits, durations, hierarchy, redaction, a real Chromium failure screenshot and static generation for failed results. It serves that report on a temporary loopback port and verifies actual Chromium rendering with no browser errors or external requests. These intentional failures are successful infrastructure verification only when the assertions about them pass. Probe results are temporary and never merged into the application report. This needs installed Chromium but no database/application servers. Backend unit tests additionally cover redaction, metadata projection, bounded cleanup, artifact traversal/symlinks, checksums, duplicate IDs, mixed-run rejection, generated-site protection and the actual CI gate expression's failure/skipped/cancelled cases.

## CI collection and gates

Existing test jobs upload only their audited `artifacts/allure-results/` batches with `if: always()`, even after failing tests. The new **Allure report** job waits for test jobs using `always()`, downloads `allure-*` artifacts from the same run, and generates one static report using `--allow-partial`. A missing layer is diagnostic information, never a passing missing test suite. The report job uploads **consolidated-test-report**, including available audited results, summary and HTML, with seven-day retention even after a generation failure. Quarantined output is not uploaded. Existing coverage/JUnit/Playwright artifacts retain their separate handling and are not implicitly approved for public hosting.

The E2E job also runs `allure:verify` after Chromium installation. The final **Quality gate** requires the original checks, integration, coverage, security, E2E **and Allure report** to equal `success`. Reporting success cannot override failed, skipped or cancelled tests. Reporting failure is itself visible and blocking. There is no `continue-on-error`, `|| true` or test-exit replacement. Existing pipefail behavior remains. Add **Allure report** to the branch protection check list as described in [CI](ci.md); workflow changes do not activate repository protection.

## Privacy and publishing requirements

Adapter output is inherently unsafe to publish: failures may include expected/actual values, DOM snapshots, console logs, request bodies and raw exceptions. `scripts/allure/results.mjs` is an explicit projection/audit boundary:

- Retain test names, hierarchy, actual status and timing. Failure messages become an error category plus at most twelve relative repository source locations. Raw diffs, expected/actual values and exception payloads are withheld. Unknown statuses remain unknown.
- Discard parameters, descriptions/HTML, arbitrary labels, links, environment dumps, stdout/stderr and arbitrary JSON/text/HTML attachments. Known key/authorization/address/precise-coordinate patterns in retained names are withheld; URLs and user-directory paths are removed. This is conservative data minimization, not a promise that arbitrary free text can be perfectly anonymized.
- Permit only failure PNGs produced by the synthetic E2E harness, with signature/size/path checks. Trace ZIPs must pass bounded entry/path/content/URL inspection; unapproved or sensitive traces are omitted. Arbitrary trace resources are never automatically trusted. Some otherwise useful Playwright traces are intentionally withheld by this conservative filter. The summary records accepted/omitted attachment counts.
- Binary pixels cannot be exhaustively inspected by text scanning. The existing offline E2E harness, guarded/reset synthetic database, no personal addresses/records, mock providers and no reused application server are prerequisites for admitting screenshots. Before public hosting, manually review representative failure images and retained traces, metadata and generated report content. Adding a new attachment type requires a privacy review and regression coverage.

Regression fixtures use synthetic secrets/addresses and assert their absence in publishable results; real secrets, `.env` files and production records are never read. Raw temporary adapter output remains local under ignored `artifacts/.allure-raw/`; `allure:clean` removes it. Do not upload that directory or the repository wholesale. Only the audited generated site is a future hosting candidate; no Cloudflare credentials, deployment, public links or external analytics are introduced.

### Dependency review limitation

Allure 3.22.1's web-commons dependency pins DOMPurify 3.4.16. A narrow override pins its installed dependency to **3.4.17**, preserving the blocking production/full-tree `npm audit` policy. However, inspection found DOMPurify **3.4.16 embedded in the upstream prebuilt awesome-report browser bundle**; an npm override does not rebuild that vendor asset. Do not treat a clean dependency audit as proof that the prebuilt JavaScript is patched.

The publishing input contains no arbitrary HTML/descriptions/parameters, and generation adds a restrictive same-origin Content Security Policy. Only hashed generated bootstrap scripts and local script assets are permitted; external connections/objects are blocked and the base URI must stay on the same origin. Allure's hardcoded Google Analytics script/initializer are removed from generated HTML. The upstream optional performance-metrics widget is materialized as `{current: [], history: []}` when absent: it records an empty collection, not invented zero-valued samples, and avoids an otherwise harmless upstream 404. The static browser probe verifies these transformations against the installed generator. These are defense in depth, not a claimed upstream security fix. Before public hosting, require an updated upstream bundle/security review, recheck advisories and verify CSP/rendering/attachments. No vendor bundle is silently patched here. Reports remain local/short-lived CI diagnostics in this milestone.

## Verification record

Actual local validation used Node **22.23.4** / npm **10.9.0**, with a newly created MongoDB 7.0.24 Docker container, no mounted data volume, a random loopback port and only the public synthetic service credentials. The container was removed after verification. No real `.env`, personal MongoDB or live provider service was used.

| Command/check | Actual result |
| --- | --- |
| `npm ci` from the final lockfile | Success; 715 installed packages, no ignored peer constraints; existing Linux libc metadata retained |
| `npm run quality:check` | Success: ESLint, all typechecks, environment-free production build, backend **151/151**, frontend **134/134** (18 files), offline AI **39/39**, all existing coverage floors |
| `npm run test:mongo:ready` | Authenticated synthetic ping succeeded on attempt 1 |
| `npm run allure:test` | Success: backend **151**, frontend **134**, Chromium E2E **9**, no failures/skips; one complete **294-execution** HTML report |
| `npm run allure:verify` | Success: three real adapters each emitted 1 pass, 1 intentional failure, 1 skip; each failed runner exited **1**. Failed-result HTML generation succeeded, retaining those failures. One real synthetic failure PNG admitted; two other E2E diagnostics withheld |
| Static HTML Chromium check | Actual final report rendered; **0 external requests, 0 browser errors** |
| `npm run allure:generate` | Actual Allure 3 generation succeeded; missing-layer partial diagnostics and stale/checksum rejection were also exercised |
| `npm run allure:open -- --port 4329` | CLI bound 127.0.0.1; HTTP **200** with expected title and no analytics markup; server stopped after verification |
| `npm run security:check` | Production and full-tree npm audits each reported **0 vulnerabilities**; prebuilt asset caveat above still applies |
| `actionlint 1.7.12`, `git diff --check` | Both passed; actual aggregate-gate expression passed all-success and rejected each of six dependencies failed/skipped/cancelled (**19 combinations**) |
| Final artifact scan | **1,025** audited-result/report files checked; no regression fixture secrets, private sample payloads or local user-directory path matched; generated output is Git-ignored |

The final E2E runner reported **5.9 s**. Backend 151 includes the previous 141 regressions plus **10 reporting/gate/privacy tests**, and includes all **41 MongoDB integration cases**. Application source coverage stayed at backend **94.43/92.12/96.93/94.43** and frontend **89.34/84.66/87.95/92.30**, in statement/branch/function/line order. Reporters do not change these source denominators or floors.

Verification found and fixed two integration issues: fresh-install hoisting required the root coverage-provider declaration, and Playwright's CommonJS-loaded config rejected `import.meta` (the reporter now uses the root-relative path enforced by its launcher). The new gate probe initially parsed `E2E` incorrectly; its identifier parser was corrected without changing the actual gate condition. Static browser verification also required hash-authorizing Allure's generated bootstrap, preserving its same-origin base URI and supplying its omitted empty metrics widget. A restricted-sandbox invocation could not bind existing test HTTP servers; rerunning with loopback execution permission passed without assertion changes. No failure was converted to a pass or excluded from the quality check.

This milestone's workflow changes have been validated locally, **not executed on a fresh GitHub-hosted run**. Publication, required-check settings and any public-hosting security review remain separate. Historical counts in earlier quality documents describe their own milestones; they are not invented Allure measurements. Allure diagnostics do not establish real provider availability or historical flakiness.

## Changed files

| Area | Files |
| --- | --- |
| Locked dependencies and public commands | `package.json`, `package-lock.json`, `backend/package.json`, `frontend/package.json` |
| Reporter configuration | `allurerc.mjs`, `backend/test/run.mjs`, `frontend/vitest.config.ts`, `playwright.config.ts` |
| Collection, audit, aggregation and viewing protection | `scripts/allure/results.mjs`, `scripts/allure/run.mjs`, `scripts/allure/report.mjs`, `scripts/allure/site.mjs` |
| Automated reporting checks | `scripts/allure/verify.mjs`, `scripts/allure/verify-site.mjs`, `backend/test/allureReporting.test.mjs` |
| CI and generated-output handling | `.github/workflows/ci.yml`, `.gitignore`, `eslint.config.mjs` |
| Documentation | `README.md`, `docs/allure-reporting.md`, `docs/ci.md`, `docs/quality-engineering.md`, `docs/e2e-testing.md` |

No application business source, real configuration/records, existing source-coverage floor or generated report is part of the patch.
