import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { MongoClient } from "mongodb";
import { annualFixture } from "./annualFixture.mjs";
import { annualInputSchema, annualSummary, annualMetrics, reconcileAnnual, compareAnnualYears, importAnnualSummary, getAnnualSummaries, moneyCents, lastCompletedYear } from "../dist/uberAnnualSummary.js";
import { createApp } from "../dist/app.js";
import { createToolRegistry, toolDefinitions } from "../dist/ai/tools.js";
import { createEvidenceCollector, requiresComparisonBoundary, isDeterministicAnnualComparison } from "../dist/ai/evidence.js";
import { createAnalyst, AI_LIMITS } from "../dist/ai/agent.js";
import { analystInstructions } from "../dist/ai/prompts.js";
import { projectAggregate } from "../dist/ai/projection.js";
const now = new Date("2026-10-09T16:00:00Z"), schema = annualInputSchema(now);

test("annual schema: partial sources, missing months and explicit zero remain distinct", () => {
  const source = annualFixture(); assert.equal(schema.safeParse(source).success, true);
  const partial = { year: 2023, sources: { uberTaxSummary: true, form1099K: false, form1099NEC: false }, annual: { completedTrips: 0, onlineMiles: 0 }, taxForms: {}, monthlyActivity: [{ month: 2, completedTrips: 0, onlineMiles: 3 }] };
  const parsed = schema.parse(partial);
  assert.equal(parsed.annual.completedTrips, 0); assert.equal(Object.hasOwn(parsed.annual, "netPayout"), false);
  assert.equal(parsed.monthlyActivity[0].onlineMiles, 3);
  assert.ok(reconcileAnnual(parsed).checks.filter((c) => c.check.startsWith("monthly")).every((c) => c.status === "insufficient_data"));
  assert.equal(annualMetrics(parsed).netPayout.value, null);
  assert.equal(lastCompletedYear(new Date("2026-01-01T01:00:00Z")), 2024);
});
test("annual schema rejects invalid years/months/numbers, unsafe cents and private fields", () => {
  const base = annualFixture();
  for (const year of [1999, 2026, 2027, 2022.5, "2022", Infinity]) assert.equal(schema.safeParse({ ...base, year }).success, false);
  for (const month of [0, 13, 1.5, "1"]) assert.equal(schema.safeParse({ ...base, monthlyActivity: [{ month }] }).success, false);
  assert.equal(schema.safeParse({ ...base, monthlyActivity: [{ month: 1 }, { month: 1 }] }).success, false);
  for (const value of [-1, Infinity, NaN, 1.005, Number.MAX_SAFE_INTEGER]) assert.equal(schema.safeParse({ ...base, annual: { ...base.annual, netPayout: value } }).success, false);
  for (const value of [-1, Infinity, NaN, 1.5, "1"]) assert.equal(schema.safeParse({ ...base, annual: { ...base.annual, completedTrips: value } }).success, false);
  for (const value of [-1, Infinity, NaN, "1"]) assert.equal(schema.safeParse({ ...base, annual: { ...base.annual, onlineMiles: value } }).success, false);
  for (const extras of [{ legalName: "SYNTHETIC_PRIVATE_NAME" }, { homeAddress: "SYNTHETIC_PRIVATE_ADDRESS" }, { tin: "SYNTHETIC_TIN" }, { filePath: "SYNTHETIC_PATH" }]) assert.equal(schema.safeParse({ ...base, ...extras }).success, false);
  assert.equal(schema.safeParse({ ...base, annual: { ...base.annual, accountNumber: "SYNTHETIC_ACCOUNT" } }).success, false);
  assert.equal(schema.safeParse({ ...base, sources: { ...base.sources, form1099K: false } }).success, false);
  assert.equal(schema.safeParse({ ...base, sources: { ...base.sources, uberTaxSummary: false } }).success, false);
  assert.equal(moneyCents(0.29) + moneyCents(0.01), 30n);
});
test("annual reconciliation checks all financial equations, monthly totals and transaction cross-check", () => {
  const source = annualFixture(), result = reconcileAnnual(source);
  assert.equal(result.status, "matched"); assert.equal(result.checks.length, 10);
  assert.ok(result.checks.every((check) => check.status === "matched"));
  for (const field of ["grossPayment", "netPayout", "grossTripTotal", "additionalEarnings", "expensesFeesTax"]) {
    const changed = structuredClone(source); changed.annual[field] += 0.01;
    assert.ok(reconcileAnnual(changed).warnings.some((check) => check.severity === "review"));
  }
  const decimal = structuredClone(source); decimal.annual.grossTripEarnings = 0.1; decimal.annual.tips = 0.2; decimal.annual.grossTripTotal = 0.3;
  assert.equal(reconcileAnnual(decimal).checks.find((c) => c.check === "trip_earnings_plus_tips").status, "matched");
  const unknown = structuredClone(source); delete unknown.taxForms.form1099NEC; unknown.sources.form1099NEC = false;
  assert.equal(reconcileAnnual(schema.parse(unknown)).checks[0].status, "insufficient_data");
  delete unknown.annual.additionalBreakdownComplete;
  assert.equal(reconcileAnnual(unknown).checks.find((c) => c.check === "additional_breakdown").status, "insufficient_data");
});
test("monthly discrepancies/zero trips do not rewrite observations or infer income/Prop 22", () => {
  const row = annualFixture(), original = structuredClone(row);
  row.monthlyActivity[1].completedTrips = 0; row.monthlyActivity[1].onlineMiles = 9;
  row.taxForms.form1099K.paymentTransactionCount = 11;
  const before = structuredClone(row), result = reconcileAnnual(row);
  assert.equal(result.status, "warning"); assert.equal(result.warnings.find((c) => c.check === "monthly_online_miles").difference, 1);
  assert.equal(result.warnings.find((c) => c.check === "monthly_trips").difference, 1);
  assert.ok(result.warnings.some((c) => c.check === "transaction_count_vs_trips"));
  assert.deepEqual(row, before); assert.deepEqual(original.annual, row.annual);
  const metrics = annualMetrics(row);
  assert.equal(metrics.netPayoutPerOnlineMile.value, 126 / 120); assert.equal(metrics.netPayoutPerTrip.value, 126 / 12);
  assert.equal(metrics.onlineMilesPerTrip.value, 120 / 12);
  assert.equal(Object.hasOwn(metrics, "earningsPerHour"), false); assert.equal(Object.hasOwn(row, "earningsAdjustments"), false);
});
test("annual comparisons use same definitions and handle zeros, unknowns and missing monthly values", () => {
  const before = annualFixture(2022), after = annualFixture(2023);
  after.annual.netPayout = 189; after.annual.onlineMiles = 150;
  const comparisons = compareAnnualYears(annualSummary(before), annualSummary(after));
  const change = comparisons.changes.find((c) => c.metric === "netPayout");
  assert.equal(change.absoluteChange, 63); assert.equal(change.percentageChange, 50); assert.equal(change.unit, "USD");
  const rate = comparisons.changes.find((c) => c.metric === "netPayoutPerOnlineMile");
  assert.ok(Math.abs(rate.absoluteChange - 0.21) < 1e-12); assert.equal(rate.previousDenominator, 120); assert.equal(rate.currentDenominator, 150);
  before.annual.netPayout = 0;
  assert.equal(compareAnnualYears(annualSummary(before), annualSummary(after)).changes.find((c) => c.metric === "netPayout").percentageChange, null);
  before.annual.onlineMiles = 0; delete before.annual.completedTrips;
  assert.equal(annualMetrics(before).netPayoutPerOnlineMile.value, null); assert.equal(annualMetrics(before).netPayoutPerTrip.value, null);
  assert.equal(annualMetrics(before).onlineMiles.value, 0);
  assert.equal(compareAnnualYears(annualSummary(before), annualSummary(after)).changes.find((c) => c.metric === "netPayoutPerOnlineMile").absoluteChange, null);
  assert.equal(annualSummary(after).monthlyGrossTransactionsPeak.value, 10);
  after.monthlyActivity.pop(); assert.equal(annualSummary(after).monthlyGrossTransactionsPeak.complete, false);
});

