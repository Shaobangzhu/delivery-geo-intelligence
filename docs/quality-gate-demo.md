# Reproducible quality gate regression demonstration

This local exercise uses the **same `npm run test:backend:unit` command as the required CI Backend unit tests check**. It does not manufacture test result JSON or push a broken commit. No MongoDB server, paid API or real `.env` is needed.

## Run and inspect

```sh
nvm use
npm ci
npm run quality:demo
# Open any of the three sanitized HTML reports on loopback:
npx --no-install allure open reports/quality-gate-demo/regression/html --host 127.0.0.1
```

The script copies source/config/test fixtures into a disposable OS temporary directory, excludes `.env*`, generated output and numbered synchronization copies, and links installed dependency trees. Child processes receive only a small local runtime environment; ambient MongoDB/API/CI/cloud credentials are not forwarded. Unit scope uses the existing injected providers and database guard, with no integration database connection. Each phase starts with separate empty Allure results/history. The real working source is never mutated. The temporary source is restored in `finally`, then deleted; nothing is merged, committed or deployed.

`reports/quality-gate-demo/` is ignored by Git and replaced on each run. The script returns **0 only if every expected transition and actual Allure outcome is verified**; any unexpected baseline/fault/restoration/reporting outcome returns nonzero. Its outer success means the demonstration succeeded, not that the deliberately failing phase passed.

## Fault and expected detection

Inside the temporary copy only, replace the single health-probe evidence assignment in `backend/src/observability/routes.ts`:

```diff
- evidence: errorCategory ? "failure" : "success"
+ evidence: "success"
```

A failed ping would incorrectly create successful availability evidence. The test still sees a failed operation, but the provider status would say operational. This is a realistic signal-correctness regression that a purely superficial page-render test could miss.

Actual execution on **2026-10-24**, Node **22.23.4**, fresh locked dependencies:

| Phase | Actual command exit | Actual native / Allure results | Test-command duration |
| --- | ---: | --- | ---: |
| Baseline | 0 | 137 passed | 4.46 s |
| Temporary regression | 1 | 135 passed, 2 failed | 4.94 s |
| Restored source | 0 | 137 passed | 4.87 s |

Durations include the backend compile and unit command, not HTML generation; they are one-run measurements, not performance or stability claims. `summary.json` contains the current machine's measured values on rerun.

The two real failed tests are:

- `Mongo transient connectivity errors, recovery, and failing sinks remain isolated` — sanitized diagnostic points to `backend/test/reliability.test.mjs`.
- `unavailable database status is an explicit observation in a valid status contract` — points to `backend/test/observability.test.mjs`.

Each phase saves `html/index.html`, audited `results/` including `dgi-manifest.json`, and a publication manifest with **zero public attachments**. Failure details retain the assertion category and relative source location, withholding raw expected/actual values. All three reports are correctly marked partial because only backend unit tests ran. Their local dry-run provenance prevents them from serving as trusted-main deployment artifacts.

The root `*-local-only.log` files contain synthetic runner diagnostics for debugging unexpected harness failures. They are **not** copied into HTML, Allure public inputs or a deployment candidate. Never upload the entire demo folder as a public site; only the already-audited phase `html/` is intended for local viewing. Even these demonstration reports are not an authorized deployment.

## How this blocks CI and a protected PR

CI does not use `continue-on-error` for the test command. A nonzero backend command fails its matrix check. The `Quality gate` job runs with `always()` and requires the check matrix, integration, coverage, security, E2E and reporting results to all equal `success`. Native regression tests execute the workflow's actual aggregation expression and cover failed/skipped/cancelled dependencies, including a successful report alongside failed tests.

A configured GitHub ruleset requiring **Quality gate** and the documented individual checks then blocks merging that PR. A generated workflow file cannot activate this repository setting. At audit time the rulesets endpoint returned none and classic branch protection was inaccessible (403); merge blocking is therefore **conditional on setup, not claimed active**. See [required check names and protection settings](ci.md).

This exercise is a local reproduction of the blocking command, not a fabricated hosted red PR. Historical [CI run 40116451847](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/40116451847) independently shows the real E2E/reporting-probe failure propagating to Quality gate; the later [main run 40137015043](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/40137015043) passed after the prior privacy fix. The audit's new fixes have not been pushed or run on GitHub.

## Troubleshooting and repeatability

A failed baseline means investigate before presenting a fault experiment; the script refuses to call that expected failure a demonstration success. Use a fresh non-synchronized checkout and `npm ci` if module loading stalls. The audited synchronized Documents checkout timed out in the native unit runner, while the Git-exported source/new install passed. Do not increase timeouts or remove assertions merely to get a green demo.

A missing fault marker fails before running a regression against changed source. A report audit failure also fails the demonstration. First-run and repeated local reports are isolated from real CI history. Run the same command again to reproduce the sequence independently; repeated local passes alone do not establish a historical flakiness rate.
