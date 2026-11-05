# AI Analyst evaluation and reliability (Prompt C)

## Baseline and scope

Starting commit: `d3e61a3` (Prompt B). The clean baseline passed 79 backend tests, 84 frontend tests, typecheck and build. The existing ArcGIS chunk-size warning was present. Prompt C preserves the Responses API, six read-only tools, frozen A.0–A.2.2 calculations, existing coordination queue and no persistent conversation history. It adds no financial formulas, tools, GIS behavior, dependencies, deployment or live API test.

## Run

```bash
npm run eval:ai
npm test
npm run typecheck
npm run build
git diff --check
```

`eval:ai` typechecks `backend/src` plus `backend/evals`, then runs the existing `tsx` loader through Node. It does not load `.env`, connect MongoDB, read private records or instantiate a live OpenAI client. It needs no credentials. Category pass/fail results come from executed assertions; an assertion failure sets a nonzero exit status. No generated report files are written. `npm test` now provisions a disposable MongoDB process for isolated integration tests, without the application Docker database or credentials. See [Quality engineering](quality-engineering.md) for binary download requirements, commands, and the current measured baseline.

## Synthetic scenarios

The original 32 scenarios use fixed synthetic sessions/deliveries, known zero payout, missing payout, incomplete vehicle costs, complete modeled costs (including negative profit), explicit strategies and a synthetic received adjustment. Existing pure financial functions supply fixture values; the harness does not introduce alternative formulas. Calendar resolution is pinned to a synthetic Los Angeles request date. Sentinel fields contain conspicuously synthetic notes, address placeholders, IDs, coordinates and injection text solely to prove projection exclusion. No real addresses or observed financial records appear in these fixtures.

| Category | Cases | Executed checks |
| --- | ---: | --- |
| Basic Analytics | 5 | Summary/category arguments, delivery-hour/session-mile units, sample/excluded counts, negative profit, strategy groups |
| Financial Semantics | 5 | Received adjustment versus guarantee, cash/work non-additivity, IRS not revenue/cost, partial versus full costs/profit |
| Period/Cohort Safety | 3 | Month/settlement scope conflict, strategy causal prose replacement, delivery/session denominator mismatch |
| Missing Data | 3 | Null adjusted rates, missing not zero, coverage confirmation/structural checks, supported History backfills |
| Privacy & Injection | 4 | Write-tool refusal before reads, aggregate projection, numeric prose bypass probes, false write claims, injected date text |
| Chinese-Language | 5 | Scripted Chinese income/unavailable/strategy/tax/backfill explanations, units/counts, conceptual null/zero and ordinary phrases |
| Failure Handling | 5 | Config/auth/rate/model/provider failures; incomplete/malformed/no final/evidence; empty results; stale IDs; shared-agent concurrency; timeout/cancellation; malformed tools |
| Cost Limits | 2 | Rounds/calls/duplicates, individual/cumulative payloads, usage fields and request statistics |

Some scenarios contain multiple independent adversarial/failure probes. The original suite has **32 named scenarios** (39 with annual and calendar extensions below), not a claim that every probe is an independently sampled real model question. Provider responses and tool plans are scripted. Tool-selection assertions verify execution of that plan, argument forwarding, allowlists and scope enforcement; they do **not** measure whether a real model would choose that plan. Chinese text is also scripted, not a language-model accuracy benchmark.

Focused backend regression tests additionally cover same-tool multiple scopes, five settlement results within the unchanged byte budget, safe HTTP envelopes, collection immutability and client disconnect propagation to the provider boundary. Frontend tests cover no automatic invocation, focus/labels, suggestions, blank input, duplicate submissions, escaped text, explicit retry, malformed successful responses, cancellation/unmount and late success/failure suppression. Narrow-layout wrapping is implemented in CSS; no automated browser viewport or manual visual assessment was performed in Prompt C.

## Grounding contract

