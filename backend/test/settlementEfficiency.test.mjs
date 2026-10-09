import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { calculateSettlementEfficiency } from "../dist/settlementEfficiency.js";
import { resolveCoverageDates } from "../dist/dashboard.js";
import { earningsAdjustmentInputSchema, earningsAdjustmentPatchSchema } from "../dist/model.js";
import { reconcileSettlement } from "../dist/settlement.js";
import { createApp } from "../dist/app.js";

const profile = { vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 800, expectedTireSetLifeMiles: 20000, marginalDepreciationCostPerMile: 0.05 };
function fixture() {
  const payment = { _id: new ObjectId(), type: "prop22_guarantee", paymentDate: "2026-03-20", amount: 24.17, coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14", sessionCoverageConfirmed: true,
    settlementDetails: { reportedGuaranteedAmount: 124.17, eligibleEarningsExcludingTips: 100, engagedSeconds: 999999, engagedMiles: 99999 } };
  const sessions = [{ _id: new ObjectId(), startedAt: new Date("2026-03-08T09:30:00Z"), endedAt: new Date("2026-03-08T10:30:00Z"), totalDrivenMiles: 10 },
    { _id: new ObjectId(), startedAt: new Date("2026-03-09T16:00:00Z"), endedAt: new Date("2026-03-09T18:00:00Z"), totalDrivenMiles: 20 }];
  const deliveries = [10, 20, 30].map((payout, i) => ({ _id: new ObjectId(), payout,
    pickedUpAt: new Date(sessions[i === 2 ? 1 : 0].startedAt.getTime() + i * 1000), sessionId: sessions[i === 2 ? 1 : 0]._id }));
  return { payment, sessions, deliveries };
}
const calc = (f, payments = [f.payment], p = profile) => calculateSettlementEfficiency(f.payment, payments, f.deliveries, f.sessions, p);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
const finite = (v) => { if (typeof v === "number") assert.ok(Number.isFinite(v)); else if (v && typeof v === "object") Object.values(v).forEach(finite); };

