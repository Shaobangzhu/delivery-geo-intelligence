# Code Quality interview walkthrough (6–7 minutes)

Use the [architecture and measured evidence](quality-architecture.md), [gate demo](quality-gate-demo.md) and the generated local reports. Present DGI as a single-repository engineering portfolio, not work performed for DoorDash or a production-scale service. Prepare artifacts before the interview so package downloads do not consume the walkthrough.

## 0:00–1:00 — Problem and architecture

“DGI has a React client, Express APIs, MongoDB, ArcGIS and an optional OpenAI analyst. A green page or a configured API key does not tell us whether a dependency has worked. I added bounded, sanitized observations and separated business results, provider evidence and software test health.”

Show the application/telemetry diagram. Point out that Settings reads actual backend observations and a separate browser lifecycle store; visiting it does not call a paid provider. Explain one process, 24-hour memory retention and reset on restart before discussing what the dashboard can prove.

## 1:00–2:00 — Trustworthy signal definitions

Use two concrete examples:

- A valid geocoding response with no matching location is an unsuccessful geocode but evidence that the provider responded. Mongo duplicate-key/validation errors must not become database outages.
- One analyst request can invoke a model twice. Request count, model-call count and usage samples have different denominators. Missing tokens remain null; zero samples never imply 100% success.

Show the deterministic 1..20 latency test: nearest-rank p95 is 19. Explain capacity loss, small samples and why an observed operational state is not an uptime SLO.

## 2:00–3:30 — Demonstrate an actual regression

Open the three pre-generated local Allure phase reports. Show the baseline, the erroneous “all pings establish successful evidence” assignment in the documented temporary diff, then the two failed tests and restored pass. The same backend unit quality command produced **137 pass → 135 pass / 2 fail → 137 pass**, exits **0 → 1 → 0**.

Show `reports/quality-gate-demo/summary.json` for real machine measurements and the failed-result source locations. Explain that Allure receives actual native test events; expected/actual values are deliberately withheld from the public projection. The demo creates no failed commit and never touches personal MongoDB data.

## 3:30–4:30 — Explain CI enforcement precisely

Show `.github/workflows/ci.yml`: locked Node/npm installation, independent static/test/security gates, isolated Mongo service, Chromium smoke after prerequisites, and the aggregate all-success condition. Reporting runs after failures to preserve evidence but cannot change the test's exit status. Coverage floors reflect measured baseline values, not a generic 80% rule.

Show the verified green main CI and the historical failed CI that also failed Quality gate. State the boundary: **GitHub required checks enforce merge blocking only after repository protection is configured**. The audit did not verify classic branch protection and found no returned rulesets; do not imply the local demonstration changed GitHub settings.

## 4:30–5:30 — Reporting, privacy and trends

Explain Node 22's reporter-only Allure integration, Vitest/Playwright adapters and one consolidated static HTML report. **653 report executions are repeated layer/batch executions, not unique test cases.** Coverage and dedicated unit jobs run separately; a reporter itself does not rerun tests. Startup failures can leave missing per-test results, so the batch exit and CI status remain authoritative.

Show the separate report-release flow: trusted current-main artifacts, strict public projection, no binary attachments, 30-record JSONL history, stable run identity and deduplication, then optional Cloudflare upload. First trusted-main preparation/artifact retention is verified. A real second-run history restore and actual Cloudflare deployment are still unverified; publication was skipped.

History can help identify tests that alternate failures/passes and duration changes. There is not yet enough historical evidence for a flakiness percentage. Propose tracking attempt-level first-pass results, retry outcomes, sample counts and environment changes over repeated runs. A passing retry already fails the CI smoke gate; it is diagnostic evidence, not a way to hide instability.

## 5:30–6:30 — Limits and scaling discussion

Be explicit about mocked boundaries: E2E uses real React/Express/MongoDB but an ArcGIS SDK contract adapter and injected providers. It does not verify live credentials, mapping tiles, WebGL behavior or real model accuracy. Full gate measured **178 backend tests, 144 frontend tests, 39 offline AI scenarios and 9 E2E cases**; statement coverage was **94.44% backend / 89.45% frontend**.

For multiple repositories, propose versioned reusable workflows, shared result schemas and privacy policy, ownership of failures, bounded artifact/history storage and per-repository baselines. Discuss rollout with teams: start with observable non-regression signals, define remediation owners, measure queue/wait time and first-pass rates, then ratchet gates with evidence. This is a future design, not implemented adoption or measured developer productivity improvement.

Finish with the actual remaining work: protection/environment configuration, reviewed report UI update, second-main history verification, investigation of the synchronized-checkout startup timeout and accumulating repeated execution evidence.

## Implemented versus verified

| Claim | Evidence level |
| --- | --- |
| Sanitized process-local provider telemetry and Settings resilience | Implemented and deterministic regression tested; paid providers injected. |
| Application/database integration and four-route smoke | Real local HTTP/native MongoDB/Chromium with synthetic fixtures; browser SDK mocked. |
| Blocking CI commands and aggregate failure propagation | Implemented; local tests plus recorded hosted pass/failure runs. External merge rules remain unverified. |
| Allure adapters, static HTML, publication privacy and history handling | Real adapter/HTML/browser tests; trusted-main first-run preparation verified; second hosted restore not yet verified. |
| Cloudflare hosting and Access | Guarded deployment workflow implemented; upload skipped; no confirmed URL or Access policy. |
| Flakiness improvement, delivery speedup, cross-team adoption | Not measured or implemented; no such claim is made. |

## Three evidence-based English resume bullets

- Built layered quality gates for a React/TypeScript and Express application, validating 178 backend tests, 144 frontend tests, 39 offline AI scenarios and 9 Chromium smoke tests with isolated synthetic MongoDB fixtures.
- Hardened provider telemetry with deterministic failure injection, privacy regression checks and coverage non-regression gates; measured 94.44% backend and 89.45% frontend statement coverage while preserving unknown usage and availability states.
- Integrated Node.js, Vitest and Playwright outcomes into sanitized Allure 3 reports and bounded JSONL history; demonstrated a real MongoDB health regression producing two failed tests and a nonzero quality-check exit before restoring 137 passing unit tests.

Do not replace these with invented percentages for reduced regressions, faster CI, adoption, uptime or cost savings. Re-measure counts and coverage if the repository changes before using the bullets.
