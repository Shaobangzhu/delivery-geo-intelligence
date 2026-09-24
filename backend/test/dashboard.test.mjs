import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import { createApp } from "../dist/app.js";
import { dashboardFilterSchema, resolveDashboardFilters } from "../dist/dashboard.js";

test("dashboard periods use Los Angeles calendar boundaries", () => {
  const week = resolveDashboardFilters(dashboardFilterSchema.parse({ period: "week", asOf: "2026-03-08" }));
  assert.equal(week.start.toISOString(), "2026-03-02T08:00:00.000Z");
  assert.equal(week.endExclusive.toISOString(), "2026-03-09T07:00:00.000Z");
  assert.equal(week.endDate, "2026-03-08");
  const month = resolveDashboardFilters(dashboardFilterSchema.parse({ period: "month", asOf: "2026-04-20" }));
  assert.equal(month.startDate, "2026-04-01");
  assert.equal(month.endDate, "2026-04-30");
  assert.equal(month.start.toISOString(), "2026-04-01T07:00:00.000Z");
  const year = resolveDashboardFilters(dashboardFilterSchema.parse({ period: "year", asOf: "2026-04-20" }));
  assert.equal(year.startDate, "2026-01-01");
  assert.equal(year.endDate, "2026-12-31");
  assert.equal(year.start.toISOString(), "2026-01-01T08:00:00.000Z");
  assert.equal(year.endExclusive.toISOString(), "2027-01-01T08:00:00.000Z");
  assert.equal(dashboardFilterSchema.safeParse({ period: "day" }).success, false);
  assert.equal(dashboardFilterSchema.safeParse({ category: "invalid" }).success, false);
  assert.equal(dashboardFilterSchema.safeParse({ asOf: "April 20" }).success, false);
});

