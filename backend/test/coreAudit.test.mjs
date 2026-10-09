import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { MongoClient, ObjectId } from "mongodb";
import { createApp } from "../dist/app.js";
import { resolveCoverageDates, resolveDashboardFilters, getDashboardAnalytics } from "../dist/dashboard.js";
import { calculateSettlementEfficiency } from "../dist/settlementEfficiency.js";
import { deliveryInputSchema, deliveryPatchSchema } from "../dist/model.js";

test("early ISO years retain their century and inclusive coverage boundaries", () => {
  const range = resolveCoverageDates("0099-12-31", "0100-01-01");
  assert.equal(range.start.getUTCFullYear(), 99); assert.equal(range.endExclusive.getUTCFullYear(), 100);
  assert.equal((range.endExclusive - range.start) / 3600000, 48);
  assert.equal(resolveDashboardFilters({ period: "month", category: "all", asOf: "0099-12-31" }).startDate, "0099-12-01");
});
test("unsafe payouts are rejected while zero and optional clearing remain valid", () => {
  const base = { merchantId: new ObjectId().toHexString(), pickedUpAt: "2026-03-08T09:00:00Z" };
  assert.equal(deliveryInputSchema.safeParse({ ...base, payout: 1e308 }).success, false);
  assert.equal(deliveryPatchSchema.safeParse({ payout: 1e308 }).success, false);
  assert.equal(deliveryInputSchema.parse({ ...base, payout: 0 }).payout, 0);
  assert.equal(deliveryPatchSchema.parse({ payout: null }).payout, null);
});
test("injected write failures, read isolation and concurrent PATCH integrity", async (t) => {
  const client = new MongoClient(process.env.MONGODB_URI), db = client.db(`dgi_core_audit_test_${randomBytes(6).toString("hex")}`);
  let connected = false, server, inject = null;
  const proxy = new Proxy(db, { get(target, key) {
    if (key !== "collection") return typeof target[key] === "function" ? target[key].bind(target) : target[key];
    return (name) => new Proxy(target.collection(name), { get(collection, method) {
      if (!["updateMany", "deleteOne", "replaceOne"].includes(method)) return typeof collection[method] === "function" ? collection[method].bind(collection) : collection[method];
      return async (...args) => {
        if (inject && await inject(name, method, args, collection)) throw new Error("Synthetic private driver failure");
        return collection[method](...args);
      };
    } });
  } });
  try {
    await client.connect(); connected = true;
    const merchantId = new ObjectId();
    await db.collection("merchants").insertOne({ _id: merchantId, name: "Synthetic Pickup", category: "restaurant", city: "Test", location: { type: "Point", coordinates: [0, 0] } });
    const profile = { _id: "primary", vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 800, expectedTireSetLifeMiles: 20000, marginalDepreciationCostPerMile: 0.05 };
    await db.collection("vehicleEconomics").insertOne(profile);
    const payment = { _id: new ObjectId(), type: "prop22_guarantee", paymentDate: "2026-03-20", amount: 24.17, coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14", sessionCoverageConfirmed: true };
    await db.collection("earningsAdjustments").insertOne(payment);
    const row = { _id: new ObjectId(), startedAt: new Date("2026-03-08T09:00:00Z"), endedAt: new Date("2026-03-08T10:00:00Z"), totalDrivenMiles: 10, notes: "Synthetic original" };
    const original = { _id: new ObjectId(), merchantId, pickedUpAt: row.startedAt, payout: 10, sessionId: row._id };
    const candidates = [20, 30].map((payout) => ({ _id: new ObjectId(), merchantId, pickedUpAt: row.startedAt, payout }));
    await db.collection("deliverySessions").insertOne(row); await db.collection("deliveries").insertMany([original, ...candidates]);
    const fail = async () => { throw new Error("External services must not run"); };
    server = createApp(proxy, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    const api = async (path, method = "GET", body) => {
      const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    };
    const path = `/api/delivery-sessions/${row._id}`;
    await t.test("partial replacement failure restores fields and all previous links", async () => {
      inject = async (name, method, args, collection) => {
        if (name === "deliveries" && method === "updateMany" && args[1].$set) {
          inject = null; await collection.updateOne({ _id: candidates[0]._id }, args[1]); return true;
        }
      };
      const r = await api(path, "PATCH", { notes: "Synthetic changed", deliveryIds: candidates.map((d) => d._id.toHexString()) });
      assert.equal(r.status, 500); assert.deepEqual(r.body, { error: "Internal server error" });
      assert.deepEqual(await db.collection("deliverySessions").findOne({ _id: row._id }), row);
      assert.deepEqual(await db.collection("deliveries").find().sort({ payout: 1 }).toArray(), [original, ...candidates]);
    });
    await t.test("failed create and ambiguous delete recover without orphan references", async () => {
      inject = async (name, method, args) => { if (name === "deliveries" && method === "updateMany" && args[1].$set) { inject = null; return true; } };
      assert.equal((await api("/api/delivery-sessions", "POST", { startedAt: row.startedAt.toISOString(), endedAt: row.endedAt.toISOString(), deliveryIds: [candidates[0]._id.toHexString()] })).status, 500);
      assert.equal(await db.collection("deliverySessions").countDocuments(), 1);
      inject = async (name, method, args, collection) => {
        if (name === "deliverySessions" && method === "deleteOne") { inject = null; await collection.deleteOne(...args); return true; }
      };
      assert.equal((await api(path, "DELETE")).status, 500);
      assert.deepEqual(await db.collection("deliverySessions").findOne({ _id: row._id }), row);
      assert.deepEqual(await db.collection("deliveries").findOne({ _id: original._id }), original);
    });
    await t.test("failed compensation leaves a durable guard and requires explicit reviewed membership", async () => {
      let stage = 0;
      inject = async (name, method, args, collection) => {
        if (name === "deliveries" && method === "updateMany" && args[1].$set && stage === 0) { stage = 1; await collection.updateOne({ _id: candidates[0]._id }, args[1]); return true; }
        if (name === "deliveries" && method === "updateMany" && args[1].$unset && stage === 1) { inject = null; return true; }
      };
      assert.equal((await api(path, "PATCH", { deliveryIds: candidates.map((d) => d._id.toHexString()) })).status, 500);
      assert.equal((await api(path)).body.data.associationIntegrity, "pending");
      const core = (await api("/api/efficiency?period=month&asOf=2026-03-08")).body;
      assert.equal(core.sessionEfficiency.payoutPerSessionHour.value, null); assert.equal(core.dataQuality.sessionsWithIncompleteAssociations, 1);
      const settlement = (await api("/api/efficiency/settlements")).body.data[0];
      assert.equal(settlement.adjustedEarningsPerHour, null); assert.ok(settlement.reasons.includes("incomplete_session_associations"));
      const markerOnly = calculateSettlementEfficiency(payment, [payment], [original], [{ ...row, associationIntegrity: "pending" }], profile);
      assert.equal(markerOnly.adjustedEarningsPerHour, null);
      assert.equal((await api(path, "PATCH", { notes: "Synthetic repair" })).status, 409);
      const repair = await api(path, "PATCH", { deliveryIds: [original, ...candidates].map((d) => d._id.toHexString()) });
      assert.equal(repair.status, 200); assert.equal(repair.body.data.associationIntegrity, undefined);
      assert.equal((await api("/api/efficiency/settlements")).body.data[0].status, "ready");
    });
    await t.test("analytics wait for association writes rather than observing intermediate links", async () => {
      let started, release, received;
      const reached = new Promise((r) => { started = r; }), gate = new Promise((r) => { release = r; });
      inject = async (name, method, args) => { if (name === "deliveries" && method === "updateMany" && args[1].$set) { inject = null; started(); await gate; } };
      const write = api(path, "PATCH", { deliveryIds: [original._id.toHexString()] }); await reached;
      const incoming = new Promise((r) => { received = r; });
      server.on("request", function observe(request) { if (request.url?.startsWith("/api/efficiency?")) { server.off("request", observe); received(); } });
      let responded = false; const read = api("/api/efficiency?period=month&asOf=2026-03-08").then((r) => { responded = true; return r; });
      try { await incoming; assert.equal(responded, false); } finally { release(); }
      assert.equal((await write).status, 200); assert.equal((await read).body.sessionEfficiency.knownPayoutTotal.value, 10);
    });
    await t.test("concurrent partial date PATCHes cannot persist reversed coverage", async () => {
      const p = `/api/earnings-adjustments/${payment._id}`;
      const results = await Promise.all([api(p, "PATCH", { coverageStartDate: "2026-03-10" }), api(p, "PATCH", { coverageEndDate: "2026-03-05" })]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      const stored = await db.collection("earningsAdjustments").findOne({ _id: payment._id });
      assert.ok(stored.coverageStartDate <= stored.coverageEndDate); assert.equal(stored.amount, 24.17); assert.equal(stored.sessionCoverageConfirmed, true);
    });
    await t.test("legacy monetary overflow is unavailable, never fabricated partial cash income", async () => {
      await db.collection("deliveries").updateMany({}, { $set: { payout: 1e308 } });
      const filters = { period: "month", category: "all", asOf: "2026-03-08" };
      const data = await getDashboardAnalytics(db, filters);
      assert.equal(data.summary.totalEarnings.value, null); assert.equal(data.summary.totalEarnings.deliveryEarnings, null);
      assert.equal(data.summary.totalEarnings.prop22Earnings, 24.17);
      assert.equal(data.summary.topMerchantByTotalEarnings, null); assert.equal(data.summary.topMerchantByAverageEarnings, null);
      await db.collection("earningsAdjustments").updateOne({ _id: payment._id }, { $set: { amount: 1e308 } });
      assert.equal((await getDashboardAnalytics(db, filters)).summary.totalEarnings.prop22Earnings, null);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    try { if (connected) await db.dropDatabase(); } finally { await client.close(); }
  }
});
