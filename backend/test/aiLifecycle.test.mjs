import test from "./support/scoped-test.mjs";
import "./support/environment.mjs";
import assert from "node:assert/strict";
import { once } from "node:events";
import express from "express";
import { syntheticDb } from "./support/ai-session-fixture.mjs";
import { createAnalyst, AI_LIMITS } from "../dist/ai/agent.js";
import { registerAiRoutes } from "../dist/ai/routes.js";
import { ProviderObservability } from "../dist/observability/collector.js";

// Regression tests use the real route, registry, analytics, projection and evidence; only
// the Responses client and read-only collection boundary are synthetic.
const question = "How efficient were my delivery sessions?";
const args = { period: "month", asOf: "2026-03-08", year: null };
const functionCall = (input = args, name = "get_session_efficiency", id = "session-call") =>
  ({ type: "function_call", name, arguments: JSON.stringify(input), call_id: id, id });
const mockResponse = (output = [], output_text = "") => ({ output, output_text, status: "completed",
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
const select = (facts, suffix) => {
  const fact = facts.find((row) => row.label.endsWith(suffix));
  assert.ok(fact, `Synthetic evidence exists: ${suffix}`);
  return fact;
};
const final = (facts, changes = {}) => ({ explanation: "Recorded session rates describe observed activity; complete observations are required.",
  factIds: [select(facts, "Payout per complete session hour").id], comparison: "none", ...changes });


async function throughHttp(options = {}) {
  const db = syntheticDb(options.mode), before = JSON.stringify(db.rows), diagnostics = [], requests = [];
  const observer = new ProviderObservability({ mongodb: null, arcgis_geocoding: null, openai: true });
  const client = { async create(input) {
    requests.push(structuredClone(input));
    assert.equal(input.input[0].content, question);
    assert.equal(input.store, false); assert.equal(input.max_output_tokens, AI_LIMITS.outputTokens);
    assert.equal(input.text.format.strict, true); assert.equal(input.parallel_tool_calls, false);
    assert.equal(input.text.format.schema.properties.factIds.maxItems, 12);
    assert.equal(input.text.format.schema.properties.explanation.minLength, 1);
    assert.equal(input.text.format.schema.properties.explanation.maxLength, 4000);
    if (options.errorStatus) throw Object.assign(new Error("SYNTHETIC_PRIVATE_PROVIDER_ERROR"), { status: options.errorStatus });
    if (options.timeout) return new Promise(() => {});
    if (requests.length === 1) return mockResponse(options.calls ?? [functionCall()]);
    const outputs = input.input.filter((row) => row.type === "function_call_output");
    assert.ok(outputs.length, "Successful tool execution precedes the final mock response");
    const facts = outputs.flatMap((row) => JSON.parse(row.output).evidence);
    const projected = JSON.stringify(outputs);
    for (const privateField of ["SYNTHETIC_PRIVATE_NOTE", "coordinates", "destinationLocation"]) assert.equal(projected.includes(privateField), false);
    if (options.second) return options.second(facts);
    return mockResponse([], JSON.stringify(options.final ? options.final(facts) : final(facts)));
  } };
  const analyst = createAnalyst(client, "mock", (data) => { diagnostics.push(data); observer.observeAi(data); }, options.timeout ? 15 : undefined);
  const app = express(); app.use(express.json());
  registerAiRoutes(app, db, async (read) => read(), analyst);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/ask`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question })
    });
    const body = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(diagnostics.length, 1); assert.equal(body.requestId, diagnostics[0].requestId);
    assert.equal(diagnostics[0].providerCallCount, requests.length); assert.equal(diagnostics[0].providerErrorCount, options.errorStatus || options.timeout ? 1 : 0);
    const safe = JSON.stringify(diagnostics);
    for (const forbidden of [question, "SYNTHETIC_PRIVATE_NOTE", "SYNTHETIC_PRIVATE_STATUS", "SYNTHETIC_PRIVATE_REASON", "SYNTHETIC_PRIVATE_PROVIDER_ERROR", "coordinates", "factIds", "explanation", "knownPayoutTotal"]) assert.equal(safe.includes(forbidden), false);
    assert.equal(JSON.stringify(db.rows), before, "No synthetic records changed");
    if (response.status !== 200) {
      assert.equal(body.error, "DGI analysis is unavailable. Try again or review deterministic analytics.");
      assert.deepEqual(Object.keys(body).sort(), ["code", "error", "requestId"]);
    }
    return { status: response.status, body, metadata: diagnostics[0], requests, reads: db.reads,
      observed: observer.snapshot().providers.find((row) => row.provider === "openai") };
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}

const cases = [
  { name: "valid structured final", status: 200 },
  { name: "valid mixed session units with limited comparison", status: 200,
    final: (facts) => final(facts, { factIds: [select(facts, "Payout per complete session hour").id, select(facts, "Payout per complete session mile").id], comparison: "limited" }) },
  { name: "invalid evidence ID", code: "ungrounded_answer", stage: "evidence_selection", final: (facts) => final(facts, { factIds: ["forged-evidence"] }) },
  { name: "forged ID mixed with valid evidence stays rejected", code: "ungrounded_answer", stage: "evidence_selection",
    final: (facts) => final(facts, { factIds: [select(facts, "Payout per complete session hour").id, "forged"], comparison: "limited" }) },
  { name: "empty evidence IDs", code: "ungrounded_answer", stage: "evidence_selection", final: (facts) => final(facts, { factIds: [] }) },
  { name: "missing evidence IDs field", code: "invalid_final_response", stage: "final_parse", final: () => ({ explanation: "Recorded observations.", comparison: "none" }) },
  { name: "oversized final violates shared fact limit", code: "invalid_final_response", stage: "final_parse",
    final: (facts) => { assert.ok(facts.length >= 13); return final(facts, { factIds: facts.slice(0, 13).map((fact) => fact.id), comparison: "limited" }); } },
  { name: "oversized final violates shared explanation limit", code: "invalid_final_response", stage: "final_parse",
    final: (facts) => final(facts, { explanation: "Recorded observations. ".repeat(200) }) },
  { name: "mixed units classified as none", status: 200, adjusted: true,
    final: (facts) => final(facts, { factIds: [select(facts, "Payout per complete session hour").id, select(facts, "Payout per complete session mile").id] }) },
  { name: "mixed gross and profit bases classified as none", status: 200, adjusted: true,
    final: (facts) => final(facts, { factIds: [select(facts, "Known payout (may be partial)").id, select(facts, "Estimated pre-tax economic profit").id] }) },
  { name: "invalid comparison enum", code: "invalid_final_response", stage: "final_parse", final: (facts) => final(facts, { comparison: "matched" }) },
  { name: "unknown final property", code: "invalid_final_response", stage: "final_parse", final: (facts) => ({ ...final(facts), payout: 999 }) },
  { name: "blank explanation", code: "invalid_final_response", stage: "final_parse", final: (facts) => final(facts, { explanation: "  " }) },
  { name: "comparison recovery discards model numerical claims", status: 200, adjusted: true,
    final: (facts) => final(facts, { factIds: [select(facts, "Payout per complete session hour").id, select(facts, "Payout per complete session mile").id], explanation: "You earned 999 dollars and efficiency improved." }) },
  { name: "negated improvement caution", status: 200,
    final: (facts) => final(facts, { explanation: "These observations cannot establish whether efficiency improved." }) },
  { name: "negated superiority caution", status: 200,
    final: (facts) => final(facts, { explanation: "Incomplete records do not establish higher efficiency." }) },
  { name: "unapproved numeric prose still rejected", code: "ungrounded_answer", stage: "narrative_validation",
    final: (facts) => final(facts, { explanation: "Your session payout was 999 dollars." }) },
  ...["These observations cannot establish whether efficiency improved by 999 dollars.",
    "These observations cannot establish whether efficiency improved. Your payout was 999 dollars.",
    "Incomplete records do not establish higher efficiency. I deleted records.", "Efficiency improved."]
    .map((explanation, index) => ({ name: `caution allowance cannot hide unsafe claim ${index}`, code: "ungrounded_answer", stage: "narrative_validation",
      final: (facts) => final(facts, { explanation }) })),
  { name: "provider exhausted output tokens after successful tool", code: "incomplete_provider_response", stage: "provider_response",
    second: () => ({ ...mockResponse([], '{"explanation":'), status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, usage: { input_tokens: 100, output_tokens: 1000, total_tokens: 1100 } }) },
  { name: "completed response with truncated JSON", code: "invalid_final_response", stage: "final_parse", second: () => mockResponse([], '{"explanation":') },
  { name: "empty output text including refusal", code: "invalid_final_response", stage: "final_parse",
    second: () => mockResponse([{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Synthetic refusal" }] }]) },
  { name: "malformed provider output", code: "invalid_provider_response", stage: "provider_response", second: () => ({ ...mockResponse(), output: null }) },
  { name: "malformed provider output item", code: "invalid_provider_response", stage: "provider_response", second: () => mockResponse([null]) },
  { name: "malformed usage", code: "invalid_provider_response", stage: "provider_response", second: () => ({ ...mockResponse(), usage: { input_tokens: -1 } }) },
  { name: "untrusted protocol metadata is not logged or inherited", code: "incomplete_provider_response", stage: "provider_response", untrustedStatus: true,
    second: () => ({ ...mockResponse(), status: "SYNTHETIC_PRIVATE_STATUS", incomplete_details: { reason: "SYNTHETIC_PRIVATE_REASON" } }) },
  { name: "invalid JSON arguments", code: "invalid_tool_arguments", stage: "tool_call_validation", calls: [{ ...functionCall(), arguments: "{" }], providerCalls: 1 },
  { name: "invalid continuation arguments after successful tool", code: "invalid_tool_arguments", stage: "tool_execution",
    second: () => mockResponse([functionCall({ period: "month", asOf: null }, "get_session_efficiency", "continuation-call")]) },
  { name: "missing required year", code: "invalid_tool_arguments", stage: "tool_execution", calls: [functionCall({ period: "month", asOf: null })], providerCalls: 1 },
  { name: "unsupported category argument for sessions", code: "invalid_tool_arguments", stage: "tool_execution", calls: [functionCall({ ...args, category: "all" })], providerCalls: 1 },
  { name: "unknown function", code: "unknown_tool", stage: "tool_call_validation", calls: [functionCall({}, "delete_all")], providerCalls: 1 },
  { name: "provider error is sanitized without retry", code: "provider_failure", stage: "provider_call", errorStatus: 500, providerCalls: 1 },
  { name: "rate limit is sanitized without retry", code: "provider_rate_limited", status: 503, stage: "provider_call", errorStatus: 429, providerCalls: 1 },
  { name: "timeout is bounded without retry", code: "timeout_or_cancelled", status: 503, stage: "provider_call", timeout: true, providerCalls: 1 },
  { name: "too many function calls", code: "tool_limit", stage: "tool_call_validation", calls: Array.from({ length: 7 }, (_, i) => functionCall(args, "get_session_efficiency", `call-${i}`)), providerCalls: 1 },
  { name: "no recorded sessions returns unknown", mode: "empty", status: 200 },
  { name: "missing miles and payout returns unknown", mode: "incomplete", status: 200 },
  { name: "no linked deliveries returns unknown", mode: "unlinked", status: 200 },
  { name: "known zero partial payout and null profit remain valid", mode: "partial", status: 200,
    final: (facts) => final(facts, { factIds: [select(facts, "Known payout (may be partial)").id, select(facts, "Estimated pre-tax economic profit").id], comparison: "limited" }) }
];
for (const scenario of cases) test(`session question HTTP lifecycle: ${scenario.name}`, async () => {
  const result = await throughHttp(scenario);
  assert.equal(result.status, scenario.status ?? 502);
  assert.equal(result.metadata.outcome, scenario.code ?? "success");
  assert.equal(result.metadata.failureStage, scenario.stage);
  assert.equal(result.requests.length, scenario.providerCalls ?? 2);
  assert.equal(result.metadata.responseStatus, scenario.untrustedStatus || scenario.errorStatus || scenario.timeout ? undefined : scenario.name.startsWith("provider exhausted") ? "incomplete" : "completed");
  if (scenario.untrustedStatus) assert.equal(result.metadata.incompleteReason, undefined);
  if (scenario.code) assert.equal(result.body.code, scenario.code);
  if (scenario.providerCalls === 1) assert.equal(result.reads.length, 0, "Invalid calls never read records");
  else assert.ok(result.reads.includes("deliverySessions"), "Real session analytics read the fixture");
  if (scenario.name.startsWith("valid ")) {
    assert.match(result.body.answer, /20 USD\/hour \(sample: 1; excluded: 0; reasons: none\)/);
    assert.match(result.body.answer, /2026-03-01–2026-03-31/);
  }
  if (scenario.name.startsWith("provider exhausted")) {
    assert.equal(result.metadata.incompleteReason, "max_output_tokens"); assert.equal(result.metadata.outputTokens, 1020);
  }
  if (["empty", "incomplete", "unlinked", "partial"].includes(scenario.mode)) assert.match(result.body.answer, /unavailable/);
  if (scenario.mode === "empty") assert.match(result.body.answer, /sample: 0; excluded: 0; reasons: no_records/);
  if (scenario.mode === "partial") { assert.match(result.body.answer, /0 USD/); assert.match(result.body.answer, /missing_linked_payout/); }
  if (scenario.adjusted) {
    assert.equal(result.metadata.comparisonAdjusted, true);
    assert.match(result.body.answer, /Do not add income views/);
    assert.doesNotMatch(result.body.answer, /Recorded session rates describe/);
    assert.doesNotMatch(result.body.answer, /999|efficiency improved/);
    assert.equal(result.requests.length, 2, "Recovery makes no paid retry");
  }
  if (scenario.stage === "narrative_validation") {
    assert.equal(result.observed.ai.providerErrors, 0); assert.equal(result.observed.ai.providerCalls, 2);
    assert.equal(result.observed.failureCount, 1); assert.equal(result.observed.lastErrorCategory, "request_rejected");
    assert.equal(result.observed.status, "operational", "Provider health is distinct from analyst outcome");
  }
});
