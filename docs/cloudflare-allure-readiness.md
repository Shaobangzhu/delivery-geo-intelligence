# Cloudflare Allure deployment readiness

This is the historical pre-deployment audit. The owner's later bundle approval and the first successful production upload on 2026-11-01 are recorded in the [security decision](allure-bundle-security-review.md) and [deployment guide](cloudflare-allure-deployment.md). The NO-GO conclusion below describes the state at the time of this audit.

**Review begun 2026-10-31, completed 2026-11-01 (America/Los_Angeles): NO-GO for production publishing.** Implementation and local validation are separate from approval and an actual Cloudflare upload. No deployment, project creation, credential change, repository-variable change or protection-rule change was performed. External configuration observations below were made on October 31; they are not a continuously monitored state.

## Verified repository and hosted evidence

Reviewed main SHA: `120d09ffe967367d1e59469f2b8aa44b974539f3`. Remediation branch: `chore/allure-deployment-readiness`.

- Latest trusted-main [CI run 40213201388](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/40213201388): push, completed successfully, all **12 checks successful**.
- Latest [release run 40213475779](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/40213475779): preparation succeeded, source CI revalidated, **2 prior history entries restored**, **653 real test executions**, `partial=false`; publication audit passed. The Cloudflare job was **skipped**, with publication disabled. These are historical hosted results, not proof that today's dependency audit still passes.
- The remote main ref still matched that SHA at review. The release rebuilt HTML from actual CI outcomes; it did not rerun application tests. Counts include overlapping test/coverage executions, not 653 unique tests.

| Required boundary | Implementation / verification |
| --- | --- |
| Trusted source only | `github.mjs`: exact repository/head repository, CI workflow path, main branch, push/manual event, completed success/failure; current main SHA and latest eligible completed CI ID. `release.mjs` also binds the publisher SHA and rechecks freshness before upload. |
| Stale/PR/fork/cancelled/other source rejected | Injected `reportRelease.test.mjs` source cases cover these rejection paths and superseded commits/run IDs. Cancelled or in-progress sources are not eligible. |
| Real failures remain blocking | CI uses ordinary failing steps/pipefail and an always-running aggregate gate requiring every dependency to succeed. Release does not affect that gate. Reporting tests execute the actual gate expression for failure, skipped and cancelled stages. |
| No duplicate application test execution in release | Preparation calls source/restore/build only. Allure regeneration is not a test rerun. |
| Audited static assets only | `publicInput`, `stagePublication`, `verifyPublication`, then locked Wrangler with explicit `artifacts/allure-publish/`, project `dgi-quality-report`, branch `main`, dedicated `quality-report/` cwd. |
| Privacy and attachment exclusion | Schema/text/provenance checks, sanitized failure categories, all public attachments removed, exact file inventory/vendor hashes, CSP, no raw upload output. Synthetic privacy regressions exercise rejected inputs. |
| Bounded trusted history | 30 JSONL records; deduplication by source CI run; checksum/source-checked prior release artifacts; 90-day retention. Missing/expired first run resets safely, malformed content is discarded, API failures stay failures. |
| Credential separation | No Cloudflare secret references in CI or release preparation. Both references are confined to the deploy step in `quality-report-production`. PRs cannot use that main-only environment under the observed configuration. |
| Bundle review | Exact candidate digest plus valid, unexpired, at-most-31-day review required. Missing/invalid values deny deployment. No approval inferred from npm audit. |
| Fail closed | Switch absent means skipped deployment. Enabled but missing review/context/source/credentials rejects before Wrangler. A valid local preview remains `local-dry-run` and cannot deploy. |

The review did not establish a new trust-boundary defect requiring a workflow rewrite. Existing tests already cover these contracts. Remote protection settings remain an administrative control; trusted maintainers able to change main/settings are outside the untrusted-artifact threat model.

## Confirmed findings and minimal remediation

1. **High dependency vulnerability blocked the existing security gate.** A fresh install/audit found `follow-redirects@1.16.1`, via Allure's Axios dependencies and `mongodb-memory-server-core`. [GHSA-mrwp-f3q8-3g9p](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p) affects 1.16.0–1.16.1 and is patched in **1.16.2**: a cross-realm `sensitiveHeaders` array can lose its redaction semantics across redirects. The lockfile changes only that package's version, tarball URL and integrity. Existing `^1.16.0` ranges accept it; no new override, framework change or policy exception is needed. Unrelated npm-generated platform metadata churn was discarded.
2. **The prebuilt Allure UI remains unpatched.** No newer published Allure release was available. The installed override does not change embedded DOMPurify 3.4.16. The exact assets, advisories, mitigations, pending reviewer and expiry fields are in the [security review record](allure-bundle-security-review.md). Approval is **PENDING HUMAN APPROVAL**, not granted by this audit.
3. **Production readiness configuration is incomplete.** The expected project was absent from the viewed Cloudflare account, repository variables are absent, and required environment review is not enabled. No configuration was changed to make a gate pass.