1. Zod requires all declared tool arguments before a coordinated read. Optional dates/IDs are explicit `null`; unknown keys, invalid enum/date/ID, nested query objects and prototype keys fail.
2. The six original read-only service mappings remain; the historical annual feature adds exactly one aggregate-only read mapping (see below). There are no write, shell, filesystem, arbitrary URL or secret-reading tools.
3. A recursive aggregate projection strips unknown keys and record IDs. Retained text is domain enums, validated ISO dates or server-authored limitations/workflows. Stored notes, public/residential addresses and all destination coordinates are excluded.
4. Each successful result creates facts with an unpredictable request prefix and per-execution provenance. A stale/forged ID cannot resolve to another request's facts. Same-tool executions retain separate scopes.
5. Provider output selects facts via strict JSON `{ explanation, factIds, comparison }`. Numerical values are never supplied by that final model JSON. The server renders values, units, metric sample/excluded counts/reasons and settlement coverage/completeness metadata. Negative values and recorded zero remain distinct from unavailable.
6. Strategy selections or selected metrics spanning different scopes, accounting bases, cohorts or units require a server-enforced comparison boundary. After every selected ID resolves, the server upgrades a conflicting `comparison: "none"` to the existing limited renderer and records `comparisonAdjusted: true`. Model prose is discarded; separately scoped facts and the deterministic limitation are rendered without another provider call. No difference, causal ranking or improvement calculation is authorized.
7. Ordinary explanations still pass `validateNarrative()` and reject numeric/digit/written-number/percentage claims, including Unicode and punctuation probes, plus obvious unsupported write/comparative assertions. Prop 22 and specified conceptual phrases (for example, “unknown, not zero”) remain allowed. Two exact cautionary sentences are also permitted: “These observations cannot establish whether efficiency improved.” and “Incomplete records do not establish higher efficiency.” Added numeric clauses, unsupported claims and surrounding sentences remain subject to validation. This deliberately conservative check can still reject other legitimate phrasing; it is not a complete linguistic or semantic verifier.

Evidence/source metadata are serialized once per distinct source rather than repeated per fact, and full aggregate trees are not duplicated beside evidence. No cross-request or shared financial cache is used: separate tools still read through the existing queue, can see edits completed between reads and are not one transaction/snapshot. Labels preserve cash receipt versus coverage period and partial/current-cost assumptions. The server cannot prove that the model selected a relevant period or every useful fact for the user's question.

## Safe failure and cancellation behavior

Every HTTP error includes a generated request ID, a controlled code and a generic safe message. No SDK stack, prompt, private payload or credential is echoed.

| Status | Examples |
| --- | --- |
| 400 | Invalid question envelope/length (`invalid_question`) |
| 502 | Authentication/configuration/provider failures; incomplete/invalid response; `invalid_final_response` for malformed or schema-invalid final JSON; invalid tool arguments/name/call; forged evidence or unsupported ordinary prose |
| 503 | Missing AI configuration, provider rate limit, timeout/cancellation, failed/invalid/oversized tool result or unexpected internal failure |

An empty settlement result remains `unavailable`, with no fabricated revenue. No successful tool evidence or no valid selected IDs fails closed. There is no automatic retry. The user may submit again explicitly after an error.

The final provider JSON schema is generated from the same Zod schema used locally: strict fields, a nonblank explanation bounded to 4,000 characters and at most twelve fact IDs. Oversized or malformed mocked output is still rejected; the server does not trim IDs, salvage truncated JSON or accept unknown fields. `invalid_final_response` is distinct from `ungrounded_answer` (unresolvable/empty IDs or unsafe ordinary prose). Both preserve the generic public error. The frontend shows only a validated server UUID reference alongside that message; raw error text and provider details are discarded.

Browser close/Escape/unmount aborts fetch. Express response-close aborts the agent, whose signal is passed to `client.responses.create(..., { signal })`. Queued tool reads check the signal before DB access; the loop checks cancellation before subsequent provider/tool work. A local HTTP test verifies this chain with a mock SDK boundary. Already-running MongoDB reads and remote provider processing/billing cannot be guaranteed to stop. An older request cannot replace a newer UI answer or error.

## Limits and measurements

Prompt B limits are unchanged:

- At most 3 tool-calling rounds, 6 total executions and 4 provider requests.
- At most 1,000 generated output tokens per response and 60 seconds overall.
- At most 48,000 bytes per serialized tool output and 128,000 bytes cumulatively.
- SDK retries disabled. Duplicate call IDs rejected.

The runner reports measured min/max/total provider calls, tool executions, input/output tokens, tool bytes, local milliseconds and provider errors across all mock requests, including failing probes. Limit probes intentionally reach rejected oversized payloads; the benchmark's maximum attempted bytes is therefore allowed to exceed the accepted budget. Values are not hardcoded PASS results.

