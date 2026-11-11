# DGI CLU integration — P10 mapping and evidence

## Pre-change mapping

P10 starts from freshly fetched `origin/main` `123a6fdd93e1f42b374286c29780940074bd6d7a`, merged P09 PR #22. Its exact PR head `913b62d34b661b5654fb151130ab345ed4e7d93c` passed the [hosted aggregate Quality gate](https://github.com/Shaobangzhu/delivery-geo-intelligence/actions/runs/42928241557/job/130221810806). The existing `feat/dgi-clu-history-merchants` branch was clean and equal to main. P09 remains independently revertible; its [verification](p09-clu-integration.md) is historical evidence.

| Existing DGI element | Proposed CLU API | Contract and risk | Specific verification |
| --- | --- | --- | --- |
| Delivery History table | Table compound components, ScrollArea, MessageRow | Preserve order, row keys, 9 columns, formatting and current page; add one named scroll region | History RTL page-eight edit/create/delete/clamp and Chromium CRUD |
| Physical merchant list | Table / Button | Preserve duplicate-name identity, nonpaginated count, public/legacy addresses and 409 race | Merchants RTL and Chromium reference protection |
| Payments / Sessions tables | Table / ScrollArea | Separate 10-row pagers; platform labels, money and time formatting stay local | Prop22Payments/UberSessions/PlatformWorkflows RTL; independent pager browser case |
| Native action buttons | Button | Preserve accessible names, type, disabled/pending and data anchors | Existing CRUD and busy single-request tests |
| Text/date/number/select/notes controls | Input / Select / Textarea | Keep exact native labels, blank versus zero, datetime-local strings, step=60 and slicing | PaymentModal/platform/session-minute and DST suites |
| Settlement and delivery-link checkboxes | Retain native checkbox | Existing wrapping labels include dynamic inline content; keep checked/disabled semantics and layout | PaymentCoverage and linked-delivery tests |
| DialogFrame | Controlled Dialog with DGI focus/dismissal adapter | Initial/return focus, deleted-trigger fallback, native modal, busy/scroll/Tab/Escape and outside mouse-down | Existing RTL plus real Chromium keyboard/backdrop/busy/delete workflows |
| Merchant/payment delete state | DGI-owned state inside Dialog | Do not replace sanitized errors, informational blocked state or 409 race with generic ConfirmDialog handling | Existing 409 RTL and browser race/retry |
| Delivery/payment/session pagination | Retain DGI Pagination | RC.2 fixes summary noun to items and has a different numbered window; no hidden duplicate summaries | Independent pager and page-eight assertions; unchanged pageRange/PAGE_SIZE |
| Annual statements / domain charts and cost detail | Retain specialized local presentation | Preserve tax/source/analytics and existing caption/row-header/scroll contracts | Existing annual statement and session suites |

CLU APIs/docs were read from the published `v0.1.0-rc.2` source tag before changes. The exact pinned npm package, P09 CSS import and shared React runtime are reused; CLU source and package metadata are not changed. The mapping deliberately does not claim complete component adoption.

## Adopted inventory and checkpoints

1. **A — tables and actions:** Delivery History, physical Merchants, Prop 22 Payments and Delivery Sessions now use the real packaged Table compound components. The annual-mileage table within Sessions also uses Table; its domain calculations remain local. Four existing scroll wrappers become single named, focusable `Table.ScrollArea` regions: `Delivery records`, `Physical merchants`, `Prop 22 payments`, `Delivery sessions`. Headers, columns, row keys, text, formatting and ordering are retained. Loading/empty/error rows use `Table.MessageRow`. Actions use native CLU Button with the original accessible names and data anchors.
2. **B — form controls:** Delivery, Session, Payment, Annual Mileage, Vehicle and Merchant editors use packaged Input/Select; Payment Optional Notes uses Textarea. Filters also use Input/Select. Required-label wrappers remain DGI-owned, preserving names such as `Session Start *` and `Payment Date *`. Values, event handlers, input types, number steps, blank/zero distinctions and serialization are unchanged.
3. **C — overlays:** All DialogFrame consumers use the published controlled native Dialog, with stable initial/return focus refs and `busy`. Duplicate per-editor X buttons are removed; CLU supplies one close control. DGI retains scroll locking, its existing Tab boundary behavior and outside **mouse-down** dismissal. `closeOnBackdrop=false` is deliberate: the app handles mouse-down itself rather than changing to CLU's pointer-up gesture. Preventing the backdrop's default mouse-down action preserves restored trigger focus. A bounded row-removal observer restores a surviving primary trigger when a refreshed list removes the original row; it disconnects after removal or a subsequent intentional focus change.
4. **D — pagination compatibility:** All three independent History pagers and Dashboard Top Merchants retain the original DGI Pagination, PAGE_SIZE=10 and pageRange. Merchant lists remain nonpaginated, with `Showing N of N physical merchants`. No CSS hides a CLU summary and no duplicate paginator is rendered.

