# Static quality reports on Cloudflare Pages

This pipeline deploys **only generated, audited Allure Report 3 HTML/assets** to the Direct Upload project `dgi-quality-report`. It does not deploy DGI, run application migrations, upload frontend/backend builds, or need production provider/database credentials. There is no confirmed live report URL yet. Cloudflare project creation, secrets, environment protections and Access have not been verified/applied by this milestone.

## Architecture and trust

```text
CI (PR/main/manual; original blocking Quality gate)
  -> consolidated-test-report artifact: audited test results + per-run HTML
  -> completed CI event
Quality report release (trusted current main only; separate workflow)
  -> verify CI run via GitHub API
  -> download that run's actual artifact
  -> restore trusted prior main JSONL history
  -> regenerate Allure HTML from those same actual outcomes, without rerunning tests
  -> remove all test binary attachments; audit static candidate
  -> upload history (90 days) + candidate (7 days)
  -> default: stop, no Cloudflare credentials
  -> enabled + reviewed bundle + protected GitHub environment: Wrangler Direct Upload
```

`.github/workflows/quality-report.yml` listens for completed **CI** executions on main and supports manual dispatch. A workflow name or branch filter alone is insufficient: `scripts/allure/github.mjs` rechecks the repository/head repository, exact CI workflow path, push/manual event, completed success/failure conclusion, main branch, current main SHA and latest eligible completed CI run. Fork/PR/other workflow/old commit/older CI run artifacts are rejected. Publisher code is checked out at the release workflow's trusted main SHA, never from downloaded artifacts or a PR head. The publisher's SHA must also match the source CI SHA. Credentials are never used to execute artifact-supplied code.

The independent release workflow rebuilds the report once to incorporate restored history. This is report generation, **not another application test run**. Only its actual Allure HTML build output becomes the `quality-report-publication` artifact consumed by the deploy job. The original CI artifact remains available for comparison/diagnostics. No application suite is executed by the publisher.

Read-only `contents` and `actions` GitHub permissions suffice for checkout, source checks and cross-run artifact downloads. No GitHub write/deployments permission is needed by the direct Wrangler CLI. All official actions remain pinned to inspected SHAs. The root lockfile pins **Wrangler 4.152.0**, compatible with the existing Node **22.23.4** / npm **10.9.0** runtime. No floating `npx` install or deprecated Pages action is used.

## Initial setup (maintainer actions)