test("dashboard API applies one filter to every dataset and preserves payout samples", async () => {
  assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI in backend/.env before running tests");
  const client = new MongoClient(process.env.MONGODB_URI);
  const databaseName = `delivery_geo_intelligence_dashboard_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  let server;
  let connected = false;
  try {
    await client.connect();
    connected = true;
    const db = client.db(databaseName);
    const merchantRows = [
      { _id: new ObjectId(), name: "Synthetic Restaurant A", category: "restaurant", city: "Test City", location: { type: "Point", coordinates: [0, 0] } },
      { _id: new ObjectId(), name: "Synthetic Grocery B", category: "grocery", city: "Test City", location: { type: "Point", coordinates: [1, 1] } },
      { _id: new ObjectId(), name: "Synthetic Restaurant C", category: "restaurant", city: "Test City", location: { type: "Point", coordinates: [2, 2] } },
      { _id: new ObjectId(), name: "Synthetic Retail D", category: "retail", city: "Test City", location: { type: "Point", coordinates: [3, 3] } }
    ];
    await db.collection("merchants").insertMany(merchantRows);
    const delivery = (merchantIndex, day, payout, destinationLocation) => ({
      _id: new ObjectId(), merchantId: merchantRows[merchantIndex]._id,
      pickedUpAt: new Date(`2026-04-${String(day).padStart(2, "0")}T17:00:00Z`),
      ...(payout === undefined ? {} : { payout }),
      ...(destinationLocation ? { destinationLocation: { type: "Point", coordinates: destinationLocation } } : {})
    });
    await db.collection("deliveries").insertMany([
      delivery(0, 20, 10, [0.1, 0.2]), delivery(0, 21, undefined, [0.1, 0.2]), delivery(0, 22, 0),
      delivery(1, 23, 30, [0.3, 0.4]), delivery(1, 24, 20),
      delivery(2, 25, undefined), delivery(3, 25, undefined), delivery(1, 27, 100)
    ]);
    server = createApp(db, async () => { throw new Error("Geocoding should not run"); }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    async function dashboard(query) {
      const response = await fetch(`${base}/api/dashboard?${query}`);
      return { status: response.status, body: await response.json() };
    }

    const all = await dashboard("period=week&category=all&asOf=2026-04-20");
    assert.equal(all.status, 200);
    const { summary, map, categoryDistribution, pickupTimeline, topMerchants } = all.body;
    assert.deepEqual(all.body.filters.range.startDate, "2026-04-20");
    assert.equal(summary.totalDeliveries, 7);
    assert.equal(summary.uniqueMerchants, 4);
    assert.equal(summary.observedDestinationAreas, 2);
    assert.deepEqual(summary.totalEarnings, { value: 60, sampleCount: 4 });
    assert.equal(summary.topMerchantByOrders.name, "Synthetic Restaurant A");
    assert.equal(summary.topMerchantByTotalEarnings.name, "Synthetic Grocery B");
    assert.equal(summary.topMerchantByTotalEarnings.totalEarnings, 50);
    assert.equal(summary.topMerchantByAverageEarnings.averageEarnings, 25);
    assert.equal(summary.topMerchantByAverageEarnings.sampleCount, 2);
    assert.deepEqual(topMerchants.map((row) => row.deliveries), [3, 2, 1, 1]);
    assert.deepEqual(topMerchants.find((row) => row.name === "Synthetic Restaurant A"), {
      id: merchantRows[0]._id.toHexString(), name: "Synthetic Restaurant A", category: "restaurant", city: "Test City",
      deliveries: 3, totalEarnings: 10, averageEarnings: 5, sampleCount: 2
    });
    assert.equal(categoryDistribution.reduce((sum, row) => sum + row.deliveries, 0), summary.totalDeliveries);
    assert.equal(pickupTimeline.reduce((sum, row) => sum + row.deliveries, 0), summary.totalDeliveries);
    assert.equal(map.pickupVolume.reduce((sum, row) => sum + row.deliveries, 0), summary.totalDeliveries);
    assert.equal(map.merchantDiversity.reduce((sum, row) => sum + row.deliveries, 0), summary.totalDeliveries);
    assert.equal(map.destinationHeatmap.reduce((sum, row) => sum + row.count, 0), 3);
    assert.equal(map.destinationHeatmap.length, summary.observedDestinationAreas);

    const grocery = (await dashboard("period=week&category=grocery&asOf=2026-04-20")).body;
    assert.equal(grocery.summary.totalDeliveries, 2);
    assert.equal(grocery.summary.uniqueMerchants, 1);
    assert.deepEqual(grocery.summary.totalEarnings, { value: 50, sampleCount: 2 });
    assert.equal(grocery.categoryDistribution.find((row) => row.category === "restaurant").deliveries, 0);
    assert.equal(grocery.map.pickupVolume.length, 1);
    assert.equal(grocery.map.merchantDiversity.length, 1);
    assert.equal(grocery.map.destinationHeatmap.length, 1);
    assert.equal(grocery.pickupTimeline.reduce((sum, row) => sum + row.deliveries, 0), 2);
    assert.equal(grocery.topMerchants.length, 1);

    const retail = (await dashboard("period=week&category=retail&asOf=2026-04-20")).body;
    assert.deepEqual(retail.summary.totalEarnings, { value: null, sampleCount: 0 });
    assert.equal(retail.summary.topMerchantByTotalEarnings, null);
    assert.equal(retail.summary.topMerchantByAverageEarnings, null);
    assert.equal(retail.topMerchants[0].totalEarnings, null);
    assert.equal(retail.topMerchants[0].averageEarnings, null);

    const month = (await dashboard("period=month&category=all&asOf=2026-04-20")).body;
    assert.equal(month.summary.totalDeliveries, 8);
    assert.equal(month.pickupTimeline.length, 30);
    const year = (await dashboard("period=year&category=all&asOf=2026-04-20")).body;
    assert.equal(year.pickupTimeline.length, 12);
    assert.equal((await dashboard("period=day")).status, 400);
    assert.equal((await dashboard("category=invalid")).status, 400);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) await client.db(databaseName).dropDatabase();
    await client.close();
  }
});
