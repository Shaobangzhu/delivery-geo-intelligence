import "dotenv/config";
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { MongoClient, ObjectId } from "mongodb";
import { calculateDeliveryEfficiency, calculateSessionEfficiency, aggregateSessionEfficiency, selectPeriodSessions } from "../dist/efficiency.js";
import { resolveDashboardFilters } from "../dist/dashboard.js";
import { createApp } from "../dist/app.js";

const profile = { vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 800, expectedTireSetLifeMiles: 20000, marginalDepreciationCostPerMile: 0.05 };
function session(fields = {}) {
  return { _id: new ObjectId(), startedAt: new Date("2026-03-08T08:00:00Z"), endedAt: new Date("2026-03-08T10:00:00Z"), totalDrivenMiles: 10, ...fields };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
function assertFinite(value) {
  if (typeof value === "number") assert.ok(Number.isFinite(value));
  else if (value && typeof value === "object") Object.values(value).forEach(assertFinite);
}

test("delivery rates use ratios of sums on matching cohorts, never unweighted means", () => {
  const row = calculateDeliveryEfficiency([{ payout: 10, deliveryDurationSeconds: 1800, distanceMiles: 2 }]);
  assert.equal(row.payoutPerRecordedHour.value, 20); assert.equal(row.payoutPerRecordedMile.value, 5);
  const weighted = calculateDeliveryEfficiency([
    { payout: 10, deliveryDurationSeconds: 3600, distanceMiles: 2 },
    { payout: 90, deliveryDurationSeconds: 10800, distanceMiles: 18 },
    { payout: 999 }, { deliveryDurationSeconds: 1, distanceMiles: 0.01 }
  ]);
  assert.equal(weighted.payoutPerRecordedHour.value, 25); assert.equal(weighted.payoutPerRecordedMile.value, 5);
  assert.equal(weighted.payoutPerRecordedHour.sampleCount, 2); assert.equal(weighted.payoutPerRecordedHour.excludedCount, 2);
});

test("delivery unknown payout differs from zero; missing/zero denominators are unavailable", () => {
  const result = calculateDeliveryEfficiency([{ payout: 0, deliveryDurationSeconds: 3600, distanceMiles: 1 },
    { deliveryDurationSeconds: 3600, distanceMiles: 1 }, { payout: 20, deliveryDurationSeconds: 0, distanceMiles: 0 }, { payout: 10 }]);
  assert.equal(result.payoutPerRecordedHour.value, 0); assert.equal(result.payoutPerRecordedMile.value, 0);
  assert.equal(result.payoutPerRecordedHour.sampleCount, 1); assert.equal(result.payoutPerRecordedHour.excludedCount, 3);
  assert.equal(calculateDeliveryEfficiency([{}]).knownPayoutTotal.value, null);
  assert.equal(calculateDeliveryEfficiency([{ payout: 0 }]).knownPayoutTotal.value, 0);
  assert.equal(calculateDeliveryEfficiency([{ payout: 2, distanceMiles: 0 }]).payoutPerRecordedMile.value, null);
  assert.equal(calculateDeliveryEfficiency([]).payoutPerRecordedHour.value, null);
});

test("complete sessions combine explicit payouts and reuse zero energy and full A.1 costs", () => {
  const result = calculateSessionEfficiency(session(), [{ payout: 10 }, { payout: 30 }], profile);
  assert.equal(result.linkedDeliveryCount, 2); assert.equal(result.knownPayoutTotal, 40);
  assert.equal(result.durationHours, 2); assert.equal(result.payoutPerSessionHour, 20); assert.equal(result.payoutPerSessionMile, 4);
  assert.equal(result.vehicleCost.amounts.energy, 0); assert.equal(result.vehicleCost.fullEconomicCost, 0.9);
  close(result.estimatedEconomicProfit, 39.1); close(result.estimatedEconomicProfitPerHour, 19.55);
});

test("partial payout preserves known revenue, excludes incomplete rates and profit; no links is not zero revenue", () => {
  const partial = calculateSessionEfficiency(session(), [{ payout: 10 }, {}], profile);
  assert.equal(partial.knownPayoutTotal, 10); assert.equal(partial.missingPayoutCount, 1);
  assert.equal(partial.payoutPerSessionHour, null); assert.equal(partial.payoutPerSessionMile, null); assert.equal(partial.estimatedEconomicProfit, null);
  const empty = calculateSessionEfficiency(session(), [], profile);
  assert.equal(empty.knownPayoutTotal, null); assert.equal(empty.estimatedEconomicProfit, null); assert.ok(empty.reasons.includes("no_linked_deliveries"));
  const zero = calculateSessionEfficiency(session(), [{ payout: 0 }], profile);
  assert.equal(zero.payoutPerSessionHour, 0); close(zero.estimatedEconomicProfit, -0.9);
});

test("missing/zero mileage, invalid duration, and partial costs remain distinct", () => {
  const missing = calculateSessionEfficiency(session({ totalDrivenMiles: undefined }), [{ payout: 10 }], profile);
  assert.equal(missing.payoutPerSessionHour, 5); assert.equal(missing.payoutPerSessionMile, null); assert.equal(missing.estimatedEconomicProfit, null);
  const zero = calculateSessionEfficiency(session({ totalDrivenMiles: 0 }), [{ payout: 10 }], profile);
  assert.equal(zero.payoutPerSessionMile, null); assert.equal(zero.estimatedEconomicProfit, 10);
  const { marginalDepreciationCostPerMile: _unused, ...partialProfile } = profile;
  const partial = calculateSessionEfficiency(session(), [{ payout: 10 }], partialProfile);
  assert.equal(partial.vehicleCost.completeness, "partial"); assert.equal(partial.vehicleCost.knownAndEstimatedCost, 0.4);
  assert.equal(partial.estimatedEconomicProfit, null);
  assert.equal(calculateSessionEfficiency(session(), [{ payout: 10 }], { ...partialProfile, expectedTireSetLifeMiles: undefined }).vehicleCost.amounts.tireWear, null);
  assert.equal(calculateSessionEfficiency(session({ endedAt: new Date("2026-03-08T08:00:00Z") }), [{ payout: 10 }], profile).estimatedEconomicProfit, null);
});

test("session aggregates select explicit complete cohorts and weight time/mileage", () => {
  const rows = [calculateSessionEfficiency(session({ endedAt: new Date("2026-03-08T09:00:00Z"), totalDrivenMiles: 2 }), [{ payout: 10 }], profile),
    calculateSessionEfficiency(session({ endedAt: new Date("2026-03-08T11:00:00Z"), totalDrivenMiles: 18 }), [{ payout: 90 }], profile),
    calculateSessionEfficiency(session(), [{ payout: 999 }, {}], profile), calculateSessionEfficiency(session(), [], profile)];
  const aggregate = aggregateSessionEfficiency(rows);
  assert.equal(aggregate.knownPayoutTotal.value, 1099); assert.equal(aggregate.payoutPerSessionHour.value, 25); assert.equal(aggregate.payoutPerSessionMile.value, 5);
  assert.equal(aggregate.payoutPerSessionHour.sampleCount, 2); assert.equal(aggregate.payoutPerSessionHour.excludedCount, 2);
  assert.equal(aggregate.estimatedEconomicProfit.sampleCount, 2); close(aggregate.estimatedEconomicProfit.value, 98.2);
  close(aggregate.estimatedEconomicProfitPerHour.value, 24.55); assert.equal(aggregate.incompleteSessionCount, 2);
});

test("whole-interval selection uses LA/DST periods and excludes boundary crossings without splitting", () => {
  const range = resolveDashboardFilters({ period: "week", category: "all", asOf: "2026-03-08" });
  const end = range.endExclusive;
  const rows = [session({ startedAt: range.start, endedAt: end }),
    session({ startedAt: new Date(range.start.getTime() - 1), endedAt: new Date(range.start.getTime() + 1) }),
    session({ startedAt: new Date(end.getTime() - 1), endedAt: new Date(end.getTime() + 1) }),
    session({ startedAt: end, endedAt: new Date(end.getTime() + 1000) })];
  const selected = selectPeriodSessions(rows, range.start, end);
  assert.equal(selected.included.length, 1); assert.equal(selected.excludedBoundaryCrossingCount, 2);
  assert.equal((end - range.start) / 3600000, 167);
  const next = selectPeriodSessions(rows, end, new Date(end.getTime() + 7 * 86400000));
  assert.ok(!next.included.some((row) => row._id.equals(selected.included[0]._id)));
});

test("numeric overflow and invalid inputs never produce NaN or Infinity", () => {
  const deliveries = calculateDeliveryEfficiency([{ payout: 1e308, distanceMiles: 1e-308, deliveryDurationSeconds: 1e-308 }, { payout: 1e308, distanceMiles: 1, deliveryDurationSeconds: 1 }, { payout: NaN }]);
  assert.equal(deliveries.payoutPerRecordedMile.value, null); assertFinite(deliveries);
  const result = aggregateSessionEfficiency([calculateSessionEfficiency(session({ totalDrivenMiles: 1e308 }), [{ payout: 1e308 }, { payout: 1e308 }], profile)]);
  assertFinite(result);
});

test("read-only API is category-safe, bounded, private, and leaves Dashboard/Prop 22 unchanged", async (t) => {
  const client = new MongoClient(process.env.MONGODB_URI);
  const db = client.db(`delivery_geo_intelligence_efficiency_test_${randomBytes(6).toString("hex")}`);
  let server; let connected = false;
  try {
    await client.connect(); connected = true;
    const restaurant = new ObjectId(), grocery = new ObjectId();
    await db.collection("merchants").insertMany([{ _id: restaurant, name: "Synthetic Restaurant", category: "restaurant", city: "Test", location: { type: "Point", coordinates: [0, 0] } },
      { _id: grocery, name: "Synthetic Grocery", category: "grocery", city: "Test", location: { type: "Point", coordinates: [0, 0] } }]);
    const first = session({ strategy: "eastvale_local_only" }), second = session({ startedAt: new Date("2026-03-09T07:00:00Z"), endedAt: new Date("2026-03-09T09:00:00Z") });
    const crossing = session({ startedAt: new Date("2026-02-28T23:00:00-08:00"), endedAt: new Date("2026-03-01T01:00:00-08:00") });
    await db.collection("deliverySessions").insertMany([first, second, crossing]);
    await db.collection("vehicleEconomics").insertOne({ _id: "primary", ...profile });
    await db.collection("deliveries").insertMany([
      { _id: new ObjectId(), merchantId: restaurant, sessionId: first._id, pickedUpAt: first.startedAt, payout: 10, deliveryDurationSeconds: 1800, distanceMiles: 2, notes: "Synthetic private note", destinationLocation: { type: "Point", coordinates: [0.123, 0.456] } },
      { _id: new ObjectId(), merchantId: grocery, sessionId: first._id, pickedUpAt: first.startedAt, payout: 30, deliveryDurationSeconds: 5400, distanceMiles: 6 },
      { _id: new ObjectId(), merchantId: restaurant, pickedUpAt: first.startedAt }
    ]);
    const payment = { _id: new ObjectId(), type: "prop22_guarantee", paymentDate: "2026-03-08", amount: 24.17 };
    await db.collection("earningsAdjustments").insertOne(payment);
    const fail = async () => { throw new Error("External services must not run"); };
    server = createApp(db, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    const api = async (path) => { const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`); return { status: r.status, data: await r.json() }; };
    const baseline = await api("/api/dashboard?period=month&asOf=2026-03-08");
    await t.test("aggregate scope, strategies, missing data and boundary counts", async () => {
      const { status, data } = await api("/api/efficiency?period=month&asOf=2026-03-08");
      assert.equal(status, 200); assert.equal(data.deliveryEfficiency.payoutPerRecordedHour.value, 20);
      assert.equal(data.sessionEfficiency.sessionCount, 2); assert.equal(data.sessionEfficiency.knownPayoutTotal.value, 40);
      assert.equal(data.sessionEfficiency.payoutPerSessionHour.value, 20); assert.equal(data.sessionEfficiency.payoutPerSessionHour.excludedCount, 1);
      close(data.sessionEfficiency.estimatedEconomicProfit.value, 39.1);
      assert.equal(data.strategyComparison.length, 5); assert.equal(data.strategyComparison.find((row) => row.strategy === "unclassified").sessionCount, 1);
      assert.equal(data.strategyComparison.find((row) => row.strategy === "eastvale_local_only").linkedDeliveryCount, 2);
      assert.equal(data.strategyComparison.find((row) => row.strategy === "wide_area_marathon").sessionCount, 0);
      assert.equal(data.dataQuality.deliveriesMissingPayout, 1); assert.equal(data.dataQuality.deliveriesMissingRecordedDuration, 1);
      assert.equal(data.dataQuality.deliveriesMissingDistance, 1); assert.equal(data.dataQuality.deliveriesWithoutSessionAssociation, 1);
      assert.equal(data.dataQuality.sessionsWithoutLinkedDeliveries, 1); assert.equal(data.dataQuality.sessionsExcludedBoundaryCrossing, 1);
      assertFinite(data);
      const body = JSON.stringify(data);
      for (const forbidden of ["destination", "coordinates", "address", "latitude", "longitude", "Synthetic private note", "0.123", first._id.toHexString()]) assert.ok(!body.includes(forbidden));
    });
    await t.test("category filters only delivery metrics, never the full-session numerator", async () => {
      const all = (await api("/api/efficiency?period=month&asOf=2026-03-08")).data;
      const restaurantData = (await api("/api/efficiency?period=month&category=restaurant&asOf=2026-03-08")).data;
      assert.equal(restaurantData.deliveryEfficiency.knownPayoutTotal.value, 10);
      assert.deepEqual(restaurantData.sessionEfficiency, all.sessionEfficiency); assert.deepEqual(restaurantData.strategyComparison, all.strategyComparison);
      assert.equal(restaurantData.sessionEfficiency.categoryScope, "all");
    });
    await t.test("validation, no mutation or Prop 22 allocation", async () => {
      assert.equal((await api("/api/efficiency?period=bad")).status, 400);
      assert.equal((await api("/api/efficiency?category=bad")).status, 400);
      assert.equal((await api("/api/efficiency?unexpected=1")).status, 400);
      assert.deepEqual(await api("/api/dashboard?period=month&asOf=2026-03-08"), baseline);
      assert.equal(baseline.data.summary.totalEarnings.value, 64.17);
      assert.deepEqual(await db.collection("earningsAdjustments").findOne({ _id: payment._id }), payment);
      const empty = (await api("/api/efficiency?period=month&asOf=2020-01-01")).data;
      assert.equal(empty.sessionEfficiency.estimatedEconomicProfit.value, null); assertFinite(empty);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) await db.dropDatabase(); await client.close();
  }
});