Retained APIs are intentional: native wrapping checkbox labels for settlement confirmation/delivery links; DGI Field markup for exact labels; DGI confirmation state/errors inside CLU Dialog for merchant 409 and payment/session deletion; specialized annual statement/source/tax and cost-detail presentation. CLU ConfirmDialog's generic rejected-promise message would discard domain-specific outcomes, so it is not used. A future backwards-compatible CLU `summary`/`itemLabel` and compatible page-window API could enable paginator adoption, but requires a new versioned registry release and a separate consumer change. No unpublished props or source aliases are used.

`@shaobangzhu/clu-ui@0.1.0-rc.2` and both dependency manifests/lockfile are unchanged from P09. The registry entry remains:

```text
https://registry.npmjs.org/@shaobangzhu/clu-ui/-/clu-ui-0.1.0-rc.2.tgz
sha512-hUiMBqXdzu6OUtRZoLN8PqV3ekp2yAz3y5QCtgo4KzYmKYJSWCI+cjuZf0ciyhzcWEpF2I3uhvq+VtigDX7doA==
```

There is one React/ReactDOM 19.3.0 runtime and one CSS import in main.tsx. The existing theme integration extends only to explicit light-theme History/Merchants roots; html/body and ArcGIS receive no new reset. New browser assertions also check that native dialog/control presentation stays light under a dark OS preference.

The jsdom setup adds only missing `showModal()`/`close()` methods with truthful `open` lifecycle and a queued close event. It does not mock CLU, emulate layout/inertness or claim native browser coverage. Existing RTL assertions remain in place; actual Chromium tests exercise native modal keyboard/backdrop and focus behavior.

## Verification and observed differences

Baseline: 256 frontend tests / 24 files passed, with synthetic 1280px and 390px History/Merchants route and open-dialog images plus ARIA inventories captured before changes. The first A/B regression checkpoint retained all 256 passes. Final RTL adds one integration case and extends existing assertions without changing their meaning: **257 tests / 24 files passed**.

Final verification ran with **Node 22.23.4 / npm 10.9.0**, fresh root `npm ci` and the unchanged guarded MongoMemoryServer 7.0.24 synthetic harness. No application database, live provider credentials or private records were used. A clean source projection outside the cloud-synced directory was used for the complete final run; **173 code/config files** matched the working repository byte-for-byte (SHA-256 inventory fingerprint `bf13916a039322ca9264222a61a18faeedf2aa5b437c571263e2179ab24ffa39`). The source projection has no production env files or Git checkout metadata; local report provenance is not asserted to be the later PR head.

| Command/check | Actual final result |
| --- | --- |
| `npm ci` | PASS; exact root lockfile unchanged |
| `npm run lint` | PASS, zero warnings |
| `npm run typecheck` | PASS, frontend/backend/E2E; no compiler configuration changes |
| `npm run build:quality` | PASS; existing large ArcGIS chunk advisory retained |
| `npm run test:frontend` | 257 PASS |
| `npm run test:coverage` | 244 backend + 257 frontend PASS |
| `npm run coverage:check` | All eight original floors PASS |
| `npm run eval:ai` | 40/40 PASS, zero real provider calls |
| `npm run security:check` | PASS; production zero vulnerabilities; full tree 1 low / 14 moderate, no high/critical |
| `npm run test:e2e` | 25 Chromium tests PASS, zero retries/skips, including all four existing session-minute/DST cases |
| Focused `playwright test e2e/clu-history-merchants.spec.ts --repeat-each=3 --retries=0 --reporter=line` | 15/15 PASS, zero retries |
| Synthetic route/dialog/state/footer captures | 1280px and 390px routes, native dialogs and long forms reviewed; loading/empty/error evidence retained locally |
| PR-head hosted `Quality gate` | Pending an approved push/PR; not claimed from baseline or local checks |

Coverage, statements/branches/functions/lines: frontend **91.51/87.41/91.03/94.19%**, above **89.08/84.33/87.38/92.00%**; backend **94.79/93.07/96.96/94.79%**, above **93.71/90.86/95.86/93.71%**. Floors, exclusions, reporters, retries and test isolation policies were not relaxed.