1. Merge the workflow/scripts/lockfile to main and allow Actions to run. Create a **Pages Direct Upload** project named `dgi-quality-report` with production branch `main` using the Cloudflare dashboard or the locked Wrangler CLI. This is separate from any DGI hosting project. No Git integration/build command, Functions, R2, bindings or application environment is needed. From the dedicated `quality-report/` directory, the administrative creation command is `npx --no-install wrangler pages project create dgi-quality-report --production-branch main`; it needs your own authenticated administrative session. Do not run it from the application root with real env files.
2. Create a Cloudflare API token scoped to the single intended **account**, with **Account → Cloudflare Pages → Edit**. No DNS/Zone, Workers KV/R2/D1, Access administration or account-wide superuser token is required. This account permission may cover multiple Pages projects; use a dedicated account if stronger project isolation is required. Set an expiry/rotation policy. Access setup uses a separate administrator, not this deployment token. See [Cloudflare's CI Direct Upload guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).
3. In GitHub Settings → Environments create **`quality-report-production`**. Restrict deployment branches to **exactly main**, disallow tags/other branches, require a reviewer and prevent self-review/bypasses where the repository plan supports it. Store **`CLOUDFLARE_API_TOKEN`** and **`CLOUDFLARE_ACCOUNT_ID`** as **environment-scoped Actions secrets** in this environment. Do not store them as general repository secrets: same-repository PR workflows can otherwise reference repository secrets. An environment restriction is a GitHub setting, not something YAML alone activates. Verify the setting before enablement; private-repository plan limitations may apply.
4. Keep repository variable **`QUALITY_REPORT_DEPLOY_ENABLED`** absent or `false`. Run main CI, then inspect the release workflow's dry-run candidate/history. No Cloudflare secret is referenced by preparation steps. Manual dispatch requires a numeric `ci_run_id` from the latest completed eligible CI on current main; `publish` defaults to false. Select the **main** ref. Feature-branch manual runs cannot publish.
5. Review the exact immutable UI bundle and privacy results. Only after explicit security approval set repository variable **`QUALITY_REPORT_BUNDLE_SHA256`** to the candidate manifest's **bundleDigest**. This is a non-secret fingerprint, not an API credential. It must match every uploaded vendor asset. A dependency/UI change requires a new review. **The current Allure 3.22.1 prebuilt bundle still embeds DOMPurify 3.4.16**, despite the installed 3.4.17 override. Prefer an upstream corrected bundle; otherwise a maintainer/security owner must explicitly approve this precise bundle and its constrained input boundary under the existing security policy. Do not copy a digest merely to silence the gate. Record the exact advisory/scope, mitigation, responsible reviewer and expiry in the reviewed security decision. Also set **`QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES`** to its UTC `YYYY-MM-DD` expiry, within the next **31 days**. Expired, malformed or unbounded approvals fail closed. This bounds review lifetime even if the enablement switch is left on. No such external approval is claimed here.
6. Configure/verify Access if the report should be private (below), then set **`QUALITY_REPORT_DEPLOY_ENABLED=true`**. Automatic trusted CI completion may now publish. Manual dispatch additionally needs `publish=true`. The protected deploy job re-audits downloaded bytes, verifies the bundle approval and rechecks current main/source freshness immediately before upload. Missing/incorrect configuration fails the release check, not the underlying CI test result.

Never paste token values into YAML, command arguments, logs, screenshots, issue bodies or artifacts. Account ID is also supplied only through the environment secret. Do not echo raw environment variables or run Wrangler with debug logging in a public job.

## Deployment conditions and failure behavior

| Situation | Result |
| --- | --- |
| PR, fork, other branch/workflow, cancelled/in-progress CI | No eligible credentialed publication |
| Trusted latest main CI succeeds | Build/audit/history; deploy only if enabled/reviewed |
| Trusted latest main CI fails but has usable sanitized results | May publish its real failure diagnostics; source CI failure is shown in the report banner |
| CI failed before a usable artifact exists | Preparation fails visibly; existing Pages deployment/history artifact stays intact |
| Switch absent/false, or manual `publish=false` | Dry run only; candidate/history retained; deploy job skipped without Cloudflare credentials |
| Bundle fingerprint missing/mismatched or review expired | Upload rejected |
| GitHub/API/artifact error, privacy rejection, malformed new output | Release fails visibly; no raw provider response or token is printed |
| Cloudflare outage/authentication/upload failure | Deploy job fails; inspect Pages for ambiguous completion after a lost response; original CI/test checks are unchanged |
| New main/source run supersedes the selected one | Stale publication rejected; wait for the newer CI report |

The original **Quality gate** does not depend on this workflow. Keep its existing twelve required checks, including **Allure report** and **Quality gate**; **do not add Prepare trusted quality report / Publish quality report to Cloudflare Pages as required merge checks** if Cloudflare-independent merges are intended. No `continue-on-error` hides a publication failure. Conversely, report publication success never changes failed test exits, skipped/cancelled checks, or a failed Quality gate. The deploy job separately reruns the unchanged production/full dependency security policy before the credentialed step; a failed source test can be published only when the publisher's own security and privacy gates pass. A dependency-audit outage/finding blocks publication, while source CI results remain independent.

Release executions share a non-cancelling concurrency group to serialize history updates and uploads. GitHub does not guarantee FIFO scheduling and can replace pending runs; this is not a durable queue. Superseded/cancelled/unusable runs can leave gaps, which must remain gaps rather than fabricated observations.

## Allure 3 history and retention

`allurerc.mjs` uses `historyPath: artifacts/allure-history/history.jsonl`, `appendHistory: true`, and **historyLimit: 30**. This is Allure **3 JSONL**, one aggregate report-run record per line; no Allure 2 `history/` directory copying. See [Allure history options](https://allurereport.org/docs/v3/configure/#history-options) and [JSONL format](https://allurereport.org/docs/how-it-works-history-files/).

The release workflow restores the latest usable **quality-report-history-main** artifact from completed trusted main executions of this same release workflow. It examines workflow-specific runs, not PR-populated global artifact listings, validates their source CI provenance and verifies the ZIP's two-file inventory/checksum. At most twenty eligible prior release runs are inspected, across at most three listing pages. No PR history, arbitrary run download URL or signed storage URL is accepted as a workflow input. GitHub authorization is not forwarded to signed storage redirects.

History artifacts contain only `history.jsonl` and `manifest.json`. Their retention is **90 days**, while static candidates and ordinary report/test artifacts remain **7 days**. Configure repository/organization retention to allow those values, or adjust them explicitly to the approved maximum. Each new valid artifact carries the last thirty records, so the retained record window depends on execution frequency, not a promised number of days. There is no R2 dependency; a small bounded artifact is sufficient initially. Longer retention, immutable archives or many-repository storage would require a separately reviewed tradeoff.

| History case | Handling |
| --- | --- |
| First run / no previous artifact / expired or deleted artifact | Start with empty history; log a specific restoration category |
| Previous artifact malformed, unsafe, wrong ZIP inventory or checksum | Discard it and start empty with `malformed_artifact_discarded`; never feed unsafe text to Allure |
| Authorization/network/API failure | Fail preparation; do not mislabel an outage as an empty history |
| Bounded lookup exhausted | Explicit reset category; review the history gap rather than claiming continuity |
| Repeated CI/release run | Identity `DGI CI <CI run ID>` replaces the earlier record for that run; remove self-comparison before rendering |
| Different main CI runs on one commit | Separate records, because they are actual distinct CI executions |
| New generated history is invalid / report generation fails | Reject it; restore previous local history; do not publish the failed candidate |

Only whitelisted outcome, identity, timing and suite information survives history normalization. URLs, arbitrary metrics and attachment bodies are not retained. Unknown statuses remain unknown. Local reports use a local results fingerprint and are never deployable or restored into main's history. `allure:clean` intentionally retains local history; remove **only the generated `artifacts/allure-history/` directory** for an explicit local history reset. Repository/CI histories are not committed.

CI's existing unit/integration/coverage jobs represent separate real executions. Their scopes/history IDs remain distinct; the aggregate is execution counts, not unique test counts or a flakiness denominator. Partial/changed suite composition must be considered when comparing totals. Re-running failed CI jobs uses latest available per-job artifacts from that same CI run; artifact overwrite now avoids name collisions and history replaces the same CI-run record. No historical flakiness rate is claimed before comparable main-run samples exist.

## Strict publication privacy boundary

The publication path is **`artifacts/allure-publish/`**, never the repository, raw test results, logs, coverage, native test artifacts or application dist directories. `quality-report/wrangler.jsonc` fixes this Pages output; the uploader uses an explicit directory/project/branch and a separate cwd so it cannot discover application `.env` or Functions. No deployment URL is added to README until an actual upload has been confirmed.

Before generation, publication input checks synthetic dataset attestation, source SHA/CI run/branch/category, expected JSON keys, measured statuses and sanitized error shape. It removes **all test screenshots, traces and other attachments**, including previously admitted synthetic binary diagnostics: public publishing has a narrower boundary than separate CI debugging. GitHub diagnostic visibility follows the repository/artifact access rules; it is not made private by this workflow. Failure classifications/relative test source locations remain inspectable. Data entry records, addresses, exact coordinates, prompts/completions, raw headers, database commands and unredacted provider payloads are not publication inputs.

After generation, only known Allure data/history/widget JSON, protected index HTML and **byte-identical assets from the installed locked Allure archive** are allowed. Unknown files, `.env`, logs, source maps, Worker/Functions code, symlinks, modified assets and credential/address/URL/HTML patterns fail closed. Generated script bootstrap is allowlisted; CSP hashes must match exactly. Allure analytics is removed. Every allowed byte is recorded in a checksum manifest, and the deploy job repeats the checks after artifact download. Manifest checksums detect accidental changes; they are not a sandbox against a malicious trusted maintainer who can change code, policy and secrets.

Static `_headers` adds no-store/noindex, no-referrer, nosniff and frame protection. These are defense in depth; **noindex is not authentication**. Text matching cannot prove arbitrary free text contains no personal data. Synthetic-only test fixtures, guarded ephemeral databases, reviewed main code and absence of real provider credentials remain prerequisites. Adding a new provider/fixture/attachment/schema requires privacy regression coverage. Review the candidate and security limitations before enablement.

The known prebuilt DOMPurify limitation is not silently patched or waived. A clean npm audit does not analyze vendor JavaScript embedded in archives. The explicit bundle review plus protected environment is a release gate, not proof of an upstream fix. The compatible **undici 7.30.1** override separately fixes the actual high advisory introduced/exposed in Wrangler/OpenAI's dependency tree; it does not purport to fix the prebuilt Allure bundle.

Wrangler stdout/stderr is captured in a bounded buffer, never uploaded or printed verbatim. Only a controlled exit category and, after successful upload, a Pages URL are logged; credential values are excluded. Authentication/configuration details belong in private Cloudflare administration, not public artifacts.

## Cloudflare Access

Assume the production hostname, branch aliases and immutable deployment URLs are publicly reachable until verified otherwise. Enabling the Pages preview Access policy alone does **not** protect the production Pages hostname/custom domain. Follow [preview Access](https://developers.cloudflare.com/pages/configuration/preview-deployments/) and [production/custom-domain Access requirements](https://developers.cloudflare.com/pages/platform/known-issues/#enable-access-on-your-pagesdev-domain): create distinct coverage for the production Pages hostname and wildcard preview hostnames, and a self-hosted Access application/policy for any custom domain. Allow only intended identities/groups and remove broad bypass rules. This is administrator configuration and needs no extra CI token permission.

Verify unauthenticated browsers and direct requests cannot read `index.html`, a known `data/test-results/*.json`, history data or assets from **every** relevant hostname, including immutable deployment URLs; verify an approved identity can use the UI. Test custom-domain and direct Pages-host access separately. Do not treat a working login page on one alias as proof that other routes/hosts are protected. Recheck after domain/deployment changes. No Access policy or successful authenticated/unauthenticated test is claimed by this implementation.

## Local verification and debugging

```sh
nvm use
npm ci
npx playwright install --only-shell chromium
npm run quality:check
npm run security:check
npm run test:e2e
npm run allure:generate
npm run allure:publish:prepare  # local dry-run candidate; never credentialed upload
npm run allure:publish:check
npm run allure:verify          # three real adapters, intentional failures, public audit and JSONL replay
```

These tests use isolated synthetic MongoDB and injected/offline providers. Follow [E2E isolation](e2e-testing.md) for the disposable service alternative. The local publication candidate is deliberately marked `local-dry-run`; spoofing CI env is not a supported local deployment path. `npm run allure:publish:deploy` without the trusted runtime, enablement, reviewed bundle and environment secrets must exit nonzero before Cloudflare access.

Validate both workflows with actionlint. Inspect `artifacts/publication-manifest.json`, `allure-history/history.jsonl`, and the static candidate; use a loopback static server for visual/browser checks. `npm run allure:open` views the generated report. Deployment paths and credentials are intentionally absent from npm application build commands.

Troubleshooting categories:

- `report_source_untrusted` / `report_source_superseded` / `report_publisher_superseded`: select the latest completed eligible current-main CI run, and execute the release workflow from current main. Old arbitrary run IDs cannot be used as a rollback shortcut.
- Artifact download missing: CI may have failed before generating results or retention may have expired. Inspect the original CI checks; run fresh main CI rather than uploading development logs.
- `report_history_*` / restore reset: inspect the controlled category/checksum and history gap. Do not print the rejected JSONL or signed download URL. Network/auth errors are separate failures.
- `report_public_*` / `report_privacy_*`: an output/schema/asset changed or contains rejected data. Fix the generating fixture/projection or review a necessary schema change; do not bypass the allowlist.
- `report_deployment_disabled_or_bundle_unreviewed`: check the repository switch, protected environment, exact reviewed asset fingerprint and review expiry. Never set review values automatically from a failed job.
- `report_cloudflare_configuration_missing` / upload failed: confirm project/account/token scope/expiry and Cloudflare service status privately. Raw upload diagnostics are intentionally not echoed. A failed release is not an application test failure or a successful deployment.

## Rollback and availability

Pages deployments are atomic; failure before a deployment is committed leaves the prior report available. If a connection/response is lost after the server accepts an upload, a nonzero CLI exit alone cannot prove that no deployment occurred: inspect the Pages deployment list before retrying or rolling back. Disable `QUALITY_REPORT_DEPLOY_ENABLED` to stop future publication, then use Pages' deployment dashboard to roll back to a previously reviewed production report if needed. That operation does not rewrite CI results or JSONL history. Next successful enabled release resumes from the retained history artifact; a historical report is a snapshot, not evidence that newer failed tests passed. See [Pages rollback](https://developers.cloudflare.com/pages/configuration/rollbacks/).

Deleting a GitHub artifact or rolling back does not automatically remove previously uploaded immutable Pages URLs. For a privacy incident, immediately restrict Access and stop publishing, remove affected Pages deployments as permitted, rotate exposed credentials if any and review the relevant artifacts/retention. No destructive cloud cleanup, rollback or deployment has been performed by this milestone.

## Validation record

Actual local verification on **2026-10-24** used Node **22.23.4** / npm **10.9.0**. The original working checkout and an env-free source-only temporary copy installed successfully from the same final lockfile (**745 installed packages**). The copy contained 174 source/configuration files, no `.env` files, no personal records and no Git metadata; local commit/branch metadata consequently remains explicitly unknown there. No fake main-branch identity is assigned to this dry run.

| Check | Actual result |
| --- | --- |
| `npm ci` | Success in working checkout and clean source copy; lockfile contents identical |
| `npm run quality:check` | Passed in both contexts: lint, strict types, environment-free build, **165 backend**, **134 frontend** (18 files), **39/39 offline AI**, unchanged coverage floors |
| `npm run test:e2e` in clean source copy | **9/9** passed, zero retries/skips, Playwright reported **6.2 s** |
| Release/history/privacy regressions | **14/14** passed, including PR/PR-target/fork/ref/event/switch/review-expiry denial, signed-URL auth isolation, corrupt/expired history, nested/root attachments, root/child symlinks and upload exit preservation |
| `npm run allure:verify` in clean copy | All three actual adapters preserved pass/fail/skip; each intentional failure returned exit **1**. Failed-result HTML and strict public audit passed; seeded JSONL round trip reached 2 records and stayed at 2 on replay |
| `allure:generate`, `allure:publish:prepare`, `allure:publish:check` | Actual complete static report from **308 test executions**; candidate marked **local-dry-run**, **0 public test attachments**; replaying identical input did not duplicate its history record |
| Candidate Chromium check | Rendered with **0 external requests / 0 browser errors** |
| `npm run allure:publish:deploy` locally | Expected exit **1**, `report_deployment_disabled_or_bundle_unreviewed`, before any credentialed Cloudflare request |
| `npm run security:check` | Production and full-tree npm audits each reported **0 vulnerabilities**; legacy prebuilt UI review remains required |
| actionlint 1.7.12 / whitespace diff checks | Both workflow schemas/expressions and diff checks passed |

Backend **165** is the previous 151 plus fourteen infrastructure regressions, retaining all 41 real-driver MongoDB integration cases. Coverage statement/branch/function/line percentages remained **94.43/92.12/96.93/94.43** backend and **89.34/84.66/87.95/92.30** frontend. No production scope/floor was weakened. The authenticated, no-volume synthetic MongoDB container was stopped/removed after verification. Wrangler CLI help confirmed the actual Direct Upload arguments; no real upload was used as a supposed dry run.

Verification fixed an initial nested-attachment projection ordering error and extended the JSON allowlist for Allure's actual `data/history/` output. The synthetic probe is scoped to its own temporary Vitest root. The original synchronized working directory also experienced slow module loading and pre-test startup timeouts; the identical source/lockfile passed clean-copy verification without extending test/server limits or suppressing assertions. Those original startup failures are not claimed as passing E2E executions, nor as application assertion failures. They remain a local-environment reproducibility caveat.

GitHub/Cloudflare-side validation is **not performed**: no workflow publication, environment/secrets/variable change, project creation, Access activation or actual Pages deployment is claimed. The connected GitHub read endpoint did not support environment-setting inspection. Complete the documented protected environment, scoped secrets, explicit review/expiry and enablement steps on main, then inspect an actual hosted run/deployment before adding a live URL. The prebuilt DOMPurify finding is still explicit and has no automatic approval. Workflow YAML/local tests cannot establish these external settings.

## Interrupted-session recovery (2026-10-24)

The resumed local checkout was clean at `5934f81`; the pushed feature checkpoint was `313296e`, with an identical source tree (the difference is merge ancestry). Remote main was `dcb5863`. PR #3 was closed and unmerged. [CI run 40116451847](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/40116451847) had ten successful checks, failed **E2E smoke (Chromium)** and failed **Quality gate**. Its Allure job produced a partial report of 598 real executions. The application smoke step had **not run**: the preceding reporting probe failed. Those results do not establish a Playwright application regression.

The privacy failure was reproduced with working Git discovery. Allure 3.22.1's local CI detector derives `index.html` bootstrap **`$.ci.repository.url`** from Git remote even when no GitHub environment variables are forwarded. The root `summary.json` separately derives **`$.commitHref`**. Both are external links correctly rejected by the existing public-text policy. Earlier environment-free verification without usable Git metadata did not exercise this branch.

`protectReport()` now projects out only the bootstrap's generated `ci` context and the summary's generated `commitHref` / `pullRequestHref` / `jobHref` fields. Explicit DGI run/SHA/layer/runtime metadata, statuses, failure classifications and timing remain intact. All other fields still pass the unchanged strict URL/credential/address/coordinate checks. Inline CSP hashes are recomputed after projection; immutable vendor bytes remain unchanged. This is a narrow projection, not a general external-URL exception.

`allure:verify` now creates an isolated Git repository with a synthetic GitHub remote, asserts that the **actual Allure-generated** HTML and summary contain these link fields before projection, then verifies their removal, publication audit and Chromium CSP rendering. No Git remote is contacted. The nine probe outcomes (three intentional failures) remain temporary and separate from real DGI results; each failed adapter must still exit 1. Failure diagnostics expose only controlled categories, allowlisted report filenames and schema paths, never rejected text or raw local-path stacks.

Five additional native regressions cover the safe bootstrap projection versus unsafe payloads, diagnostic privacy, corrupt history checksums/PR source history, missing current reports/provenance mismatch, and all nineteen success/failure/skipped/cancelled gate combinations. Restored history metadata must also exactly match the API-verified source execution. A new gate-probe issue exposed under c8 was fixed by using explicit stage names and fresh child environment objects: Node may add `NODE_V8_COVERAGE` to a supplied spawn environment; it is not a CI stage. No quality threshold or workflow failure condition was changed.

Completion states must be recorded separately: local implementation/tests, fresh feature CI, trusted main release (with deployment disabled), and actual Cloudflare upload. Main-only release/history retention and environment-secret placement cannot be established by local tests or a successful feature-branch CI run. No main merge, deployment enablement, bundle approval or Access activation is authorized by these recovery changes. The prebuilt DOMPurify warning and review/expiry controls above still apply.

Recovery local validation used Node 22.23.4 / npm 10.9.0 and an environment-free source copy with working Git metadata. `npm ci` installed 745 packages and audited 748 with no vulnerabilities; lockfile bytes were unchanged. `quality:check` passed lint/typechecks/build, **170 backend tests**, **134 frontend tests**, **39 offline AI evaluations** and unchanged coverage floors. Separate public unit/integration/frontend commands passed **129**, **41**, **134** tests. The real Chromium smoke suite passed **9/9 in 5.8 s**, with no retries/skips. Both npm security audits and actionlint passed. The **19** release/history/privacy tests include five new cases. A complete audited dry-run report contains **617 actual executions** (coverage and independent script checks are separate executions, not 617 unique cases); it has zero public test attachments. `allure:verify` separately passed with nine temporary probe outcomes, three intentional failures, two replay-deduplicated history records, zero external browser requests and zero browser errors. The first coverage run failed in the newly added gate probe because of its reused spawn environment; the corrected full rerun passed. No application test, privacy rule or source coverage threshold was suppressed.

## Files changed

| Area | Files |
| --- | --- |
| Workflows | `.github/workflows/quality-report.yml`, `.github/workflows/ci.yml` |
| Locked tooling/configuration | `package.json`, `package-lock.json`, `allurerc.mjs`, `.gitignore`, `quality-report/wrangler.jsonc` |
| History, trusted artifact access and publication | `scripts/allure/history.mjs`, `github.mjs`, `publication.mjs`, `release.mjs`, `upload.mjs` |
| Existing report integration and probes | `scripts/allure/report.mjs`, `results.mjs`, `site.mjs`, `verify.mjs` |
| Regression coverage | `backend/test/reportRelease.test.mjs` |
| Documentation | `README.md`, `docs/cloudflare-allure-deployment.md`, `docs/allure-reporting.md`, `docs/ci.md`, `docs/quality-engineering.md` |