test("annual import/API uses an isolated MongoDB, preserves all existing collections and is idempotent", async (t) => {
  assert.ok(process.env.MONGODB_URI);
  const client = new MongoClient(process.env.MONGODB_URI), databaseName = `delivery_geo_intelligence_test_annual_${process.pid}_${randomBytes(4).toString("hex")}`;
  let server, connected = false;
  try {
    await client.connect(); connected = true; const db = client.db(databaseName);
    const otherCollections = ["deliveries", "deliverySessions", "earningsAdjustments", "vehicleTaxYears", "vehicleEconomics", "merchants"];
    for (const name of otherCollections) await db.collection(name).insertOne({ _id: `synthetic-${name}`, value: 123 });
    const snapshot = async () => JSON.stringify(await Promise.all(otherCollections.map((name) => db.collection(name).find().toArray())));
    const original = await snapshot(), row = annualFixture();
    const fail = async () => { throw new Error("Geocoding must not run"); };
    server = createApp(db, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    const url = `http://127.0.0.1:${server.address().port}/api/uber-annual-summaries`;
    const empty = await fetch(url); assert.equal(empty.status, 200); assert.deepEqual((await empty.json()).data, []);
    await t.test("dry-run then insert, reordered identical import and conflict", async () => {
      assert.equal((await importAnnualSummary(db, row, false, now)).status, "dry_run"); assert.equal(await db.collection("uberAnnualSummaries").countDocuments(), 0);
      assert.equal((await importAnnualSummary(db, row, true, now)).status, "imported");
      const reordered = structuredClone(row); reordered.monthlyActivity.reverse();
      assert.equal((await importAnnualSummary(db, reordered, true, new Date("2026-11-01T00:00:00Z"))).status, "already_imported");
      await assert.rejects(importAnnualSummary(db, { ...row, annual: { ...row.annual, onlineMiles: 121 } }, true, now), { code: "annual_conflict" });
      const wrong = annualFixture(2023); wrong.annual.netPayout = 0;
      await assert.rejects(importAnnualSummary(db, wrong, true, now), { code: "financial_review_required" });
      const warning = annualFixture(2023); warning.monthlyActivity[1].onlineMiles = 9;
      const results = await Promise.all([importAnnualSummary(db, warning, true, now), importAnnualSummary(db, warning, true, now)]);
      assert.deepEqual(results.map((r) => r.status).sort(), ["already_imported", "imported"]);
      assert.equal(await db.collection("uberAnnualSummaries").countDocuments(), 2);
    });
    const response = await fetch(url), dto = await response.json();
    assert.equal(response.headers.get("cache-control"), "no-store"); assert.deepEqual(dto.data.map((r) => r.year), [2023, 2022]);
    assert.equal(dto.data[0].reconciliation.status, "warning"); assert.equal(dto.data[0].annual.onlineMiles, 120);
    assert.equal(dto.data[0].metrics.netPayoutPerOnlineMile.value, 126 / 120);
    assert.doesNotMatch(JSON.stringify(dto), /importedAt|_id|SYNTHETIC|filePath|accountNumber|legalName/);
    for (const method of ["POST", "PATCH", "DELETE"]) assert.equal((await fetch(url, { method })).status, 404);
    assert.equal(await snapshot(), original);
    const limit = await getAnnualSummaries(db, [2022], now); assert.deepEqual(limit.data.map((r) => r.year), [2022]);
    for (let year = 2000; year <= 2020; year++) await db.collection("uberAnnualSummaries").insertOne({ _id: year, year, sources: { uberTaxSummary: true, form1099K: false, form1099NEC: false }, annual: {}, taxForms: {}, monthlyActivity: [], importedAt: now });
    const bounded = await getAnnualSummaries(db, undefined, now); assert.equal(bounded.data.length, 20); assert.equal(bounded.hasMore, true); assert.equal(bounded.data[0].year, 2023);
    await db.collection("uberAnnualSummaries").updateOne({ _id: 2022 }, { $set: { legalName: "SYNTHETIC_PRIVATE_NAME" } });
    const invalid = await fetch(url); assert.equal(invalid.status, 503); assert.doesNotMatch(await invalid.text(), /SYNTHETIC_PRIVATE_NAME|legalName/);
  } finally {
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    if (connected) await client.db(databaseName).dropDatabase(); await client.close();
  }
});

function annualRegistry() {
  const data = [annualSummary(annualFixture(2022)), annualSummary(annualFixture(2023))];
  const reports = { data, comparisons: [compareAnnualYears(data[0], data[1])], limit: 20, hasMore: false };
  return createToolRegistry({}, async (read) => read(), { annual: async () => ({ ...reports, legalName: "SYNTHETIC_PRIVATE_NAME", accountNumber: "SYNTHETIC_ACCOUNT", sourcePdf: "SYNTHETIC_PDF", destinationLocation: { coordinates: [1.12345, 2.98765] } }) }, now);
}
test("seventh annual tool: bounded strict args, safe projection, reported/year/unit provenance and cash separation", async () => {
  assert.equal(toolDefinitions.length, 7); assert.equal(AI_LIMITS.tools, 6);
  const registry = annualRegistry();
  for (const args of [{ years: [2022] }, { years: [2026], includeMonthly: false }, { years: [2022, 2022], includeMonthly: true }, { years: [2021, 2022, 2023], includeMonthly: true }, { years: [], includeMonthly: false }, { years: [2022], includeMonthly: false, tin: "SYNTHETIC" }, { years: [{ $ne: 1 }], includeMonthly: true }]) await assert.rejects(registry.execute("get_annual_uber_summary", args), { code: "invalid_tool_arguments" });
  const payload = await registry.execute("get_annual_uber_summary", { years: [2022, 2023], includeMonthly: true });
  assert.doesNotMatch(JSON.stringify(payload), /legalName|accountNumber|sourcePdf|destinationLocation|SYNTHETIC/);
  const facts = createEvidenceCollector().collect(payload, "get_annual_uber_summary", 1);
  assert.ok(facts.every((f) => f.source.year && f.source.definition && f.source.origin && f.unit));
  assert.ok(facts.some((f) => f.source.sourceKind === "form_1099_nec"));
  assert.ok(facts.some((f) => f.source.definition === "tips" && f.source.origin === "reported" && f.unit === "USD"));
  assert.ok(facts.some((f) => f.source.origin === "calculated" && f.source.definition === "netPayoutPerOnlineMile"));
  const changes = facts.filter((f) => f.source.basis === "uber_annual_comparison");
  assert.equal(isDeterministicAnnualComparison(changes), true);
  const cash = { ...changes[0], source: { ...changes[0].source, tool: "get_period_summary", basis: "cash_basis" } };
  assert.equal(requiresComparisonBoundary([cash, changes[0]]), true); assert.equal(isDeterministicAnnualComparison([cash, changes[0]]), false);
  assert.match(analystInstructions, /1099-NEC\/miscellaneous compensation is not automatically Prop 22/);
  assert.match(analystInstructions, /do not provide hours or reconstruct historical deliveries/);
  assert.match(analystInstructions, /never be added to recorded Delivery/);
  assert.deepEqual(projectAggregate({ notes: "SYNTHETIC_PRIVATE", tin: "SYNTHETIC", annualReports: [] }), { annualReports: [] });
});
test("two-year monthly annual evidence fits unchanged AI limits; derived change explanation is server-authored", async () => {
  const diagnostics = []; let step = 0;
  const analyst = createAnalyst({ create: async (input) => {
    if (++step === 1) return { output: [{ type: "function_call", name: "get_annual_uber_summary", arguments: JSON.stringify({ years: [2022, 2023], includeMonthly: true }), call_id: "annual" }], status: "completed" };
    const payload = JSON.parse(input.input.find((i) => i.type === "function_call_output").output);
    assert.ok(payload.evidence.every((fact) => fact.definition && fact.unit && payload.sources.some((source) => source.id === fact.sourceId && source.source.year && source.source.origin)));
    const ids = payload.sources.filter((s) => s.source.basis === "uber_annual_comparison").map((s) => s.id);
    const facts = payload.evidence.filter((f) => ids.includes(f.sourceId));
    return { output: [], status: "completed", output_text: JSON.stringify({ explanation: "Invented strategy superiority and income.", factIds: facts.map((f) => f.id), comparison: "limited" }) };
  } }, "mock", (data) => diagnostics.push(data));
  const result = await analyst("Compare annual statements", annualRegistry(), "annual-test");
  assert.match(result.answer, /calculated by the backend using the same annual metric definitions/); assert.doesNotMatch(result.answer, /Invented strategy/);
  assert.ok(diagnostics[0].toolPayloadBytes < AI_LIMITS.toolBytes); assert.equal(diagnostics[0].toolCallCount, 1);
});