The five added Chromium cases cover both viewport widths, native Dialog type/open lifecycle, exact initial focus, Tab/Shift-Tab boundaries and interior traversal, Escape and outside mouse-down return focus, long-form scrolling/footer reachability, explicit light presentation under dark OS preference, busy non-dismissal/single save/error retry/draft retention, merchant 409 informational blocking, removed-row focus fallback and all three independent pagers with page-eight edit retention. Existing tests still exercise create-to-first-page, last-page clamp, platform backfill/offer independence, payment confirmation/settlement semantics, unknown versus zero, legacy instants, spring gaps and fall folds. Annual statement caption/row-header/named-region assertions remain active for the intentionally local annual views. Existing Dashboard/Settings map identity, CSS-isolation and provider suites also pass.

DOM/ARIA changes are limited to the four named keyboard-scroll regions, nonsemantic CLU classes/attributes, and replacing the custom div overlay/backdrop with a real native modal dialog. The close button now precedes the intro paragraph in the CLU header; confirmations also receive CLU's close control. Exact field/button names, table columns/row content and noun-aware paginator summaries remain unchanged. The native top layer supplies background inertness. Larger control text, compact table styling, bordered danger/secondary actions, stronger focus rings and rounder modal chrome are visible changes. At 390px, tall forms require vertical dialog scrolling; Save/Cancel remain reachable and are explicitly captured after scrolling. This is not a claim that all fields fit in one viewport.

Evidence is ignored local output under `reports/p10/before/`, `reports/p10/after/` and `reports/p10/clean/`. No visual golden baselines were accepted or changed. No screenshots, raw traces, env files or Allure artifacts were uploaded/published. The normal full E2E run retains its normal audited Allure batch; the focused repeat uses a line reporter and does not replace it with a partial suite. Screenshots contain only the existing synthetic fixtures and synthetic test inputs. Live ArcGIS/WebGL/basemap, live geocoding/OpenAI, non-Chromium browsers, screen-reader certification and P10 hosted CI remain unverified.

Failure/recovery record: the first native-dialog RTL attempt exposed a node-environment setup guard omission; `HTMLDialogElement` is now checked before adapting it. The first new browser run exposed backdrop default focus stealing and asynchronous row-removal focus loss; both were fixed in DGI's adapter. Its new required-label locator was also corrected to use the unchanged accessible role/name. The initial resumed verification passed all 244 backend assertions and Allure audit but stalled in c8's report-writing phase in the cloud-synced directory; that writer was stopped (exit 137), and that command is recorded as incomplete, not passed. The complete fresh run outside that directory passed unmodified coverage/reporting and every other required gate. The pause before resume was an automatic approval service credit error; no rejected command was executed or bypassed. Source files were hydrated from local iCloud placeholders before resuming. No assertion, coverage floor, API or reporting policy was changed to obtain passing results.

## PR metadata and rollback

PR title: `feat(ui): migrate History and Merchants presentation to published CLU primitives`

Suggested squash commit: `feat(ui): integrate CLU data, form and overlay primitives across history and merchants`

Suggested PR body:

> Extend the pinned public CLU RC.2 integration to History and Merchants using semantic tables, native form controls, action buttons and controlled native dialogs. Preserve page-eight editing, three independent ten-row pagers, minute/DST serialization, platform offers, Prop 22 evidence, merchant delete protection and private-data boundaries.
>
> Retain DGI's noun-aware Pagination, exact native field labels, wrapping checkboxes, specialized annual views and domain-specific delete/error state. Keep the existing outside mouse-down policy and recover focus when a refreshed list removes the original trigger. No dependency version, backend, API, analytics, ArcGIS, AI or workflow changes.
>
> Verified with fresh npm ci, lint/types/quality build, 257 frontend / 244 backend tests, unchanged coverage floors, 40/40 offline AI scenarios, security gate, 25 isolated Chromium E2E cases, 15 focused zero-retry repeats and synthetic desktop/390px route/dialog/state screenshots. Local report-generation filesystem interruption was recovered in a byte-matched clean source projection; full verification then passed. Full-tree audit retains 1 low/14 moderate development findings, with production zero and no high/critical.
>
> Required before merge: green Quality gate on the exact PR head. Public Allure publication is a separate guarded main release operation. Revert P10 independently while retaining merged P09 and the exact RC.2 lockfile.

Rollback P10 independently of P09 by reverting its presentation, theme extension, tests and DialogFrame adapter. Preserve the exact RC.2 dependency and root lockfile, then use `npm ci`. No data, schema, geocoding, API, tax calculation, AI or ArcGIS controller rollback is needed. Never republish rc.2.

PR-head hosted `Quality gate` is required before merge. Local checks do not establish that result. The Cloudflare Allure site updates only through the separately guarded trusted-main release path; a successful PR run is not a public report publication. No push, merge, npm publication or workflow/release-setting change is authorized by this migration.