The remaining **18 moderate dependency-tree findings** are the `minimatch` advisory and its affected ancestors, not 18 independent root vulnerabilities. [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) concerns glob-pattern amplification, with a published fix in 11.0.1. The tree uses several older major versions, including consumers relying on older APIs. Do not apply a blanket major-version override or `npm audit fix --force` (which proposes breaking Allure/ESLint changes). Track a separately tested consumer upgrade. They remain visible under the unchanged high/critical blocking policy; this is not a claim of zero vulnerabilities. The installed package audit cannot see the embedded browser finding above.

## Observed configuration and owner actions

The following was read from authenticated GitHub/Cloudflare UI, without opening secret values or modifying settings:

| Item | Observed state | Before production |
| --- | --- | --- |
| GitHub environment `quality-report-production` | Exists; both expected environment secret **names** present | Retain existing secrets; values, scope and expiry were not inspected or validated by an upload |
| Environment branch/tag restriction | 1 allowed branch: `main`; 0 tags | Retain |
| Required reviewers | Unchecked | Owner enables a designated reviewer and prevents self-review where applicable |
| Administrator bypass | Allowed | Owner disables bypass where supported, consistent with the documented protection policy |
| `QUALITY_REPORT_DEPLOY_ENABLED` | Repository has no variables | Leave absent/false until approval; enable only in a later authorized deployment phase |
| `QUALITY_REPORT_BUNDLE_SHA256` | Absent | Set only after explicit human review of the exact candidate digest |
| `QUALITY_REPORT_BUNDLE_REVIEW_EXPIRES` | Absent | Set only to the approved UTC date, within the gate's 31-day window |
| Pages `dgi-quality-report` | Not present in the account's unfiltered Workers & Pages list | Owner confirms the intended account and creates exactly this Direct Upload project, production branch `main` |
| Cloudflare Access / actual upload | Not verified / not executed | Verify production and preview host coverage separately if the site must be private |

The visible Cloudflare account cannot be compared to the encrypted GitHub account-ID secret without accessing that value; no such comparison was attempted. Confirm the intended account owner-side. The absence observation applies to the viewed account, not every possible Cloudflare account.

Owner-side project verification/creation (separate from publishing):

