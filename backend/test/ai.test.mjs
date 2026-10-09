import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { MongoClient, ObjectId } from "mongodb";
import { createToolRegistry, toolDefinitions } from "../dist/ai/tools.js";
import { createAnalyst, askSchema } from "../dist/ai/agent.js";
import { createResponsesClient } from "../dist/ai/provider.js";
import { createApp } from "../dist/app.js";
import { calculateDeliveryEfficiency, aggregateSessionEfficiency, calculateSessionEfficiency } from "../dist/efficiency.js";
import { calculateSettlementEfficiency } from "../dist/settlementEfficiency.js";
import { getDashboardAnalytics, resolveDashboardFilters } from "../dist/dashboard.js";
import { ensureIndexes } from "../dist/db.js";

const now = new Date("2026-03-08T20:00:00Z"), sessionId = new ObjectId(), merchantId = new ObjectId();
const session = { _id: sessionId, startedAt: new Date("2026-03-08T09:00:00Z"), endedAt: new Date("2026-03-08T10:00:00Z"), totalDrivenMiles: 10, strategy: "eastvale_local_only" };
const delivery = { _id: new ObjectId(), merchantId, pickedUpAt: session.startedAt, sessionId, payout: 0, distanceMiles: 1, deliveryDurationSeconds: 3600 };
const payment = { _id: new ObjectId(), type: "prop22_guarantee", paymentDate: "2026-03-20", amount: 20,
  coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14", sessionCoverageConfirmed: false };
const args = { period: "month", asOf: "2026-03-08" };
const defaultArgs = (name) => name === "get_settlement_efficiency" ? { settlementId: null, limit: 1 }
  : { ...args, ...(["get_period_summary", "get_delivery_efficiency"].includes(name) ? { category: "all" } : {}) };
function fixture() {
  const range = resolveDashboardFilters({ ...args, category: "all" }, now);
  const filters = { period: range.period, category: range.category, range: { startDate: range.startDate, endDate: range.endDate, timeZone: range.timeZone } };
  const efficiency = { filters, deliveryEfficiency: calculateDeliveryEfficiency([delivery]), sessionEfficiency: aggregateSessionEfficiency([calculateSessionEfficiency(session, [delivery], null)]),
    strategyComparison: ["wide_area_marathon", "home_based_multi_order", "eastvale_local_only", "other", "unclassified"].map((strategy) => ({ strategy, ...aggregateSessionEfficiency(strategy === session.strategy ? [calculateSessionEfficiency(session, [delivery], null)] : []) })),
    dataQuality: { deliveriesMissingPayout: 0, sessionsWithIncompleteVehicleCost: 1, sessionsWithIncompleteAssociations: 0 } };
  const settlement = calculateSettlementEfficiency(payment, [payment], [delivery], [session], null);
  return { dashboard: { filters, summary: { totalDeliveries: 1, uniqueMerchants: 1, totalEarnings: { value: 0, deliveryEarnings: 0, prop22Earnings: 0, sampleCount: 1, prop22PaymentCount: 0 } },
    map: { location: { coordinates: [0.123456, 0.654321] } }, notes: "SYNTHETIC_PRIVATE_NOTE", publicAddress: "SYNTHETIC_PUBLIC_ADDRESS" },
    efficiency, settlements: { data: [settlement], limit: 20, totalSettlements: 1, hasMore: false } };
}
function registry() {
  const data = fixture(), calls = []; let coordinated = 0;
  const domain = Object.fromEntries(["dashboard", "efficiency", "settlements"].map((name) => [name, async (...inputs) => { calls.push({ name, inputs }); return data[name]; }]));
  return { ...createToolRegistry({ collection() { throw new Error("No direct query expressions allowed"); } }, async (read) => { coordinated++; return read(); }, domain, now), calls, data, coordinated: () => coordinated };
}
const call = (name, input = defaultArgs(name), id = name) => ({ type: "function_call", name, arguments: JSON.stringify(input), call_id: id, id });
const response = (output = [], text = "") => ({ output, output_text: text, status: "completed", usage: { input_tokens: 100, output_tokens: 20 } });
function final(input, select = (evidence) => evidence.filter((fact) => /payout|status|confirmed|structurally/i.test(fact.label)).slice(0, 4), explanation = "Recorded amounts are observations; unavailable profit requires complete costs and coverage.") {
  const evidence = input.filter((item) => item.type === "function_call_output").flatMap((item) => JSON.parse(item.output).evidence);
  return response([], JSON.stringify({ explanation, factIds: select(evidence).map((fact) => fact.id) }));
}

test("AI request and strict tool schemas reject invalid questions, names, fields and dates before reads", async () => {
  for (const body of [{ question: "" }, { question: "  " }, { question: "x".repeat(1001) }, { question: "valid", command: "delete" }]) assert.equal(askSchema.safeParse(body).success, false);
  assert.equal(askSchema.parse({ question: " valid " }).question, "valid");
  assert.equal(toolDefinitions.length, 6);
  for (const tool of toolDefinitions) {
    assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual(tool.parameters.required.sort(), Object.keys(tool.parameters.properties).sort());
  }
  const tools = registry();
  assert.equal(tools.currentDate, "2026-03-08");
  for (const [name, input] of [["delete_all", {}], ["__proto__", {}], ["get_session_efficiency", { ...args, category: "grocery" }],
    ["get_period_summary", { ...args, category: "invalid" }], ["get_delivery_efficiency", { ...args, category: "all", asOf: "2026-02-30" }],
    ["get_settlement_efficiency", { settlementId: "broken", limit: 999 }], ["get_data_quality", { period: { $ne: "year" } }]]) {
    await assert.rejects(() => tools.execute(name, input));
  }
  assert.equal(tools.calls.length, 0); assert.equal(tools.coordinated(), 0);
});
test("all six typed tools reuse existing analytics, preserve unknown/zero/cohorts and exclude private/map fields", async () => {
  const tools = registry();
  for (const tool of toolDefinitions) {
    const data = await tools.execute(tool.name, defaultArgs(tool.name));
    const json = JSON.stringify(data);
    for (const privateToken of ["coordinates", "publicAddress", "SYNTHETIC_PRIVATE_NOTE", "SYNTHETIC_PUBLIC_ADDRESS", "deliveryIds"]) assert.equal(json.includes(privateToken), false);
  }
  assert.equal(tools.coordinated(), 6);
  assert.equal(tools.calls.filter((call) => call.name === "dashboard").length, 1);
  const core = await tools.execute("get_session_efficiency", args);
  assert.equal(core.metrics.knownPayoutTotal.value, 0); assert.equal(core.metrics.estimatedEconomicProfit.value, null);
  assert.equal(core.scope.category, "all"); assert.equal(core.metrics.payoutPerSessionHour.sampleCount, 1);
  const settlements = await tools.execute("get_settlement_efficiency", { settlementId: payment._id.toHexString(), limit: 1 });
  assert.equal(settlements.settlements[0].actualAdjustment, 20); assert.equal(settlements.settlements[0].adjustedEarningsPerHour, null);
  assert.equal((await tools.execute("get_settlement_efficiency", { settlementId: payment._id.toHexString().toUpperCase(), limit: 1 })).settlements.length, 1);
  assert.equal(settlements.settlements[0].sessionCoverage.completenessConfirmed, false);
  assert.equal((await tools.execute("get_settlement_efficiency", { settlementId: new ObjectId().toHexString(), limit: 1 })).status, "unavailable");
  const deliveryData = await tools.execute("get_delivery_efficiency", { ...args, category: "grocery" });
  assert.equal(deliveryData.metrics.payoutPerRecordedHour.value, 0);
  assert.equal(tools.calls.at(-1).inputs[1].category, "grocery");
});
test("multiple tools ground a final answer using exact server-rendered evidence and redacted usage diagnostics", async () => {
  const requests = [], diagnostics = [], tools = registry();
  const client = { async create(input) {
    requests.push(structuredClone(input));
    return requests.length === 1 ? response([call("get_session_efficiency"), call("get_settlement_efficiency")]) : final(input.input);
  } };
  const result = await createAnalyst(client, "mock-model", (data) => diagnostics.push(data))("Explain my income", tools, "synthetic-id");
  assert.deepEqual(result.toolsUsed, ["get_session_efficiency", "get_settlement_efficiency"]);
  assert.match(result.answer, /0 USD/); assert.match(result.answer, /unavailable/);
  assert.equal(requests.length, 2); assert.equal(requests[0].store, false); assert.equal(requests[0].tool_choice, "required");
  assert.equal(diagnostics[0].inputTokens, 200); assert.equal(diagnostics[0].outputTokens, 40); assert.equal(diagnostics[0].toolCallCount, 2);
  const json = JSON.stringify(diagnostics); assert.equal(json.includes("Explain my income"), false); assert.equal(json.includes("payout"), false);
  assert.equal(diagnostics[0].outcome, "success");
});
test("provider-only, invented-number and forged-evidence answers never succeed", async () => {
  await assert.rejects(() => createAnalyst({ create: async () => response([], '{"explanation":"You earned $999","factIds":[]}') }, "mock")("How much?", registry(), "id"), { code: "no_tool_evidence" });
  for (const text of [{ explanation: "You earned 999 dollars.", factIds: ["e1"] }, { explanation: "You earned nine hundred dollars.", factIds: ["e1"] },
    { explanation: "你的收入是九百美元。", factIds: ["e1"] }, { explanation: "Recorded results.", factIds: ["forged"] }]) {
    let step = 0;
    await assert.rejects(() => createAnalyst({ create: async () => ++step === 1 ? response([call("get_period_summary")]) : response([], JSON.stringify(text)) }, "mock")("Income?", registry(), "id"), { code: "ungrounded_answer" });
  }
});
test("unknown/invalid tools, failures, SDK errors and truncated responses stay controlled", async () => {
  const cases = [[response([call("delete_all", {})]), "unknown_tool"], [response([call("get_session_efficiency", { period: "invalid" })]), "invalid_tool_arguments"],
    [{ ...response(), status: "incomplete" }, "incomplete_provider_response"], [response([{ ...call("get_data_quality"), arguments: "{" }]), "invalid_tool_arguments"]];
  for (const [result, code] of cases) await assert.rejects(() => createAnalyst({ create: async () => result }, "mock")("Explain", registry(), "id"), { code });
  await assert.rejects(() => createAnalyst({ create: async () => { throw new Error("SYNTHETIC_SECRET raw provider details"); } }, "mock")("Explain", registry(), "id"), (error) => error.code === "provider_failure" && !error.message.includes("SYNTHETIC_SECRET"));
  const tools = registry(); tools.execute = async () => { throw new Error("SYNTHETIC_PRIVATE_NOTE"); };
  await assert.rejects(() => createAnalyst({ create: async () => response([call("get_data_quality")]) }, "mock")("Explain", tools, "id"), { code: "tool_failure", status: 503 });
});
test("round, execution and result-size limits fail closed without retry storms", async () => {
  let rounds = 0; const tools = registry();
  await assert.rejects(() => createAnalyst({ create: async () => { rounds++; return response([call("get_data_quality", defaultArgs("get_data_quality"), `round-${rounds}`)]); } }, "mock")("Explain", tools, "id"), { code: "tool_limit" });
  assert.equal(rounds, 4); assert.equal(tools.coordinated(), 3);
  const many = registry();
  await assert.rejects(() => createAnalyst({ create: async () => response(Array.from({ length: 7 }, (_, i) => call("get_data_quality", defaultArgs("get_data_quality"), `tool-${i}`))) }, "mock")("Explain", many, "id"), { code: "tool_limit" });
  assert.equal(many.calls.length, 0);
  const huge = registry(); huge.execute = async () => ({ synthetic: "x".repeat(50_000) });
  await assert.rejects(() => createAnalyst({ create: async () => response([call("get_data_quality")]) }, "mock")("Explain", huge, "id"), { code: "tool_payload_limit" });
});
test("missing config, timeout and cancellation do not call live providers or block core analytics", async () => {
  assert.equal(createResponsesClient(undefined, "mock"), null); assert.equal(createResponsesClient("synthetic", "invalid model"), null);
  await assert.rejects(() => createAnalyst(null, "mock")("Explain", registry(), "id"), { code: "configuration_missing", status: 503 });
  let signal;
  await assert.rejects(() => createAnalyst({ create: async (_input, current) => { signal = current; return new Promise(() => {}); } }, "mock", undefined, 15)("Explain", registry(), "id"), { code: "timeout_or_cancelled", status: 503 });
  assert.equal(signal.aborted, true);
  const cancelled = new AbortController(); cancelled.abort(); const tools = registry();
  await assert.rejects(() => tools.execute("get_data_quality", args, cancelled.signal), { code: "timeout_or_cancelled" }); assert.equal(tools.calls.length, 0);
});

test("AI endpoint uses isolated MongoDB analytics, preserves every collection and safe error contracts", async () => {
  const client = new MongoClient(process.env.MONGODB_URI), db = client.db(`dgi_ai_test_${randomUUID().replaceAll("-", "")}`);
  let server, connected = false;
  try {
    await client.connect(); connected = true; await ensureIndexes(db);
    await db.collection("merchants").insertOne({ _id: merchantId, name: "Synthetic Pickup", category: "restaurant", city: "Test", publicAddress: "SYNTHETIC_PUBLIC_ADDRESS", location: { type: "Point", coordinates: [0, 0] } });
    await db.collection("deliveries").insertOne({ ...delivery, notes: "SYNTHETIC_PRIVATE_NOTE", destinationLocation: { type: "Point", coordinates: [0.1, 0.2] } });
    await db.collection("deliverySessions").insertOne(session); await db.collection("earningsAdjustments").insertOne(payment);
    const snapshot = async () => JSON.stringify(await Promise.all(["merchants", "deliveries", "deliverySessions", "earningsAdjustments", "vehicleEconomics", "vehicleTaxYears"].map((name) => db.collection(name).find().toArray())));
    const before = await snapshot(), dashboardBefore = await getDashboardAnalytics(db, { ...args, category: "all" }, now);
    let mode = "valid", requests = 0; const diagnostics = [];
    const sdk = { async create(input) {
      requests++;
      if (mode === "error") throw new Error("SYNTHETIC_SECRET SDK detail");
      if (mode === "valid") { mode = "final"; return response(toolDefinitions.map((tool) => call(tool.name))); }
      const outgoing = JSON.stringify(input);
      for (const token of ["coordinates", "SYNTHETIC_PRIVATE_NOTE", "SYNTHETIC_PUBLIC_ADDRESS"]) assert.equal(outgoing.includes(token), false);
      return final(input.input);
    } };
    const fail = async () => { throw new Error("No external geocoding"); };
    server = createApp(db, fail, fail, createAnalyst(sdk, "mock", (data) => diagnostics.push(data))).listen(0, "127.0.0.1"); await once(server, "listening");
    const api = async (body) => { const r = await fetch(`http://127.0.0.1:${server.address().port}/api/ai/ask`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json(), cache: r.headers.get("cache-control") }; };
    for (const body of [{ question: " " }, { question: "x".repeat(1001) }, { question: "valid", action: "delete" }]) assert.equal((await api(body)).status, 400);
    assert.equal(requests, 0);
    assert.equal(diagnostics.length, 3); assert.ok(diagnostics.every((data) => data.outcome === "invalid_question" && data.toolCallCount === 0 && !data.usageAvailable));
    const result = await api({ question: "Explain recorded operations" }); assert.equal(result.status, 200); assert.equal(result.cache, "no-store"); assert.equal(result.body.toolsUsed.length, 6);
    mode = "error"; const failed = await api({ question: "Explain recorded operations" }); assert.equal(failed.status, 502); assert.equal(failed.body.code, "provider_failure"); assert.equal(JSON.stringify(failed.body).includes("SYNTHETIC_SECRET"), false);
    assert.equal(await snapshot(), before); assert.deepEqual(await getDashboardAnalytics(db, { ...args, category: "all" }, now), dashboardBefore);
    await new Promise((resolve) => server.close(resolve)); server = createApp(db, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    assert.equal((await api({ question: "Explain" })).status, 503);
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/health`)).status, 200);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { if (connected) await db.dropDatabase(); } finally { await client.close(); }
  }
});
