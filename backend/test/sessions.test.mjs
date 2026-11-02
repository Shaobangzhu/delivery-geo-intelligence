import { testMongoUri, TestMongoClient as MongoClient } from "./support/environment.mjs";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import test from "./support/scoped-test.mjs";
import { ObjectId } from "mongodb";
import { createApp } from "../dist/app.js";
import { ensureIndexes } from "../dist/db.js";
import { sessionCreateSchema, sessionPatchSchema, vehicleProfileSchema, annualMileageSchema } from "../dist/sessionModel.js";
import { calculateVehicleCost, annualMileageResponse } from "../dist/vehicleEconomics.js";

test("session schemas validate offset instants, order, strategies, independent unknown/zero mileage, and links", () => {
  const base = { startedAt: "2026-03-07T23:30:00-08:00", endedAt: "2026-03-08T03:30:00-07:00" };
  assert.equal(sessionCreateSchema.safeParse(base).success, true);
  assert.equal(sessionCreateSchema.parse({ ...base, totalDrivenMiles: 0 }).totalDrivenMiles, 0);
  assert.equal(Object.hasOwn(sessionCreateSchema.parse(base), "taxEligibleBusinessMiles"), false);
  for (const bad of [{ startedAt: "2026-03-07T23:30:00" }, { endedAt: base.startedAt },
    { endedAt: "2026-03-07T23:00:00-08:00" }, { strategy: "marathon" }, { totalDrivenMiles: -1 },
    { taxEligibleBusinessMiles: Infinity }, { totalDrivenMiles: 2, taxEligibleBusinessMiles: 3 },
    { sessionDurationSeconds: 99 }, { deliveryIds: ["bad"] }, { notes: "x".repeat(2001) }]) {
    assert.equal(sessionCreateSchema.safeParse({ ...base, ...bad }).success, false);
  }
  const id = new ObjectId().toHexString();
  assert.equal(sessionCreateSchema.safeParse({ ...base, deliveryIds: [id, id.toUpperCase()] }).success, false);
  assert.equal(sessionPatchSchema.safeParse({ strategy: null, totalDrivenMiles: null, taxEligibleBusinessMiles: null, notes: null }).success, true);
  assert.equal(sessionPatchSchema.safeParse({}).success, false);
  for (const strategy of ["wide_area_marathon", "home_based_multi_order", "eastvale_local_only", "other"]) {
    assert.equal(sessionCreateSchema.safeParse({ ...base, strategy }).success, true);
  }
});

test("session offer schemas accept only known platforms with finite nonnegative safe integer counts", () => {
  const base = { startedAt: "2026-03-08T08:00:00Z", endedAt: "2026-03-08T09:00:00Z" };
  for (const platform of ["uber_eats", "doordash"]) {
    for (const count of [0, 3, Number.MAX_SAFE_INTEGER]) {
      const tripsOfferedByPlatform = { [platform]: count };
      assert.deepEqual(sessionCreateSchema.parse({ ...base, tripsOfferedByPlatform }).tripsOfferedByPlatform, tripsOfferedByPlatform);
      assert.deepEqual(sessionPatchSchema.parse({ tripsOfferedByPlatform }).tripsOfferedByPlatform, tripsOfferedByPlatform);
    }
    for (const count of ["3", 1.5, -1, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, -Infinity, true, {}, []]) {
      const tripsOfferedByPlatform = { [platform]: count };
      assert.equal(sessionCreateSchema.safeParse({ ...base, tripsOfferedByPlatform }).success, false);
      assert.equal(sessionPatchSchema.safeParse({ tripsOfferedByPlatform }).success, false);
    }
    assert.equal(sessionCreateSchema.safeParse({ ...base, tripsOfferedByPlatform: { [platform]: null } }).success, false);
    assert.equal(sessionPatchSchema.safeParse({ tripsOfferedByPlatform: { [platform]: null } }).success, true);
  }
  for (const tripsOfferedByPlatform of [{ unknown: 1 }, { uber_eats: 3, unknown: null }, { UberEats: 3 }, [], "3", 3]) {
    assert.equal(sessionCreateSchema.safeParse({ ...base, tripsOfferedByPlatform }).success, false);
    assert.equal(sessionPatchSchema.safeParse({ tripsOfferedByPlatform }).success, false);
  }
  assert.equal(sessionCreateSchema.safeParse({ ...base, tripsOfferedByPlatform: null }).success, false);
  assert.equal(sessionPatchSchema.safeParse({ tripsOfferedByPlatform: null }).success, true);
  assert.equal(sessionCreateSchema.safeParse({ ...base, tripsOfferedByPlatform: {}, unknown: 1 }).success, false);
  assert.equal(sessionPatchSchema.safeParse({ tripsOfferedByPlatform: {}, unknown: 1 }).success, false);
});

