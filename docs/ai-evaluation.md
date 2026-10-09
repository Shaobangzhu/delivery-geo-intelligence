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

`eval:ai` typechecks `backend/src` plus `backend/evals`, then runs the existing `tsx` loader through Node. It does not load `.env`, connect MongoDB, read private records or instantiate a live OpenAI client. It needs no credentials. Category pass/fail results come from executed assertions; an assertion failure sets a nonzero exit status. No generated report files are written. `npm test` additionally needs the DGI Docker MongoDB for existing isolated integration tests, which remove only their synthetic test databases.

## Synthetic scenarios

The 32 scenarios use fixed synthetic sessions/deliveries, known zero payout, missing payout, incomplete vehicle costs, complete modeled costs (including negative profit), explicit strategies and a synthetic received adjustment. Existing pure financial functions supply fixture values; the harness does not introduce alternative formulas. Calendar resolution is pinned to a synthetic Los Angeles request date. Sentinel fields contain conspicuously synthetic notes, address placeholders, IDs, coordinates and injection text solely to prove projection exclusion. No real addresses or observed financial records appear in these fixtures.

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

Some scenarios contain multiple independent adversarial/failure probes. There are **32 named scenarios**, not a claim that every probe is an independently sampled real model question. Provider responses and tool plans are scripted. Tool-selection assertions verify execution of that plan, argument forwarding, allowlists and scope enforcement; they do **not** measure whether a real model would choose that plan. Chinese text is also scripted, not a language-model accuracy benchmark.

Focused backend regression tests additionally cover same-tool multiple scopes, five settlement results within the unchanged byte budget, safe HTTP envelopes, collection immutability and client disconnect propagation to the provider boundary. Frontend tests cover no automatic invocation, focus/labels, suggestions, blank input, duplicate submissions, escaped text, explicit retry, malformed successful responses, cancellation/unmount and late success/failure suppression. Narrow-layout wrapping is implemented in CSS; no automated browser viewport or manual visual assessment was performed in Prompt C.

## Grounding contract

1. Zod requires all declared tool arguments before a coordinated read. Optional dates/IDs are explicit `null`; unknown keys, invalid enum/date/ID, nested query objects and prototype keys fail.
2. Only the six frozen read-only service mappings exist. There are no write, shell, filesystem, arbitrary URL or secret-reading tools.
3. A recursive aggregate projection strips unknown keys and record IDs. Retained text is domain enums, validated ISO dates or server-authored limitations/workflows. Stored notes, public/residential addresses and all destination coordinates are excluded.
4. Each successful result creates facts with an unpredictable request prefix and per-execution provenance. A stale/forged ID cannot resolve to another request's facts. Same-tool executions retain separate scopes.
5. Provider output selects facts via strict JSON `{ explanation, factIds, comparison }`. Numerical values are never supplied by that final model JSON. The server renders values, units, metric sample/excluded counts/reasons and settlement coverage/completeness metadata. Negative values and recorded zero remain distinct from unavailable.
6. Strategy selections or selected metrics spanning different scopes, accounting bases, cohorts or units require `comparison: "limited"`. A conflicting `none` fails with `scope_conflict`. Limited answers replace model prose with a deterministic comparison boundary and separately scoped facts. No difference, causal ranking or improvement calculation is authorized.
7. Ordinary explanations reject numeric/digit/written-number/percentage claims, including Unicode and punctuation probes, plus obvious unsupported write/comparative assertions. Prop 22 and specified conceptual phrases (for example, “unknown, not zero”) remain allowed. Dates and numerical detail are displayed from evidence instead of repeated model prose. This deliberately conservative check can still reject legitimate phrasing; it is not a complete linguistic or semantic verifier.

Evidence/source metadata are serialized once per distinct source rather than repeated per fact, and full aggregate trees are not duplicated beside evidence. No cross-request or shared financial cache is used: separate tools still read through the existing queue, can see edits completed between reads and are not one transaction/snapshot. Labels preserve cash receipt versus coverage period and partial/current-cost assumptions. The server cannot prove that the model selected a relevant period or every useful fact for the user's question.

## Safe failure and cancellation behavior

Every HTTP error includes a generated request ID, a controlled code and a generic safe message. No SDK stack, prompt, private payload or credential is echoed.

| Status | Examples |
| --- | --- |
| 400 | Invalid question envelope/length (`invalid_question`) |
| 502 | Authentication/configuration/provider failures; incomplete/invalid response; invalid tool payload/name/call; forged evidence/numeric prose; `scope_conflict` |
| 503 | Missing AI configuration, provider rate limit, timeout/cancellation, failed/invalid/oversized tool result or unexpected internal failure |

An empty settlement result remains `unavailable`, with no fabricated revenue. No successful tool evidence or no valid selected IDs fails closed. There is no automatic retry. The user may submit again explicitly after an error.

Browser close/Escape/unmount aborts fetch. Express response-close aborts the agent, whose signal is passed to `client.responses.create(..., { signal })`. Queued tool reads check the signal before DB access; the loop checks cancellation before subsequent provider/tool work. A local HTTP test verifies this chain with a mock SDK boundary. Already-running MongoDB reads and remote provider processing/billing cannot be guaranteed to stop. An older request cannot replace a newer UI answer or error.

## Limits and measurements

Prompt B limits are unchanged:

- At most 3 tool-calling rounds, 6 total executions and 4 provider requests.
- At most 1,000 generated output tokens per response and 60 seconds overall.
- At most 48,000 bytes per serialized tool output and 128,000 bytes cumulatively.
- SDK retries disabled. Duplicate call IDs rejected.

The runner reports measured min/max/total provider calls, tool executions, input/output tokens, tool bytes, local milliseconds and provider errors across all mock requests, including failing probes. Limit probes intentionally reach rejected oversized payloads; the benchmark's maximum attempted bytes is therefore allowed to exceed the accepted budget. Values are not hardcoded PASS results.

Development diagnostics preserve supplied per-response input/output/total token counts and cached/cache-write/reasoning detail fields. Missing optional fields stay absent; missing usage is not estimated. Usage totals sum available responses (including replayed input), not assumed billing totals. Model-dependent remote latency, actual model token consumption and dollar costs are **not measured** by mocks. No pricing is invented and no dollar estimate is implemented.

## Four distinct quality dimensions

| Dimension | What is established | What is not established |
| --- | --- | --- |
| Deterministic financial correctness | Existing financial regression suites plus synthetic tool projections preserve the frozen formulas and null/cohort semantics | Completeness or truth of real personal observations |
| Tool-calling correctness | Scripted exchanges validate strict arguments, forwarding, allowlists, bounded execution and read-only integration | Real model tool/argument selection accuracy |
| Narrative grounding | Current-request facts, exact rendering, structured comparison boundary and tested prose refusal rules | Complete semantic truth or resistance to every novel injection/paraphrase |
| Real model/language performance | Nothing from these mocks | Account/model access, real Chinese quality, refusal/routing rates, real token usage/latency |

**DEFERRED:** Small explicitly authorized live evaluation with synthetic representative questions and bounded calls. No live command/test or automatic provider request was added or run. Additional paraphrases, inaccessible-provider behavior and true browser/remote cancellation effects require separate evidence. Questions and selected aggregate facts are sent to OpenAI during real user submissions; the feature is not entirely local. `store: false` does not promise zero provider retention.
