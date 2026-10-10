import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import { createApp } from "../dist/app.js";
import { createDashboardFilterSchema, resolveDashboardFilters } from "../dist/dashboard.js";

const reference = new Date("2028-03-09T02:00:00Z"); // March 8 in Los Angeles
const resolve = (filters, now = reference) => resolveDashboardFilters({ category: "all", ...filters }, now);

test("Year and All resolve trusted LA calendar boundaries, DST, leap days and rollovers", () => {
  for (const year of [2026, 2027, 2028]) {
    const range = resolve({ period: "year", year });
    assert.equal(range.start.toISOString(), `${year}-01-01T08:00:00.000Z`);
    assert.equal(range.endExclusive.toISOString(), `${year + 1}-01-01T08:00:00.000Z`);
    assert.equal(range.year, year);
  }
  assert.equal(resolve({ period: "year" }).year, 2028);
  assert.equal(resolve({ period: "year", asOf: "2026-06-05" }).year, 2026);
  assert.equal(resolve({ period: "year", year: 2026 }, new Date("2027-06-01T00:00Z")).year, 2026);
  const all = resolve({ period: "all" });
  assert.equal(all.start.toISOString(), "2026-01-01T08:00:00.000Z");
  assert.equal(all.endExclusive.toISOString(), "2028-03-09T08:00:00.000Z");
  assert.equal(all.endDate, "2028-03-08");
  const spring = resolve({ period: "all", asOf: "2026-03-08" });
  const fall = resolve({ period: "all", asOf: "2026-11-01" });
  assert.equal(spring.endExclusive.toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(fall.endExclusive.toISOString(), "2026-11-02T08:00:00.000Z");
  assert.equal(resolve({ period: "week", asOf: "2026-11-01" }).endExclusive - resolve({ period: "week", asOf: "2026-11-01" }).start, 169 * 3600000);
  assert.equal(resolve({ period: "month", asOf: "2028-02-29" }).endDate, "2028-02-29");
  assert.equal(resolve({ period: "all", asOf: "2028-02-29" }).endExclusive.toISOString(), "2028-03-01T08:00:00.000Z");
  const before = new Date("2028-01-01T07:59:59Z"), after = new Date("2028-01-01T08:00:00Z");
  assert.equal(resolve({ period: "year" }, before).year, 2027);
  assert.equal(resolve({ period: "year" }, after).year, 2028);
  assert.equal(resolve({ period: "all" }, before).endDate, "2027-12-31");
  assert.equal(resolve({ period: "all" }, after).endDate, "2028-01-01");
});

const invalidQueries = [
  { period: "year", year: "2025" }, { period: "year", year: "2029" },
  ...["2026.0", "2026.5", "2.026e3", "0x7ea", "", "garbage", " 2026", "2026\n"].map((year) => ({ period: "year", year })),
  ...["week", "month", "all"].map((period) => ({ period, year: "2026" })),
  { period: "year", year: "2026", asOf: "2026-06-01" }, { period: "year", asOf: "2025-06-01" },
  { period: "year", asOf: "2029-06-01" }, { period: "all", asOf: "2025-12-31" },
  { period: "all", asOf: "2028-03-09" }, { period: "quarter" }, { period: "all", extra: "1" }
];
test("shared schema rejects conflicting/malformed/future filters without ambiguous precedence", () => {
  const schema = createDashboardFilterSchema(reference);
  for (const query of invalidQueries) assert.equal(schema.safeParse(query).success, false, JSON.stringify(query));
  for (const year of [2026.5, NaN, Infinity, null]) assert.equal(schema.safeParse({ period: "year", year }).success, false);
  assert.equal(schema.parse({ period: "year", year: "2026" }).year, 2026);
  assert.equal(schema.safeParse({ period: "year", asOf: "2026-06-01" }).success, true);
});

test("three endpoints share historical/All cohorts, financial boundaries and synthetic GIS observations", async () => {
  const client = new MongoClient(process.env.MONGODB_URI);
  const db = client.db(`dgi_time_test_${randomUUID().replaceAll("-", "")}`);
  let server, connected = false;
  try {
    await client.connect(); connected = true;
    const restaurant = { _id: new ObjectId(), name: "Synthetic Same Brand", category: "restaurant", city: "Test", location: { type: "Point", coordinates: [0, 0] } };
    const grocery = { ...restaurant, _id: new ObjectId(), category: "grocery", location: { type: "Point", coordinates: [1, 1] } };
    await db.collection("merchants").insertMany([restaurant, grocery]);
    const observations = [
      ["2026-01-01T07:59:59Z", restaurant, 100], // pre-2026 local, excluded
      ["2026-01-01T08:00:00Z", restaurant, 10],
      ["2026-07-01T08:00:00Z", grocery, undefined],
      ["2027-06-01T08:00:00Z", restaurant, 0],
      ["2028-02-29T08:00:00Z", grocery, 20],
      ["2028-03-09T07:59:59Z", restaurant, 30], // current local day, included
      ["2028-03-09T08:00:00Z", restaurant, 500] // future local day, excluded from All
    ];
    const sessions = [], deliveries = [];
    for (const [timestamp, merchant, payout] of observations) {
      const startedAt = new Date(timestamp), sessionId = new ObjectId();
      sessions.push({ _id: sessionId, startedAt, endedAt: new Date(startedAt.getTime() + 3600000), totalDrivenMiles: 10, strategy: "eastvale_local_only" });
      deliveries.push({ _id: new ObjectId(), merchantId: merchant._id, sessionId, pickedUpAt: startedAt,
        ...(payout !== undefined ? { payout } : {}), distanceMiles: 2, deliveryDurationSeconds: 1800,
        destinationLocation: { type: "Point", coordinates: [0.1, 0.2] } });
    }
    await db.collection("deliveries").insertMany(deliveries);
    await db.collection("deliverySessions").insertMany(sessions);
    await db.collection("earningsAdjustments").insertMany([
      ["2025-12-31", 100], ["2026-01-01", 5], ["2027-02-01", 6], ["2028-03-08", 7], ["2028-03-09", 999]
    ].map(([paymentDate, amount]) => ({ _id: new ObjectId(), type: "prop22_guarantee", paymentDate, amount })));
    await db.collection("uberAnnualSummaries").insertMany([2024, 2025].map((year) => ({ year, annual: { netPayout: 999999 } })));
    const fail = async () => { throw new Error("No external geocoding"); };
    server = createApp(db, fail, fail, undefined, () => reference).listen(0, "127.0.0.1");
    await once(server, "listening");
    const get = async (endpoint, query) => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${endpoint}?${new URLSearchParams(query)}`);
      return { status: response.status, data: await response.json() };
    };
    const endpoints = ["/api/dashboard", "/api/dashboard/destination-heatmap", "/api/efficiency"];
    for (const query of invalidQueries) for (const endpoint of endpoints) assert.equal((await get(endpoint, query)).status, 400);
    for (const [query, count, known, payouts, adjustment, paymentCount, timeline] of [
      [{ period: "year", year: "2026", category: "all" }, 2, 1, 10, 5, 1, ["2026-01", "2026-12"]],
      [{ period: "year", year: "2027", category: "all" }, 1, 1, 0, 6, 1, ["2027-01", "2027-12"]],
      [{ period: "all", category: "all" }, 5, 4, 60, 18, 3, ["2026", "2028"]],
      [{ period: "all", category: "grocery" }, 2, 1, 20, 0, 0, ["2026", "2028"]]
    ]) {
      const [dashboard, destination, efficiency] = await Promise.all(endpoints.map((endpoint) => get(endpoint, query)));
      assert.equal(dashboard.status, 200); assert.equal(destination.status, 200); assert.equal(efficiency.status, 200);
      const d = dashboard.data, e = efficiency.data;
      assert.deepEqual(e.filters, d.filters);
      assert.equal(d.summary.totalDeliveries, count);
      assert.equal(e.deliveryEfficiency.deliveryCount, count);
      assert.equal(d.summary.totalEarnings.deliveryEarnings, payouts);
      assert.equal(d.summary.totalEarnings.sampleCount, known);
      assert.equal(d.summary.totalEarnings.prop22Earnings, adjustment);
      assert.equal(d.summary.totalEarnings.prop22PaymentCount, paymentCount);
      assert.equal(d.summary.totalEarnings.value, payouts + adjustment);
      assert.equal(d.pickupTimeline[0].date, timeline[0]);
      assert.equal(d.pickupTimeline.at(-1).date, timeline[1]);
      assert.equal(d.pickupTimeline.length, query.period === "all" ? 3 : 12);
      for (const rows of [d.pickupTimeline, d.categoryDistribution, d.topMerchants, d.map.pickupVolume]) assert.equal(rows.reduce((sum, row) => sum + row.deliveries, 0), count);
      assert.equal(d.summary.uniqueMerchants, d.map.merchantDiversity.length);
      assert.equal(destination.data.cells.reduce((sum, cell) => sum + cell.count, 0), count);
      assert.deepEqual(Object.keys(destination.data), ["cells"]);
      assert.ok(!JSON.stringify(destination.data).includes("address"));
      assert.deepEqual(destination.data.cells[0].location.coordinates, [0.1, 0.2]);
      assert.equal(e.sessionEfficiency.knownPayoutTotal.value, query.period === "year" && query.year === "2027" ? 0 : query.period === "year" ? 10 : 30);
      assert.equal(e.sessionEfficiency.estimatedEconomicProfit.value, null); // unknown costs remain unknown
      assert.equal(e.strategyComparison.find((row) => row.strategy === "eastvale_local_only").knownPayoutTotal.value, e.sessionEfficiency.knownPayoutTotal.value);
      if (query.period === "all") {
        assert.equal(e.sessionEfficiency.sessionCount, 4); // end-day session crosses All boundary
        assert.equal(e.dataQuality.sessionsExcludedBoundaryCrossing, 2); // lower and upper edges
        assert.equal(e.sessionEfficiency.categoryScope, "all");
      }
    }
    const empty = (await get("/api/dashboard", { period: "year", year: "2027", category: "other" })).data;
    assert.equal(empty.summary.totalDeliveries, 0); assert.equal(empty.summary.totalEarnings.value, null);
    assert.equal(empty.pickupTimeline.length, 12); assert.ok(empty.pickupTimeline.every((row) => row.deliveries === 0));
    const all = (await get("/api/dashboard", { period: "all" })).data;
    assert.deepEqual(all.pickupTimeline.map((row) => row.deliveries), [2, 1, 2]);
    assert.equal(all.summary.topMerchantByOrders.deliveries, 3);
    assert.equal(all.summary.topMerchantByAverageEarnings.averageEarnings, 20);
    assert.equal(all.summary.topMerchantByAverageEarnings.sampleCount, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { if (connected) await db.dropDatabase(); } finally { await client.close(); }
  }
});
