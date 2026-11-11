# P09: published CLU in Dashboard and Data & Settings

## Scope and artifact

Prepared on 2026-11-10 (America/Los_Angeles) in `Shaobangzhu/delivery-geo-intelligence`, branch `feat/dgi-clu-dashboard-settings`. The clean existing branch matched freshly fetched `origin/main` at `1a925eacbb1b2eac88aaddb04630a0e64ba3acf3`, rather than the earlier audit reference `077ae13`. The remote default branch is `main`. No commit, push, PR creation, merge, deployment or CLU repository mutation was performed.

The frontend now pins **`@shaobangzhu/clu-ui@0.1.0-rc.2`**, installed from the public npm registry using Node **22.23.4** / npm **10.9.0**. Baseline DGI had no CLU dependency. The root lockfile adds only that frontend dependency and the one registry package entry; existing package versions, resolutions, hashes and platform restrictions remain unchanged.

The [GitHub prerelease](https://github.com/Shaobangzhu/react-clu-component-lib/releases/tag/v0.1.0-rc.2), [publication record](https://github.com/Shaobangzhu/react-clu-component-lib/blob/5328c8db5ff9394169c842ec43b63b40d24c11ce/docs/rc2-publication.md) and [source synchronization audit](https://github.com/Shaobangzhu/react-clu-component-lib/blob/5328c8db5ff9394169c842ec43b63b40d24c11ce/docs/npm-github-sync.md) were reviewed read-only. CLU master was `5328c8d`; the release tag targets `c8a1978`. The immutable artifact consumed here is the exact npm version and integrity, not a mutable dist-tag or GitHub source archive. No source checkout was repacked or substituted.

An independent download of the registry archive measured 16,944 bytes and matched `dist.integrity` and the DGI lockfile:

```text
sha512-hUiMBqXdzu6OUtRZoLN8PqV3ekp2yAz3y5QCtgo4KzYmKYJSWCI+cjuZf0ciyhzcWEpF2I3uhvq+VtigDX7doA==
```

The package exposes ESM/types at its root and compiled CSS at `@shaobangzhu/clu-ui/styles.css`. React `^19` is its only peer; no runtime dependency or direct consumer Tailwind requirement was added. DGI retains one shared React/ReactDOM **19.3.0** installation. Native ESM/SSR and all 19 component / 27 type exports also passed separate TypeScript **7.0.2** Bundler and NodeNext checks with `skipLibCheck=false`. Existing application compiler configurations were not changed.

## Presentation and compatibility decisions

- Dashboard uses packaged `Card`, `Alert`, `Button` and semantic `Table` components. Settings uses `Card`, `Button`, native `Select`, `Badge`, `Alert` and `Table.ScrollArea`/`Table`. The CSS export is imported exactly once in `frontend/src/main.tsx`.
- Explicit light-theme hosts exist only on the Dashboard and Settings roots. `clu-theme.css` preserves DGI's blue accent using scoped consumer tokens. There is no new html/body theme, reset or Preflight. Legacy analyst button styles were removed from migrated controls; the original focus rules still apply to local controls. Card content-wrapper layout is handled locally.
- Time/metric/category controls remain native button groups with `aria-pressed`. The Year select, special All behavior, fetch parameters, independent state, pending/inert behavior and out-of-order response handling are unchanged. RC.2 `SegmentedControl` uses radios/fieldset and cannot preserve this contract.
- Top Merchants retains `PAGE_SIZE=10`, `pageRange`, absolute ranks, sample counts and DGI's noun-aware paginator. RC.2 `Pagination` fixes its summary noun to `items` and uses a different page window; a separately versioned CLU enhancement would need configurable summary content and a compatible page-window policy. No replacement was forced.
- Summary value test IDs remain on the exact native `strong` nodes. CLU `StatCard` exposes no prop for its internal value node, so `Card` plus DGI-owned markup preserves the contract. A separately versioned value-slot/value-props API could address this.
- Settings retains all eight native articles, the real table/caption, row headers and the keyboard-scrollable `Provider request metrics` region. Domain-owned badge text preserves `Stale`, `Not Yet Verified`, `Unavailable`, unknown configuration and zero-denominator wording; RC.2 `StatusIndicator` cannot supply the exact labels/stale prefix. A future custom-label API would be a separate CLU change.
- Ask DGI changes only button/alert markup. Submission type, refs, focus return, retained draft, 1,000-character limit, busy/disabled state, cancellation, safe errors and provider-call policy are preserved.
- Nontrivial charts, efficiency/settlement views and map layers remain local. No router, data hook, map initialization/controller, telemetry store, AI request implementation, backend, workflow, Vite allowlist, `.nvmrc`, analytics/privacy contract or credential file was changed.

## Executed verification

Baseline: `npm ci` restored an incomplete local installation without changing the original lockfile, then **254 frontend tests / 23 files passed**. The first pre-install attempt could not start because `adm-zip` was missing; it was not an application assertion failure. Synthetic 1280px and 390px screenshots and DOM/ARIA inventories were captured before implementation.

Final results use the required Node/npm toolchain and a clean root `npm ci`. The existing guarded MongoMemoryServer harness used MongoDB **7.0.24**, ephemeral loopback ports/storage and synthetic records; no application database or live provider credentials were used.

| Command/check | Final result |
| --- | --- |
| `npm ci` | PASS; modified lockfile byte-for-byte unchanged |
| `npm ls @shaobangzhu/clu-ui -w frontend`; `npm ls react react-dom` | Exact RC.2, shared React/ReactDOM 19.3.0 |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS, frontend/backend/E2E |
| `npm run build:quality` | PASS; existing Vite large-chunk advisory remains |
| `npm run test:frontend` | 256 tests / 24 files PASS |
| `npm run test:coverage` | 244 backend and 256 frontend tests PASS |
| `npm run coverage:check` | PASS, all original floors unchanged |
| `npm run eval:ai` | 40/40 PASS, zero real provider calls |
| `npm run security:check` | PASS; production zero vulnerabilities, full tree 1 low / 14 moderate, no high/critical |
| `npm run test:e2e` | 20 Chromium tests PASS, zero retries/skips; six new integration cases |
| Published ESM/SSR and strict Bundler/NodeNext declarations | PASS, one shared React, no peer bypass |
| Synthetic desktop/390px capture | Four before and four after screenshots reviewed; no page overflow |
| Manual in-app browser | Offline analyst focus/Escape, category/metric changes, Settings navigation/status and native keyboard 24h selection verified |
| PR-head hosted `Quality gate` | NOT RUN: local changes are uncommitted/unpushed; must pass before merge |
| Live ArcGIS/Calcite cold start | NOT RUN: no explicit live-credential authorization used |

Coverage (statements / branches / functions / lines): frontend **91.45 / 87.67 / 90.90 / 94.11%**; backend **94.79 / 93.07 / 96.96 / 94.79%**. Original floors remain frontend 89.08 / 84.33 / 87.38 / 92.00% and backend 93.71 / 90.86 / 95.86 / 93.71%.

New assertions cover the exact package/integrity and single CSS import, component rendering on both routes, numeric-node test IDs, unchanged filter roles, retained articles, unknown/stale evidence, submit/busy/draft/ref behavior, ten-row page navigation without a fetch, single map view across filters, keyboard scroll/focus, representative button contrast and compiled CSS isolation inside/outside theme roots. Existing stale/out-of-order responses, provider-call accounting, map failures and AI abort/error tests remain active. Initial new test harness query/type and CommonJS resolver errors were corrected before the final passing runs; their logs remain available locally.

## Browser evidence, differences and limits

Only synthetic fixtures were captured. Local evidence is under ignored `reports/p09/before/` and `reports/p09/after/` (`dashboard-1280`, `dashboard-390`, `settings-1280`, `settings-390`, PNG and JSON inventories). Gate logs and the final ledger are under ignored `reports/p09/`. These are review evidence, not newly accepted visual golden baselines. No screenshots, traces, raw Allure output or private data were committed/uploaded. Existing Allure projection, redaction and attachment policies were retained; the adapters audited the passing frontend, coverage and E2E batches.

The before/after filter ARIA inventories and focused analyst control are identical at both widths. Settings retains eight articles and the same caption/region/column/row-header semantics. Dashboard's ranking table now has the accessible name `Top Merchants by Deliveries`. Cards gain CLU's nonsemantic content div; error/warning surfaces become CLU divs while preserving their alert/status policy and wording. The visible changes are card spacing/line height, roomier table rows/caption, bordered status badges and a stronger blue CLU focus ring. Both routes remain within the viewport; wide metrics remain horizontally scrollable. Synthetic settlement IDs, observation timestamps and measured local MongoDB latency vary between captures and are not UI regressions.

The E2E browser loads actual ArcGIS theme CSS but uses the existing offline SDK adapter, not WebGL/basemap/provider connectivity. The independent iframe probe compares real published CLU CSS against native controls and synthetic `.esri-widget`/`.calcite-button` host sentinels inside and outside theme hosts; it does not certify the actual Calcite component runtime. Existing Vite asset tests passed both ordinary workspace access and SDK-only exceptions, including Calcite CSS/font 200s before importer analysis and forbidden-file 403s. No allowlist or cold-start implementation was changed. A manual real ArcGIS cached cold start with authorized local credentials remains outstanding and must avoid private coordinates, records, keys and screenshots/logs containing them.

At the baseline SHA, the hosted [aggregate Quality gate passed](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/42917926331/job/130187592510). Its separate [Cloudflare report publication failed](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/42918689861/job/130188280968); that is pre-existing deployment evidence, not a P09 PR-head result. No workflow, publication policy, security approval or deployment configuration was changed. An approved push/PR is still required to obtain the new exact-head gate.

## PR metadata and rollback

Changed files:

- Dependency: `frontend/package.json`, root `package-lock.json`.
- Entry/theme: `frontend/src/main.tsx`, `frontend/src/clu-theme.css`.
- Presentation: `frontend/src/pages/Dashboard.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/dashboard/AskDgi.tsx`, `frontend/src/dashboard/dashboard.css`, `frontend/src/settings/settings.css`.
- Verification: `frontend/src/pages/Dashboard.test.tsx`, `frontend/src/settings/Settings.test.tsx`, `frontend/src/dashboard/AskDgi.test.tsx`, `frontend/src/test/cluPackage.test.ts`, `e2e/clu-integration.spec.ts`.
- Record and PR draft: this document.

Suggested commit: `feat(ui): adopt pinned CLU UI components in dashboard and settings`

PR title: `feat(ui): integrate published CLU UI into Dashboard and Settings`

Suggested PR body:

> Consume the exact public `@shaobangzhu/clu-ui@0.1.0-rc.2` artifact, with its registry integrity in the root lockfile and one explicit scoped CSS import. Migrate Dashboard/Settings cards, buttons, alerts, provider badges/select and semantic tables while preserving filters, ten-row merchant pagination, value-node test IDs, provider evidence, map lifecycle and AI behavior.
>
> Retain local button groups, the noun-aware paginator, domain status labels and summary value markup where RC.2 cannot preserve DGI's public/accessibility contracts. Backend, GIS/AI controllers, workflows, privacy and quality policies are unchanged.
>
> Verified locally on Node 22.23.4/npm 10.9.0: clean install; lint/types/quality build; 256 frontend and 244 backend tests; unchanged coverage floors; 40/40 offline AI scenarios; security gate; 20 isolated Chromium E2E cases; synthetic desktop/390px and manual offline browser review. Full audit retains 1 low/14 moderate development findings, with production zero and no high/critical findings.
>
> Merge prerequisites: exact PR-head hosted Quality gate; real ArcGIS/Calcite cold-start review with explicit credential authorization if live acceptance is required. Local offline SDK/CSS sentinel checks do not establish live provider compatibility.
>
> Rollback: revert this frontend integration and restore both package manifests/lockfile to the previous committed state, then run `npm ci`. The baseline has no CLU dependency, so rollback removes RC.2 rather than selecting an invented previous CLU version. No backend/data migration or registry mutation is required.