test("vehicle cost separates known zero from unknown estimates, and handles partial/complete costs safely", () => {
  const base = { vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 800 };
  const missing = calculateVehicleCost(base, 8.4);
  assert.equal(missing.amounts.energy, 0); assert.equal(missing.amounts.tireWear, null);
  assert.equal(missing.amounts.depreciation, null); assert.equal(missing.knownAndEstimatedCost, 0);
  assert.equal(missing.fullEconomicCost, null); assert.equal(missing.completeness, "partial");
  const partial = calculateVehicleCost({ ...base, expectedTireSetLifeMiles: 20000 }, 8.4);
  assert.equal(partial.rates.tireWear, 0.04); assert.equal(partial.amounts.tireWear, 0.34);
  assert.equal(partial.knownAndEstimatedCost, 0.34); assert.equal(partial.fullEconomicCost, null);
  const complete = calculateVehicleCost({ ...base, expectedTireSetLifeMiles: 20000, marginalDepreciationCostPerMile: 0.05 }, 8.4);
  assert.equal(complete.amounts.depreciation, 0.42); assert.equal(complete.fullEconomicCost, 0.76); assert.equal(complete.completeness, "complete");
  assert.equal(calculateVehicleCost({ ...base, expectedTireSetLifeMiles: 20000, marginalDepreciationCostPerMile: 0 }, 0).fullEconomicCost, 0);
  assert.equal(calculateVehicleCost(base).knownAndEstimatedCost, null);
  assert.equal(calculateVehicleCost(null, 8).completeness, "unavailable");
  assert.equal(calculateVehicleCost({ ...base, energyCashCostPerMile: 1e308 }, 1e308).amounts.energy, null);
  for (const bad of [{ expectedTireSetLifeMiles: 0 }, { expectedTireSetLifeMiles: -1 }, { expectedTireSetLifeMiles: 1e-320 }, { marginalDepreciationCostPerMile: -1 }, { tireReplacementSetCost: -1 }]) {
    assert.equal(vehicleProfileSchema.safeParse({ ...base, ...bad }).success, false);
  }
});

test("annual accounting derives one business total, preserves missing categories, and uses only applicable historical tax rates", () => {
  const base = { totalVehicleMiles: 1000, uberEatsBusinessMiles: 400, realtorBusinessMiles: 0, otherBusinessMiles: 0, taxMethod: "standard_mileage" };
  const row = annualMileageResponse({ _id: 2024, taxYear: 2024, ...base });
  assert.equal(row.reportedBusinessMiles, 400); assert.equal(row.businessUsePercentage, 40);
  assert.equal(row.standardMileage.estimatedDeduction, 268);
  assert.equal(annualMileageResponse({ _id: 2025, taxYear: 2025, ...base }).standardMileage.estimatedDeduction, 280);
  assert.equal(annualMileageResponse({ _id: 2026, taxYear: 2026, ...base }).standardMileage.estimatedDeduction, null);
  const { realtorBusinessMiles: _ignored, ...incomplete } = base;
  const unknown = annualMileageResponse({ _id: 2026, taxYear: 2026, ...incomplete });
  assert.equal(unknown.knownBusinessMiles, 400); assert.equal(unknown.reportedBusinessMiles, null); assert.equal(unknown.businessUsePercentage, null);
  assert.equal(annualMileageResponse({ _id: 2024, taxYear: 2024, ...base, totalVehicleMiles: 0, uberEatsBusinessMiles: 0 }).businessUsePercentage, null);
  assert.equal(annualMileageSchema.safeParse({ ...base, realtorBusinessMiles: 700 }).success, false);
  assert.equal(annualMileageSchema.safeParse({ ...base, taxMethod: "actual_expenses" }).success, false);
});