test("inclusive LA coverage resolves local midnight across spring/fall DST", () => {
  const spring = resolveCoverageDates("2026-03-01", "2026-03-14");
  assert.equal(spring.start.toISOString(), "2026-03-01T08:00:00.000Z"); assert.equal(spring.endExclusive.toISOString(), "2026-03-15T07:00:00.000Z");
  assert.equal((spring.endExclusive - spring.start) / 3600000, 335);
  const fall = resolveCoverageDates("2026-10-25", "2026-11-07"); assert.equal((fall.endExclusive - fall.start) / 3600000, 337);
});
test("complete confirmed periods add actual adjustment once and sum raw session denominators", () => {
  const f = fixture(), result = calc(f);
  assert.equal(result.status, "ready"); assert.equal(result.deliveryRevenue.knownTotal, 60); assert.equal(result.workPeriodRevenue, 84.17);
  assert.equal(result.sessionCoverage.totalHours, 3); assert.equal(result.sessionCoverage.totalMiles, 30);
  assert.equal(result.sessionCoverage.includedSessionCount, 2); assert.equal(result.deliveryRevenue.deliveryCount, 3);
  close(result.adjustedEarningsPerHour, 84.17 / 3); close(result.adjustedEarningsPerMile, 84.17 / 30);
  assert.equal(result.vehicleCost.componentTotals.energy.value, 0); assert.equal(result.vehicleCost.fullTotal, 2.7);
  close(result.estimatedEconomicProfit, 81.47); close(result.estimatedEconomicProfitPerHour, 81.47 / 3);
  close(result.estimatedEconomicProfitPerMile, 81.47 / 30);
  const reconciliation = reconcileSettlement(f.payment);
  f.payment.settlementDetails.reportedGuaranteedAmount = 999;
  assert.equal(calc(f).workPeriodRevenue, 84.17); assert.equal(reconciliation.expectedAdjustment, 24.17);
});
test("missing/false confirmation blocks denominators but preserves useful recorded revenue and the flag", () => {
  for (const confirmation of [undefined, false]) {
    const f = fixture(); f.payment.sessionCoverageConfirmed = confirmation;
    const result = calc(f); assert.equal(result.status, "partial"); assert.equal(result.workPeriodRevenue, 84.17);
    assert.equal(result.adjustedEarningsPerHour, null); assert.equal(result.sessionCoverage.totalHours, null);
    assert.ok(result.reasons.includes("unconfirmed_session_coverage")); assert.equal(result.sessionCoverage.completenessConfirmed, false);
  }
});
test("missing coverage is unavailable and never inferred from payment date", () => {
  for (const fields of [{ coverageStartDate: undefined, coverageEndDate: undefined }, { coverageEndDate: undefined }, { coverageEndDate: "2026-02-01" }, { coverageStartDate: "invalid" }]) {
    const f = fixture(); Object.assign(f.payment, fields); const result = calc(f);
    assert.equal(result.status, "unavailable"); assert.equal(result.workPeriodRevenue, null); assert.equal(result.range, null);
    assert.ok(result.reasons.includes("missing_coverage_dates"));
  }
});
test("missing payouts block complete revenue/rates/profit while zero payout is known", () => {
  const f = fixture(); delete f.deliveries[0].payout;
  const result = calc(f); assert.equal(result.deliveryRevenue.knownTotal, 50); assert.equal(result.deliveryRevenue.missingPayoutCount, 1);
  assert.equal(result.workPeriodRevenue, null); assert.equal(result.adjustedEarningsPerHour, null); assert.equal(result.estimatedEconomicProfit, null);
  f.deliveries[0].payout = 0; assert.equal(calc(f).status, "ready"); assert.equal(calc(f).workPeriodRevenue, 74.17);
});
test("confirmed missing/invalid associations cannot enable efficiency", () => {
  for (const kind of ["unlinked", "missing", "outside", "no_sessions", "invalid_time", "invalid_unlinked_time"]) {
    const f = fixture();
    if (kind === "unlinked") delete f.deliveries[0].sessionId;
    if (kind === "missing") f.deliveries[0].sessionId = new ObjectId();
    if (kind === "outside") { f.sessions[0].startedAt = new Date("2026-02-01T00:00:00Z"); f.sessions[0].endedAt = new Date("2026-02-01T01:00:00Z"); }
    if (kind === "no_sessions") f.sessions = [];
    if (kind === "invalid_time") f.sessions[0].endedAt = f.sessions[0].startedAt;
    if (kind === "invalid_unlinked_time") f.sessions.push({ _id: new ObjectId(), startedAt: new Date("2026-03-10T16:00:00Z"), endedAt: new Date("invalid") });
    const result = calc(f); assert.notEqual(result.status, "ready"); assert.equal(result.adjustedEarningsPerHour, null);
    assert.equal(result.sessionCoverage.completenessConfirmed, true); assert.equal(result.estimatedEconomicProfit, null);
  }
});
test("crossing sessions are counted, excluded, and block even otherwise valid subsets", () => {
  const f = fixture(); f.sessions.push({ _id: new ObjectId(), startedAt: new Date("2026-02-28T23:00:00-08:00"), endedAt: new Date("2026-03-01T01:00:00-08:00"), totalDrivenMiles: 5 });
  const result = calc(f); assert.equal(result.sessionCoverage.excludedBoundarySessionCount, 1); assert.equal(result.sessionCoverage.includedSessionCount, 2);
  assert.equal(result.adjustedEarningsPerHour, null); assert.ok(result.reasons.includes("session_crosses_coverage_boundary"));
});
test("outside linked pickups, overlapping sessions, and sessions without deliveries block attribution", () => {
  for (const kind of ["outside_coverage", "outside_session", "overlap", "no_links"]) {
    const f = fixture();
    if (kind === "outside_coverage") f.deliveries.push({ _id: new ObjectId(), sessionId: f.sessions[0]._id, pickedUpAt: new Date("2026-03-15T07:00:00Z"), payout: 2 });
    if (kind === "outside_session") f.deliveries[0].pickedUpAt = new Date("2026-03-10T07:00:00Z");
    if (kind === "overlap") { f.sessions[1].startedAt = f.sessions[0].startedAt; f.sessions[1].endedAt = f.sessions[0].endedAt; f.deliveries[2].pickedUpAt = f.sessions[1].startedAt; }
    if (kind === "no_links") f.sessions.push({ _id: new ObjectId(), startedAt: new Date("2026-03-10T16:00:00Z"), endedAt: new Date("2026-03-10T17:00:00Z"), totalDrivenMiles: 2 });
    const result = calc(f); assert.equal(result.status, "partial"); assert.equal(result.sessionCoverage.totalHours, null);
  }
});
test("overlapping/duplicate settlements block without summing adjustments; adjacent dates do not overlap", () => {
  const f = fixture();
  for (const dates of [{}, { coverageStartDate: "2026-03-14", coverageEndDate: "2026-03-27" }]) {
    const other = { ...f.payment, _id: new ObjectId(), ...dates }; const result = calc(f, [f.payment, other]);
    assert.ok(result.reasons.includes("overlapping_settlements")); assert.equal(result.workPeriodRevenue, null); assert.equal(result.adjustedEarningsPerHour, null);
    assert.equal(result.actualAdjustment, 24.17);
  }
  const adjacent = { ...f.payment, _id: new ObjectId(), coverageStartDate: "2026-03-15", coverageEndDate: "2026-03-28" };
  assert.equal(calc(f, [f.payment, adjacent]).status, "ready");
});
test("missing/invalid mileage blocks coverage; zero miles remains known but cannot produce mileage rate", () => {
  for (const value of [undefined, -1, Infinity, NaN]) {
    const f = fixture(); f.sessions[0].totalDrivenMiles = value; const result = calc(f);
    assert.equal(result.adjustedEarningsPerHour, null); assert.ok(result.reasons.includes("missing_session_mileage")); finite(result);
  }
  const f = fixture(); f.sessions.forEach((row) => { row.totalDrivenMiles = 0; }); const result = calc(f);
  assert.equal(result.sessionCoverage.totalMiles, 0); assert.equal(result.adjustedEarningsPerMile, null);
  assert.equal(result.estimatedEconomicProfit, 84.17); assert.equal(result.status, "partial");
});
test("incomplete A.1 costs preserve ready earnings and partial breakdown, but never full profit", () => {
  for (const p of [{ ...profile, marginalDepreciationCostPerMile: undefined }, { ...profile, expectedTireSetLifeMiles: undefined }, null]) {
    const result = calc(fixture(), undefined, p); assert.equal(result.status, "ready");
    assert.equal(result.estimatedEconomicProfit, null); assert.equal(result.vehicleCost.fullTotal, null); assert.ok(result.reasons.includes("incomplete_vehicle_cost"));
    if (p) assert.equal(result.vehicleCost.componentTotals.energy.value, 0);
  }
});
test("empty activity, nonfinite and overflow inputs never claim ready or emit invalid numeric values", () => {
  const f = fixture(); f.deliveries = []; f.sessions = []; const empty = calc(f);
  assert.equal(empty.status, "unavailable"); assert.equal(empty.deliveryRevenue.knownTotal, null); assert.equal(empty.workPeriodRevenue, null);
  for (const value of [Infinity, NaN, 1e308]) {
    const input = fixture(); input.payment.amount = value; const result = calc(input); finite(result); assert.notEqual(result.status, "ready");
  }
});
test("confirmation is optional boolean metadata and does not alter A.0 reconciliation", () => {
  const { _id, ...payment } = fixture().payment;
  assert.equal(earningsAdjustmentInputSchema.parse(payment).sessionCoverageConfirmed, true);
  assert.equal(earningsAdjustmentPatchSchema.parse({ sessionCoverageConfirmed: false }).sessionCoverageConfirmed, false);
  assert.equal(earningsAdjustmentPatchSchema.safeParse({ sessionCoverageConfirmed: "true" }).success, false);
  assert.equal(earningsAdjustmentPatchSchema.safeParse({ sessionCoverageConfirmed: null }).success, false);
  assert.deepEqual(reconcileSettlement(payment), reconcileSettlement({ ...payment, sessionCoverageConfirmed: false }));
});