Development diagnostics preserve supplied per-response input/output/total token counts and cached/cache-write/reasoning detail fields. Missing optional fields stay absent; missing usage is not estimated. Usage totals sum available responses (including replayed input), not assumed billing totals. Model-dependent remote latency, actual model token consumption and dollar costs are **not measured** by mocks. No pricing is invented and no dollar estimate is implemented.

Development events also include the request ID, safe outcome code, failure stage, last allowlisted response status, optional `max_output_tokens`/`content_filter` incomplete reason and comparison adjustment flag. Status metadata is cleared before each invocation so previous responses cannot masquerade as the failing invocation. Tool counts include schema-valid JSON dispatch attempts; argument-schema rejection can precede the coordinated analytics read. Provider errors count thrown provider calls, not downstream grounding rejections. Aggregate usage dashboards do not retain request IDs or exact outcome codes; use the existing development event and HTTP reference to diagnose an individual failure. No prompts, responses, tool payloads, notes, coordinates or financial records are logged.

The session-question HTTP regressions use the real route, registry, deterministic analytics, projection, collector and renderer with synthetic read-only collections. They cover classification correction without retries, valid/forged IDs, schema mismatch limits, cautionary prose and adversarial extensions, partial/null/zero observations, malformed responses, provider errors, rate limits and timeout. Existing cancellation, concurrency, private projection and MongoDB immutability tests remain in place. All default tests and evaluations use mocked providers.

## Four distinct quality dimensions

| Dimension | What is established | What is not established |
| --- | --- | --- |
| Deterministic financial correctness | Existing financial regression suites plus synthetic tool projections preserve the frozen formulas and null/cohort semantics | Completeness or truth of real personal observations |
| Tool-calling correctness | Scripted exchanges validate strict arguments, forwarding, allowlists, bounded execution and read-only integration | Real model tool/argument selection accuracy |
| Narrative grounding | Current-request facts, exact rendering, structured comparison boundary and tested prose refusal rules | Complete semantic truth or resistance to every novel injection/paraphrase |
| Real model/language performance | Nothing from these mocks | Account/model access, real Chinese quality, refusal/routing rates, real token usage/latency |

Live verification is opt-in and separate from all default tests/evaluations. The bounded synthetic verification below establishes one real exchange, not general routing or narrative accuracy. Additional paraphrases, inaccessible-provider behavior and true browser/remote cancellation effects require separate evidence. Questions and selected aggregate facts are sent to OpenAI during real user submissions; the feature is not entirely local. `store: false` does not promise zero provider retention.

## Ask DGI session-efficiency fix and bounded verification