test.integration("sessions, associations, vehicle settings, and annual mileage against isolated MongoDB", async (t) => {
  const client = new MongoClient(testMongoUri);
  const name = `delivery_geo_intelligence_sessions_test_${process.pid}_${randomBytes(5).toString("hex")}`;
  let server; let connected = false;
  try {
    await client.connect(); connected = true;
    const db = client.db(name); await ensureIndexes(db);
    const fail = async () => { throw new Error("External geocoding must not run in this test"); };
    server = createApp(db, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    async function api(method, path, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    const merchantId = new ObjectId();
    await db.collection("merchants").insertOne({ _id: merchantId, name: "Synthetic Pickup", category: "restaurant", city: "Test City", location: { type: "Point", coordinates: [0, 0] } });
    const delivery = { _id: new ObjectId(), merchantId, pickedUpAt: new Date("2026-03-08T08:00:00Z"), payout: 10,
      distanceMiles: 2, deliveryDurationSeconds: 900, destinationLocation: { type: "Point", coordinates: [0.1, 0.2] } };
    await db.collection("deliveries").insertOne(delivery);
    await db.collection("earningsAdjustments").insertOne({ type: "prop22_guarantee", paymentDate: "2026-03-08", amount: 24.17,
      settlementDetails: { reportedGuaranteedAmount: 124.17, eligibleEarningsExcludingTips: 100 } });
    const baseline = (await api("GET", "/api/dashboard?period=month&asOf=2026-03-08")).body;
    const propId = (await api("GET", "/api/earnings-adjustments")).body.data[0].id;
    const propBefore = (await api("GET", `/api/earnings-adjustments/${propId}`)).body;
    assert.equal((await api("GET", "/api/deliveries")).body.data[0].sessionId, undefined);
    const base = { startedAt: "2026-03-07T23:30:00-08:00", endedAt: "2026-03-08T03:30:00-07:00", totalDrivenMiles: 8.4 };
    let first;
    await t.test("session CRUD derives elapsed duration across midnight/DST, preserves optional mileage, and validates merged edits", async () => {
      first = await api("POST", "/api/delivery-sessions", { ...base, strategy: "eastvale_local_only", notes: " Synthetic session " });
      assert.equal(first.status, 201); assert.equal(first.body.data.startedAt, "2026-03-08T07:30:00.000Z");
      assert.equal(first.body.data.sessionDurationSeconds, 10800);
      assert.equal(first.body.data.notes, "Synthetic session");
      const path = `/api/delivery-sessions/${first.body.data.id}`;
      const persisted = await db.collection("deliverySessions").findOne({ _id: new ObjectId(first.body.data.id) });
      assert.ok(persisted.startedAt instanceof Date); assert.equal(Object.hasOwn(persisted, "sessionDurationSeconds"), false);
      assert.equal((await api("GET", path)).body.data.taxEligibleBusinessMiles, undefined);
      assert.equal((await api("PATCH", path, { taxEligibleBusinessMiles: 9 })).status, 400);
      assert.equal((await api("PATCH", path, { endedAt: "2026-03-07T20:00:00-08:00" })).status, 400);
      const zero = await api("PATCH", path, { totalDrivenMiles: 0, taxEligibleBusinessMiles: 0 });
      assert.equal(zero.body.data.totalDrivenMiles, 0); assert.equal(zero.body.data.taxEligibleBusinessMiles, 0);
      const cleared = await api("PATCH", path, { totalDrivenMiles: null, taxEligibleBusinessMiles: null, strategy: null, notes: null });
      for (const field of ["totalDrivenMiles", "taxEligibleBusinessMiles", "strategy", "notes"]) assert.equal(Object.hasOwn(cleared.body.data, field), false);
      assert.equal((await api("PATCH", path, { totalDrivenMiles: 8.4 })).status, 200);
      for (const method of ["GET", "PATCH", "DELETE"]) {
        assert.equal((await api(method, "/api/delivery-sessions/bad", method === "PATCH" ? { notes: "test" } : undefined)).status, 400);
        assert.equal((await api(method, `/api/delivery-sessions/${new ObjectId()}`, method === "PATCH" ? { notes: "test" } : undefined)).status, 404);
      }
    });
    await t.test("explicit links are exclusive, preserve delivery facts, and survive normal edits", async () => {
      const path = `/api/delivery-sessions/${first.body.data.id}`;
      const linked = await api("PATCH", path, { deliveryIds: [delivery._id.toHexString()] });
      assert.deepEqual(linked.body.data.deliveryIds, [delivery._id.toHexString()]);
      const second = await api("POST", "/api/delivery-sessions", { ...base, startedAt: "2026-03-09T09:00:00-07:00", endedAt: "2026-03-09T10:00:00-07:00" });
      assert.equal((await api("GET", "/api/delivery-sessions")).body.data[0].id, second.body.data.id);
      assert.equal((await api("PATCH", `/api/delivery-sessions/${second.body.data.id}`, { deliveryIds: [delivery._id.toHexString()] })).status, 409);
      assert.equal((await api("POST", "/api/delivery-sessions", { ...base, deliveryIds: [new ObjectId().toHexString()] })).status, 422);
      const unchanged = await api("PATCH", path, { startedAt: "2026-03-07T22:30:00-08:00" });
      assert.deepEqual(unchanged.body.data.deliveryIds, [delivery._id.toHexString()]);
      const { sessionId, ...facts } = await db.collection("deliveries").findOne({ _id: delivery._id });
      assert.equal(sessionId.toHexString(), first.body.data.id); assert.deepEqual(facts, delivery);
      assert.equal((await api("GET", `/api/deliveries/${delivery._id}`)).body.data.sessionId, first.body.data.id);
      assert.equal((await api("DELETE", path)).status, 204);
      assert.deepEqual(await db.collection("deliveries").findOne({ _id: delivery._id }), delivery);
      const other = await api("PATCH", `/api/delivery-sessions/${second.body.data.id}`, { deliveryIds: [delivery._id.toHexString()] });
      assert.equal(other.status, 200);
      assert.equal((await api("DELETE", `/api/deliveries/${delivery._id}`)).status, 204);
      assert.deepEqual((await api("GET", `/api/delivery-sessions/${second.body.data.id}`)).body.data.deliveryIds, []);
      await db.collection("deliveries").insertOne(delivery);
    });
    await t.test("concurrent session claims allow only one owner and invalid replacements keep previous links", async () => {
      const contenders = await Promise.all([api("POST", "/api/delivery-sessions", base), api("POST", "/api/delivery-sessions", base)]);
      const claims = await Promise.all(contenders.map((row) => api("PATCH", `/api/delivery-sessions/${row.body.data.id}`, { deliveryIds: [delivery._id.toHexString()] })));
      assert.deepEqual(claims.map((row) => row.status).sort(), [200, 409]);
      const winner = contenders[claims.findIndex((row) => row.status === 200)].body.data.id;
      assert.equal((await api("PATCH", `/api/delivery-sessions/${winner}`, { deliveryIds: [new ObjectId().toHexString()] })).status, 422);
      assert.deepEqual((await api("GET", `/api/delivery-sessions/${winner}`)).body.data.deliveryIds, [delivery._id.toHexString()]);
      assert.deepEqual((await api("PATCH", `/api/delivery-sessions/${winner}`, { deliveryIds: [] })).body.data.deliveryIds, []);
    });
    await t.test("idempotent initialization persists confirmed profile/history without overwriting user settings", async () => {
      assert.equal((await api("GET", "/api/vehicle-economics")).body.data, null);
      const initialized = await api("POST", "/api/vehicle-economics/initialize");
      assert.deepEqual(initialized.body.data, { vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 1600 });
      const year2024 = initialized.body.historicalMileage.find((row) => row.taxYear === 2024);
      const year2025 = initialized.body.historicalMileage.find((row) => row.taxYear === 2025);
      assert.equal(year2024.totalVehicleMiles, 13350); assert.equal(year2024.uberEatsBusinessMiles, 5737);
      assert.equal(year2024.realtorBusinessMiles, 0); assert.equal(year2024.otherBusinessMiles, 0);
      assert.equal(year2024.businessUsePercentage.toFixed(2), "42.97");
      assert.equal(year2024.standardMileage.estimatedDeduction, 3843.79);
      assert.equal(year2025.totalVehicleMiles, 11549); assert.equal(year2025.uberEatsBusinessMiles, 2310);
      assert.equal(year2025.businessUsePercentage.toFixed(2), "20.00"); assert.equal(year2025.standardMileage.estimatedDeduction, 1617);
      for (const body of [{ expectedTireSetLifeMiles: 0 }, { tireReplacementSetCost: -1 }, { marginalDepreciationCostPerMile: -1 }]) assert.equal((await api("PATCH", "/api/vehicle-economics", body)).status, 400);
      const updated = await api("PATCH", "/api/vehicle-economics", { tireReplacementSetCost: 800, expectedTireSetLifeMiles: 20000 });
      assert.equal(updated.body.data.energyCashCostPerMile, 0);
      assert.equal(updated.body.data.marginalDepreciationCostPerMile, undefined);
      await api("POST", "/api/vehicle-economics/initialize");
      assert.equal((await api("GET", "/api/vehicle-economics")).body.data.tireReplacementSetCost, 800);
      assert.equal(await db.collection("vehicleEconomics").countDocuments(), 1);
      assert.equal(await db.collection("vehicleTaxYears").countDocuments(), 2);
      const cost = (await api("GET", "/api/delivery-sessions")).body.data.find((row) => row.totalDrivenMiles === 8.4).vehicleCost;
      assert.equal(cost.amounts.energy, 0); assert.equal(cost.amounts.tireWear, 0.34); assert.equal(cost.fullEconomicCost, null);
      await api("PATCH", "/api/vehicle-economics", { marginalDepreciationCostPerMile: 0.05 });
      assert.equal((await api("GET", "/api/delivery-sessions")).body.data.find((row) => row.totalDrivenMiles === 8.4).vehicleCost.fullEconomicCost, 0.76);
      await api("PATCH", "/api/vehicle-economics", { expectedTireSetLifeMiles: null, marginalDepreciationCostPerMile: null });
      assert.equal((await api("GET", "/api/vehicle-economics")).body.data.expectedTireSetLifeMiles, undefined);
    });
    await t.test("annual creation/editing respects purpose totals, unknown future categories, and historical initialization", async () => {
      const record = { totalVehicleMiles: 1000, uberEatsBusinessMiles: 400, taxMethod: "standard_mileage" };
      const future = await api("PUT", "/api/vehicle-mileage/2026", record);
      assert.equal(future.status, 201); assert.equal(future.body.data.realtorBusinessMiles, undefined);
      assert.equal(future.body.data.reportedBusinessMiles, null); assert.equal(future.body.data.standardMileage.rate, null);
      assert.equal((await api("PUT", "/api/vehicle-mileage/2024", { ...record, realtorBusinessMiles: 0, otherBusinessMiles: 0 })).status, 200);
      await api("POST", "/api/vehicle-economics/initialize");
      assert.equal((await api("GET", "/api/vehicle-economics")).body.historicalMileage.find((row) => row.taxYear === 2024).uberEatsBusinessMiles, 400);
      assert.equal((await api("PUT", "/api/vehicle-mileage/2026", { ...record, realtorBusinessMiles: 700 })).status, 400);
      assert.equal((await api("PUT", "/api/vehicle-mileage/bad", record)).status, 400);
    });
    assert.deepEqual((await api("GET", "/api/dashboard?period=month&asOf=2026-03-08")).body, baseline);
    assert.deepEqual((await api("GET", `/api/earnings-adjustments/${propId}`)).body, propBefore);
    assert.deepEqual(await db.collection("deliveries").findOne({ _id: delivery._id }), delivery);
    assert.ok((await db.collection("deliveries").indexes()).some((index) => index.key.sessionId === 1));
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) await client.db(name).dropDatabase();
    await client.close();
  }
});

test.integration("manual Session platform offers persist independently of associations and calculations", async (t) => {
  const client = new MongoClient(testMongoUri);
  const name = `delivery_geo_intelligence_session_offers_test_${process.pid}_${randomBytes(5).toString("hex")}`;
  let server; let connected = false;
  try {
    await client.connect(); connected = true;
    const db = client.db(name); await ensureIndexes(db);
    const fail = async () => { throw new Error("External geocoding must not run in this test"); };
    server = createApp(db, fail, fail).listen(0, "127.0.0.1"); await once(server, "listening");
    async function api(method, path, body) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method,
        ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }
    const sessions = db.collection("deliverySessions");
    const base = { startedAt: "2026-03-08T08:00:00Z", endedAt: "2026-03-08T09:00:00Z" };
    const path = (id) => `/api/delivery-sessions/${id}`;
    const stored = (id) => sessions.findOne({ _id: new ObjectId(id) });
    async function create(fields = {}) {
      const result = await api("POST", "/api/delivery-sessions", { ...base, ...fields });
      assert.equal(result.status, 201);
      return result.body.data;
    }
    async function assertCounts(id, expected) {
      const detail = await api("GET", path(id));
      const list = await api("GET", "/api/delivery-sessions");
      assert.equal(detail.status, 200); assert.equal(list.status, 200);
      for (const row of [detail.body.data, list.body.data.find((row) => row.id === String(id)), await stored(id)]) {
        if (expected === undefined) assert.equal(Object.hasOwn(row, "tripsOfferedByPlatform"), false);
        else assert.deepEqual(row.tripsOfferedByPlatform, expected);
      }
    }
    await t.test("POST and GET detail/list round trip each platform independently", async () => {
      for (const tripsOfferedByPlatform of [{ uber_eats: 3 }, { doordash: 4 }]) {
        const row = await create({ tripsOfferedByPlatform });
        assert.deepEqual(row.tripsOfferedByPlatform, tripsOfferedByPlatform);
        await assertCounts(row.id, tripsOfferedByPlatform);
      }
    });
    await t.test("both-platform counts and nonzero offers are valid with zero linked deliveries", async () => {
      const counts = { uber_eats: 3, doordash: 5 };
      const row = await create({ tripsOfferedByPlatform: counts, deliveryIds: [] });
      assert.deepEqual(row.deliveryIds, []); assert.deepEqual(row.linkedDeliveries, []);
      await assertCounts(row.id, counts);
      assert.equal(await db.collection("deliveries").countDocuments(), 0);
    });
    await t.test("zero is retained while missing counts and empty objects remain absent", async () => {
      for (const counts of [undefined, {}, { uber_eats: 0 }, { doordash: 0 }, { uber_eats: 0, doordash: 0 }]) {
        const row = await create(counts === undefined ? {} : { tripsOfferedByPlatform: counts });
        await assertCounts(row.id, counts && Object.keys(counts).length ? counts : undefined);
        assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: {} })).status, 200);
        await assertCounts(row.id, counts && Object.keys(counts).length ? counts : undefined);
      }
    });
    await t.test("PATCH merges platform keys, preserves omission, and serializes concurrent partial edits", async () => {
      const row = await create({ tripsOfferedByPlatform: { uber_eats: 3, doordash: 5 } });
      const zero = await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: 0 } });
      assert.equal(zero.status, 200); assert.deepEqual(zero.body.data.tripsOfferedByPlatform, { uber_eats: 0, doordash: 5 });
      assert.equal((await api("PATCH", path(row.id), { totalDrivenMiles: 8, strategy: "other" })).status, 200);
      await assertCounts(row.id, { uber_eats: 0, doordash: 5 });
      const results = await Promise.all([
        api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: 7 } }),
        api("PATCH", path(row.id), { tripsOfferedByPlatform: { doordash: 9 } })
      ]);
      assert.deepEqual(results.map((result) => result.status), [200, 200]);
      await assertCounts(row.id, { uber_eats: 7, doordash: 9 });
    });
    await t.test("PATCH clears one observation, the final observation, or the whole field without empty storage", async () => {
      const row = await create({ tripsOfferedByPlatform: { uber_eats: 3, doordash: 0 } });
      const cleared = await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: null } });
      assert.equal(cleared.status, 200); assert.deepEqual(cleared.body.data.tripsOfferedByPlatform, { doordash: 0 });
      await assertCounts(row.id, { doordash: 0 });
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { doordash: null } })).status, 200);
      await assertCounts(row.id, undefined);
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: null } })).status, 200);
      await assertCounts(row.id, undefined);
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: 0, doordash: 8 } })).status, 200);
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: null })).status, 200);
      await assertCounts(row.id, undefined);
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: 2, doordash: 3 } })).status, 200);
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: null, doordash: null } })).status, 200);
      await assertCounts(row.id, undefined);
    });
    await t.test("invalid POST/PATCH offers return 400 and leave persisted Sessions unchanged", async () => {
      const row = await create({ tripsOfferedByPlatform: { uber_eats: 3, doordash: 5 } });
      const before = await stored(row.id), count = await sessions.countDocuments();
      const badCounts = ["3", 1.5, -1, Number.MAX_SAFE_INTEGER + 1, true, {}, []];
      const invalid = ["3", 3, [], { unknown: 1 }, { uber_eats: 2, unknown: null }, { UberEats: 3 },
        ...["uber_eats", "doordash"].flatMap((platform) => badCounts.map((value) => ({ [platform]: value })))];
      for (const tripsOfferedByPlatform of invalid) {
        assert.equal((await api("POST", "/api/delivery-sessions", { ...base, tripsOfferedByPlatform })).status, 400);
        assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform })).status, 400);
      }
      for (const tripsOfferedByPlatform of [null, { uber_eats: null }, { doordash: null }]) {
        assert.equal((await api("POST", "/api/delivery-sessions", { ...base, tripsOfferedByPlatform })).status, 400);
      }
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: 1 }, associationIntegrity: "pending" })).status, 400);
      assert.equal(await sessions.countDocuments(), count);
      assert.deepEqual(await stored(row.id), before);
    });
    await t.test("legacy Sessions without offers stay valid without migration", async () => {
      const legacy = { _id: new ObjectId(), startedAt: new Date(base.startedAt), endedAt: new Date(base.endedAt), totalDrivenMiles: 8 };
      await sessions.insertOne(legacy);
      await assertCounts(legacy._id, undefined);
      assert.equal((await api("PATCH", path(legacy._id), { taxEligibleBusinessMiles: 0 })).status, 200);
      await assertCounts(legacy._id, undefined);
      assert.deepEqual(await stored(legacy._id), { ...legacy, taxEligibleBusinessMiles: 0 });
    });
    await t.test("legacy stored notes and all Session observations survive offer edits and clearing", async () => {
      const legacy = { _id: new ObjectId(), startedAt: new Date(base.startedAt), endedAt: new Date(base.endedAt),
        notes: "Historical Session notes\nKeep  internal spacing.", strategy: "other", totalDrivenMiles: 8, taxEligibleBusinessMiles: 0 };
      await sessions.insertOne(legacy);
      for (const tripsOfferedByPlatform of [{ uber_eats: 3 }, { doordash: 0 }, { uber_eats: null }, null]) {
        const result = await api("PATCH", path(legacy._id), { tripsOfferedByPlatform });
        assert.equal(result.status, 200); assert.equal(result.body.data.notes, legacy.notes);
        const { tripsOfferedByPlatform: _offers, ...fields } = await stored(legacy._id);
        assert.deepEqual(fields, legacy);
      }
      await assertCounts(legacy._id, undefined);
    });
    await t.test("offer edits preserve explicit links, mixed platform attribution, efficiency, and settlement results", async () => {
      const merchantId = new ObjectId();
      await db.collection("merchants").insertOne({ _id: merchantId, name: "Synthetic Offer Pickup", category: "restaurant", city: "Test City",
        location: { type: "Point", coordinates: [0, 0] } });
      const deliveries = ["uber_eats", "doordash"].map((platform) => ({ _id: new ObjectId(), merchantId, platform,
        pickedUpAt: new Date("2026-03-08T08:30:00Z"), payout: 10, distanceMiles: 2, deliveryDurationSeconds: 900, notes: "Keep Delivery notes" }));
      await db.collection("deliveries").insertMany(deliveries);
      const payment = { _id: new ObjectId(), platform: "uber_eats", type: "prop22_guarantee", paymentDate: "2026-03-10", amount: 5,
        coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14", sessionCoverageConfirmed: true, notes: "Keep Payment notes" };
      await db.collection("earningsAdjustments").insertOne(payment);
      const row = await create({ deliveryIds: deliveries.map((delivery) => delivery._id.toHexString()), totalDrivenMiles: 8 });
      await assertCounts(row.id, undefined); // Linked/completed work never supplies offers.
      const linkedBefore = await db.collection("deliveries").find().sort({ _id: 1 }).toArray();
      const routes = ["/api/efficiency?period=month&asOf=2026-03-08", "/api/efficiency/settlements", "/api/dashboard?period=month&asOf=2026-03-08"];
      const before = await Promise.all(routes.map((route) => api("GET", route)));
      assert.ok(before.every((result) => result.status === 200));
      assert.ok(before[1].body.data[0].reasons.includes("mixed_platform_session"));
      const updated = await api("PATCH", path(row.id), { tripsOfferedByPlatform: { uber_eats: 0, doordash: 99 } });
      assert.equal(updated.status, 200); assert.deepEqual(updated.body.data.deliveryIds.sort(), row.deliveryIds.sort());
      await assertCounts(row.id, { uber_eats: 0, doordash: 99 });
      assert.deepEqual(await Promise.all(routes.map((route) => api("GET", route))), before);
      assert.deepEqual(await db.collection("deliveries").find().sort({ _id: 1 }).toArray(), linkedBefore);
      assert.deepEqual(await db.collection("earningsAdjustments").findOne({ _id: payment._id }), payment);
      const unlinked = await api("PATCH", path(row.id), { deliveryIds: [] });
      assert.equal(unlinked.status, 200); assert.deepEqual(unlinked.body.data.deliveryIds, []);
      await assertCounts(row.id, { uber_eats: 0, doordash: 99 });
    });
    await t.test("pending association recovery still requires reviewed links when editing offers", async () => {
      const row = await create({ tripsOfferedByPlatform: { uber_eats: 3 } });
      await sessions.updateOne({ _id: new ObjectId(row.id) }, { $set: { associationIntegrity: "pending" } });
      const before = await stored(row.id);
      assert.equal((await api("PATCH", path(row.id), { tripsOfferedByPlatform: { doordash: 5 } })).status, 409);
      assert.deepEqual(await stored(row.id), before);
      const repaired = await api("PATCH", path(row.id), { deliveryIds: [], tripsOfferedByPlatform: { doordash: 5 } });
      assert.equal(repaired.status, 200); assert.equal(Object.hasOwn(repaired.body.data, "associationIntegrity"), false);
      await assertCounts(row.id, { uber_eats: 3, doordash: 5 });
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) await client.db(name).dropDatabase();
    await client.close();
  }
});