test("isolated API reads complete periods and safely extends Payment metadata without accounting regressions", async (t) => {
  const client = new MongoClient(process.env.MONGODB_URI), db = client.db(`dgi_settlement_efficiency_test_${randomBytes(6).toString("hex")}`);
  let server, connected = false;
  try {
    await client.connect(); connected = true;
    const f = fixture(), merchantId = new ObjectId(); delete f.payment.sessionCoverageConfirmed;
    await db.collection("merchants").insertOne({ _id: merchantId, name: "Synthetic Merchant", category: "restaurant", city: "Test", location: { type: "Point", coordinates: [0, 0] } });
    await db.collection("earningsAdjustments").insertOne(f.payment); await db.collection("deliverySessions").insertMany(f.sessions);
    await db.collection("vehicleEconomics").insertOne({ _id: "primary", ...profile });
    await db.collection("deliveries").insertMany(f.deliveries.map((row) => ({ ...row, merchantId, notes: "Synthetic private note", destinationLocation: { type: "Point", coordinates: [0.123, 0.456] } })));
    const fail = async () => { throw new Error("External services must not run"); };
    server = createApp(db, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    const api = async (path, method = "GET", body) => { const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) }); return { status: response.status, body: await response.json() }; };
    const paymentPath = `/api/earnings-adjustments/${f.payment._id}`;
    const baseline = await api("/api/dashboard?period=week&asOf=2026-03-08"), core = await api("/api/efficiency?period=month&asOf=2026-03-08"), reconciliation = (await api(paymentPath)).body.reconciliation;
    await t.test("legacy false, PATCH true/false, unchanged reconciliation/core/cash accounting", async () => {
      assert.equal((await api("/api/efficiency/settlements")).body.data[0].sessionCoverage.completenessConfirmed, false);
      assert.equal((await api(paymentPath, "PATCH", { sessionCoverageConfirmed: true })).status, 200);
      const result = (await api("/api/efficiency/settlements")).body.data[0]; assert.equal(result.status, "ready"); assert.equal(result.workPeriodRevenue, 84.17);
      assert.deepEqual((await api(paymentPath)).body.reconciliation, reconciliation);
      assert.deepEqual(await api("/api/dashboard?period=week&asOf=2026-03-08"), baseline); assert.equal(baseline.body.summary.totalEarnings.value, 30);
      assert.deepEqual(await api("/api/efficiency?period=month&asOf=2026-03-08"), core);
      assert.equal((await api(paymentPath, "PATCH", { sessionCoverageConfirmed: false })).body.data.sessionCoverageConfirmed, false);
      assert.equal((await api(paymentPath, "PATCH", { sessionCoverageConfirmed: "yes" })).status, 400);
      await api(paymentPath, "PATCH", { sessionCoverageConfirmed: true });
    });
    await t.test("projection excludes destination, customer notes and delivery IDs", async () => {
      const output = JSON.stringify((await api("/api/efficiency/settlements")).body);
      for (const value of ["destination", "coordinates", "address", "notes", "0.123", "Synthetic private note", f.deliveries[0]._id.toHexString(), "reportedGuaranteedAmount", "expectedAdjustment"]) assert.ok(!output.includes(value));
    });
    await t.test("out-of-window linked pickup and invalid unlinked session are fetched and block", async () => {
      const outside = { _id: new ObjectId(), merchantId, sessionId: f.sessions[0]._id, pickedUpAt: new Date("2026-04-01T00:00:00Z"), payout: 10 };
      await db.collection("deliveries").insertOne(outside);
      assert.ok((await api("/api/efficiency/settlements")).body.data[0].reasons.includes("linked_delivery_outside_coverage"));
      await db.collection("deliveries").deleteOne({ _id: outside._id });
      const invalid = { _id: new ObjectId(), startedAt: new Date("2026-03-10T12:00:00Z") }; await db.collection("deliverySessions").insertOne(invalid);
      assert.ok((await api("/api/efficiency/settlements")).body.data[0].reasons.includes("missing_session_duration"));
      await db.collection("deliverySessions").deleteOne({ _id: invalid._id });
    });
    await t.test("recent response stays bounded but checks overlap with older omitted settlements", async () => {
      const filler = Array.from({ length: 22 }, (_, i) => ({ _id: new ObjectId(), type: "prop22_guarantee", amount: 1, paymentDate: `2020-01-${String(i + 1).padStart(2, "0")}` }));
      const conflict = { ...f.payment, _id: new ObjectId(), paymentDate: "1999-01-01" };
      await db.collection("earningsAdjustments").insertMany([...filler, conflict]);
      const response = (await api("/api/efficiency/settlements")).body;
      assert.equal(response.data.length, 20); assert.equal(response.hasMore, true); assert.equal(response.totalSettlements, 24);
      assert.ok(response.data[0].reasons.includes("overlapping_settlements")); assert.equal(response.data[0].adjustedEarningsPerHour, null);
      assert.equal(await db.collection("earningsAdjustments").countDocuments(), 24);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { if (connected) await db.dropDatabase(); } finally { await client.close(); }
  }
});