The exact question “How efficient were my delivery sessions?” exposed a model/server classification mismatch: selected session amounts, hourly/mileage rates and profit can span units or accounting bases even within one tool result. Previously a model classification of `none` caused `scope_conflict` and HTTP 502 after successful tool execution. The server now enforces the required boundary itself after validating every ID. The existing deterministic limited explanation replaces all model prose, preserving cash/work-period separation and exact backend metrics. The two confirmed negated narrative false positives receive only the narrow allowances documented above. The provider-facing final schema and backend Zod schema now share constraints; malformed output remains rejected with a distinct safe code. This follows the strict object/required-field approach in the [official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

On 2026-11-04 (Los Angeles), one explicitly authorized synthetic workflow used the configured `gpt-4.1-mini` through the production provider adapter, orchestrator, HTTP route, tool registry, analytics, projection, evidence collector and final validator. No real MongoDB connection or personal observations were used. The temporary harness and safe result are Git-ignored under `reports/`; no live command was added to package scripts. A durable attempt ledger increments before each provider invocation, SDK retries remain disabled, transport redirects are rejected and a fourth attempt is blocked. The cap and restart persistence were verified offline against a separate synthetic ledger.

The workflow consumed **two of the three authorized Responses API attempts**: one function-calling response selecting `get_session_efficiency`, followed by one completed final response. It returned **HTTP 200** with `requestId`, `answer`, `toolsUsed` and `warnings`. Every final fact ID resolved to projected evidence, usage accounting matched both provider responses, and synthetic records were unchanged. Crucially, `comparisonAdjusted: true` confirmed that the real model chose `none` for evidence requiring a boundary; the former check would have returned 502. Totals were 7,608 input tokens, 383 output tokens, one tool execution and 5,372 ms local latency, with no thrown provider errors. The remaining authorized call was not used. This does not retrospectively identify the outcome of earlier production requests or establish success for every model/data combination.

Verification passed 41 focused HTTP scenarios, 243 total backend tests, 254 frontend tests and 40 offline AI evaluation scenarios, plus lint, typechecks, builds and coverage floors via `npm run quality:check`. External HTTP was blocked throughout the quality gate. Two unrelated publication tests initially rejected this working branch's `sk-` substring as potential credential text; the successful rerun supplied `GITHUB_HEAD_REF=synthetic-ai-regression` for report metadata only. The actual branch stayed `fix/ask-dgi-ai-analyst-502`; no reporting code or privacy checks were changed.

## Historical annual integration extension

The annual extension brought the suite to **35 named synthetic scenarios** (the calendar extension below brings it to 39): the original 32 plus `annual-derived-comparison`, `annual-monthly-boundaries`, and `annual-cash-scope-isolation`. They exercise backend-generated annual differences, reported monthly zero/positive miles, NEC/non-Prop-22 boundaries, missing historical detail, safe projection and annual/cash non-additivity. The counts by category become Basic Analytics 6, Financial Semantics 6, Period/Cohort Safety 4; other categories are unchanged. No real annual source figures, tax identifiers or PDFs are fixtures. No live provider request is performed.

Seven strict tools are registered, including `get_annual_uber_summary({years, includeMonthly})`; years must be distinct/completed, at most two, and the boolean must be explicitly provided. Execution limits remain six calls, three rounds, four Responses requests and the original byte/token/time budgets. The original six mappings retain functional regression coverage. A two-year twelve-month synthetic result is verified against the unchanged per-tool byte budget.

Every annual fact identifies source year, annual/monthly reporting basis, metric definition, unit and reported/calculated origin. K/NEC have separate source identifiers. Monthly figures are grouped for compact payloads; per-fact metric definitions remain beside shared year/basis/origin source references, avoiding repeated source metadata; highest observed K month and same-definition year changes are calculated in TypeScript. Selecting only calculated annual-change evidence for one pair/execution allows a narrow **server-authored** comparison explanation. Raw-year/mixed-basis/other-tool evidence still invokes the existing boundary, and the LLM cannot supply arithmetic or numeric claims. This does not prove source completeness or model question relevance.

Focused unit/integration tests cover strict private-field rejection, cents equations, missing months/forms, explicit zeros, annual/monthly discrepancy preservation, positive miles with no trips, rates/zero baseline, private CLI semantics, identical/conflicting/concurrent imports, bounded safe GET API and unchanged existing collections. Frontend tests cover empty/annual/monthly/warning/unknown/error/retry/malformed-response/cancellation behavior alongside existing History CRUD. The native details keyboard behavior is browser-provided; jsdom verifies focusability and click expansion, not its unsupported Enter default action.

## Dashboard calendar extension

The seven-tool registry and six-call/three-round/48 KB budgets remain unchanged. Detailed tool schemas now accept `period=all` and a required nullable `year` (strict tool schemas represent unset inputs as null). Year must be 2026 through the trusted current LA year and must not conflict with `asOf`; year is null for other modes. Invalid combinations and pre-2026 detailed reference dates fail before coordinated reads. Aggregate projection already permits All and year metadata, so no new projection fields or tool are needed.

Four scripted synthetic cases bring the suite to **39**: cumulative detailed All with an explicit 2026-onward evidence range; historical detailed 2027 in a simulated 2028; official 2024/2025 questions using only the existing annual tool; and invalid/future/conflicting detailed scopes rejected before reads. Existing annual, cash/coverage, provenance, numeric grounding, privacy and budgeting checks still run. No live OpenAI request is made. These plans verify execution and scope enforcement, not real model routing accuracy; incomplete detailed backfill remains a limitation.

## Multi-platform settlement contract

Existing read-only tool names remain unchanged; `compare_delivery_platforms` is deferred. Settlement output whitelists `uber_eats`, `doordash`, or null for absent attribution, plus bounded counts/completeness flags and integrity reasons (`unknown_payment_platform`, `unknown_delivery_platform`, `unknown_session_platform`, `mixed_platform_session`). Platform is included in settlement evidence provenance so equal dates cannot collapse different platform cohorts. Unknown enum values and arbitrary reason text fail closed.

Null metrics remain unavailable in server-rendered evidence, not zero. Existing numerical grounding, comparative scope checks, provider budgets and annual/cash separation remain enforced. Offline fixtures explicitly declare known platforms; synthetic privacy sentinels remain excluded. These scripted evaluations do not establish live model routing or provider accuracy.