1. Open Cloudflare → intended account → Workers & Pages. Search for the exact project name and inspect its production branch and Direct Upload configuration if present. Do not reuse another project's report site.
2. From a trusted local administrative session, after `npm ci`, use the locked CLI in the dedicated directory. Keep credentials in the authorized session; never paste them into logs or command history:

   ```sh
   cd quality-report
   ../node_modules/.bin/wrangler pages project list
   # Only if confirmed absent in the intended account:
   ../node_modules/.bin/wrangler pages project create dgi-quality-report --production-branch main
   ```

   These are owner actions, not commands executed in this review. No build command, app dist, Functions or Git integration is needed. If a Direct Upload project's production branch is wrong, use Cloudflare's [Update Project guidance](https://developers.cloudflare.com/pages/configuration/branch-build-controls/); do not silently deploy a preview and call it production.
3. Verify the existing token's intended-account scope and **Account → Cloudflare Pages → Edit** permission in private administration. No DNS, R2, KV or Access administration permission is required by this uploader. Do not recreate or move the confirmed GitHub secrets. See the [Direct Upload CI guide](https://developers.cloudflare.com/pages/how-to/use-direct-upload-with-continuous-integration/).
4. Complete the pending security decision and environment review controls. Keep the three values as **repository variables**, distinct from the two environment secrets. Preserve the current required CI checks; do not make Cloudflare availability a required merge check.
5. After a separate authorization to publish, use a **fresh current-main CI run** and its audited candidate, confirm its exact fingerprint, then enable publication. Keep candidate retention at 7 days and history at 90 days within repository limits. Expired artifacts require fresh CI, not reuse of local reports. This milestone stops before that step.

For rollback, Access protection, failure categories and the full publishing procedure, see [the deployment guide](cloudflare-allure-deployment.md). No live report URL is asserted.

## Local validation

Validation uses an isolated archive of tracked repository files under `/private/tmp/dgi-deployment-readiness/repo`, with no `.env`, private exports, personal records or copied application artifacts. Node **22.23.4**, npm **10.9.0** match CI. The developer's existing dependency symlinks and running application are left untouched. Logs stay outside the publication directory. No trusted GitHub runtime was spoofed for local preparation/deployment.

Application-wide MongoDB integration, full coverage and E2E smoke are not claimed rerun by this targeted release review; the latest hosted run supplies historical evidence for those checks. The E2E **reporter** probe is real headless Chromium, not the full application E2E suite.

| Command / check | Actual result on the final lockfile |
| --- | --- |
| `npm ci` | Exit 0; 745 packages added, 748 audited, 10 seconds on this machine. Deprecation notices for existing ESLint/whatwg-encoding remain. |
| `npm run security:check` | Before patch: exit 1, 18 moderate + 1 high. After patch: exit 0; production audit 0 findings, full-tree audit 18 moderate, 0 high/critical. Original policy unchanged. |
| `npm run lint` | Exit 0 |
| `npm run typecheck` | Exit 0, including frontend/backend/E2E configuration |
| `npm run build:quality` | Exit 0; existing frontend chunk-size warning remains |
| `npm run test:backend:unit` | Exit 0; **137 passed, 0 failed, 0 skipped**; includes release/source/privacy/history/gate regressions |
| `npm run test:frontend` | Exit 0; **144 passed across 19 files** |
| `npm run allure:verify` | Exit 0; **9 actual adapter probe executions**: each layer deliberately has 1 pass, 1 fail, 1 skip and preserves child exit 1. These are not application failures and are not merged into the application candidate. Public attachments 0; history replay/deduplication leaves 2 records; browser errors/external requests 0. |
| `npm run allure:publish:prepare` | Exit 0; **281 real unit-test executions**, `partial=true`, `mode=local-dry-run`, exact bundle digest as recorded in the security review |
| `npm run allure:publish:check` | Exit 0; actual generated publication directory audited |
| Actual publication directory through `verifyStaticSite()` | Rendered in headless Chromium under CSP; 0 browser errors, 0 external requests |
| `npm run allure:publish:deploy` in an empty, non-CI environment | **Expected exit 1**, `report_deployment_disabled_or_bundle_unreviewed`; no GitHub/Cloudflare credentials supplied, no Wrangler upload invoked |
| actionlint **1.7.12** on both workflow files | Exit 0; official darwin/arm64 release checksum verified. `-shellcheck=''` used because shellcheck is not installed; this is YAML/Actions validation, not a shellcheck result. Existing native tests separately exercise the real Bash quality-gate expression. |
| Loopback-only redirect regression | `follow-redirects@1.16.2` strips a synthetic custom sensitive header supplied via a `node:vm` cross-realm array; an unrelated harmless header survives. Both temporary servers close after the assertion. |
| `git diff --check` and final lockfile comparison | Passed; tested lockfile equals delivered lockfile byte-for-byte |

The initial registry access in the restricted shell failed DNS resolution; the authorized network-enabled retry succeeded. This was a tooling connectivity issue, not a suppressed audit failure. The first `npm update follow-redirects --package-lock-only` also proposed unrelated libc metadata removals; those were discarded before the final clean install. There were no reporting, unit-test or build failures to suppress.

The final lockfile SHA-256 is `077f78522505d29942b01ff97c6f4d398cf30c8f1aabb8cc8aa6e03ba7a0c7f9`. It changes only `follow-redirects` 1.16.1 → 1.16.2. `package.json`, CI workflows, required checks, source code, tests, publication allowlists, CSP and Wrangler configuration are unchanged.

Local artifacts (not committed or uploaded):

- `/private/tmp/dgi-deployment-readiness/repo/artifacts/allure-publish/index.html`: audited local static candidate, **not deployable**.
- `/private/tmp/dgi-deployment-readiness/repo/artifacts/publication-manifest.json`: file checksums, local mode, zero public attachments, bundle digest.
- `/private/tmp/dgi-deployment-readiness/repo/artifacts/allure-verification.json`: real adapter failure/privacy/history/browser assertions.
- `/private/tmp/dgi-deployment-readiness/`: install, audit, validation and deliberate deployment-denial logs. Temporary files can disappear; this document retains the measured results.

To reproduce, use a fresh checkout without private env files, `nvm use`, npm 10.9.0, then the commands above in order. Install only Chromium headless shell with `npx playwright install --only-shell chromium` if absent. For the denial check use an environment without GitHub/Cloudflare credentials, not a spoofed Actions context. Running unit tests supplies real local report input; the `allure:verify` probes clean up their separate fixtures. On the original developer checkout, dependencies were deliberately not reinstalled while the application could be running; use `npm ci` in a fresh checkout to consume the changed lockfile.

## Release decision

**NO-GO** until the accountable human resolves the browser-bundle security decision, the intended Pages project/branch is verified, and the environment review configuration is completed. Approval variables must remain unset until that decision; enablement stays absent/false. A future approved deployment must consume fresh trusted-main artifacts and revalidate current dependency advisories and asset fingerprints. This review neither approves the vulnerable bundle nor claims a successful production deployment.
