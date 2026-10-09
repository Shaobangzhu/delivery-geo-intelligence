import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import { createApp } from "../dist/app.js";
import { deliveryInputSchema, deliveryPatchSchema } from "../dist/model.js";
import { ensureIndexes } from "../dist/db.js";
import { GeocodingError, generalizeCoordinates } from "../dist/geocoding.js";

test("duration schemas reject nonpositive, fractional, malformed, and nonfinite values", () => {
  const base = { merchantId: new ObjectId().toHexString(), pickedUpAt: "2026-04-01T10:00:00Z" };
  for (const value of [-1, 0, 1.5, NaN, Infinity, -Infinity, "41", {}, true]) {
    assert.equal(deliveryInputSchema.safeParse({ ...base, deliveryDurationSeconds: value }).success, false);
    assert.equal(deliveryPatchSchema.safeParse({ deliveryDurationSeconds: value }).success, false);
  }
  assert.equal(deliveryInputSchema.safeParse({ ...base, deliveryDurationSeconds: null }).success, false);
  assert.equal(deliveryPatchSchema.safeParse({ deliveryDurationSeconds: null }).success, true);
});

test("Merchant and Delivery API against an isolated DGI MongoDB test database", async (t) => {
  assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI in backend/.env before running tests");
  const client = new MongoClient(process.env.MONGODB_URI);
  const databaseName = `delivery_geo_intelligence_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  let server;
  let connected = false;
  const geocodeCalls = [];
  const merchantGeocodeCalls = [];
  const transientInputA = "synthetic-destination-token-a";
  const transientInputB = "synthetic-destination-token-b";
  let pauseConcurrentGeocode;
  let notifyConcurrentGeocode;
  async function geocodeDestination(input) {
    geocodeCalls.push(input);
    if (input === "synthetic-concurrent-geocode") {
      notifyConcurrentGeocode();
      await pauseConcurrentGeocode;
    }
    if (input === "synthetic-no-match") throw new GeocodingError("no_match");
    if (input === "synthetic-provider-error") throw new GeocodingError("provider_error");
    return input === transientInputB
      ? generalizeCoordinates(0.765432, 0.234567, 2)
      : generalizeCoordinates(0.123456, 0.654321, 2);
  }
  async function geocodeMerchant(input) {
    merchantGeocodeCalls.push(input);
    if (input === "synthetic-business-no-match") throw new GeocodingError("no_match");
    if (input === "synthetic-business-provider-error") throw new GeocodingError("provider_error");
    return input === "synthetic-business-b" ? { type: "Point", coordinates: [0.765432, 0.234567] }
      : input === "synthetic-business-c" ? { type: "Point", coordinates: [0.987654, 0.456789] }
        : { type: "Point", coordinates: [0.123456, 0.654321] };
  }

  try {
    await client.connect();
    connected = true;
    const db = client.db(databaseName);
    await ensureIndexes(db);
    server = createApp(db, geocodeDestination, geocodeMerchant).listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;

    async function api(method, path, body) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    }

    const merchantA = {
      name: "Synthetic Pickup A", category: "restaurant",
      publicAddress: "synthetic-business-a", city: "Test City"
    };
    const merchantB = {
      name: "Synthetic Pickup A", category: "grocery",
      publicAddress: "synthetic-business-b", city: "Test City"
    };
    let merchantAId;
    let merchantBId;
    let deliveryAId;
    let deliveryBId;

    await t.test("merchant validation, stored public geocoding, and physical-location identity", async () => {
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, category: "invalid" })).status, 400);
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, location: { type: "Point", coordinates: [1, 2] } })).status, 400);
      assert.equal((await api("POST", "/api/merchants", { name: merchantA.name, category: merchantA.category, city: merchantA.city })).status, 400);
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, address: "not allowed" })).status, 400);
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, publicAddress: "synthetic-business-no-match" })).status, 422);
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, publicAddress: "synthetic-business-provider-error" })).status, 502);
      assert.equal(await db.collection("merchants").countDocuments(), 0);
      const first = await api("POST", "/api/merchants", merchantA);
      const second = await api("POST", "/api/merchants", merchantB);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      merchantAId = first.body.data.id;
      merchantBId = second.body.data.id;
      assert.notEqual(merchantAId, merchantBId);
      assert.equal(first.body.data.category, "restaurant");
      assert.equal(second.body.data.category, "grocery");
      assert.equal(first.body.data.deliveryCount, 0);
      assert.equal(first.body.data.publicAddress, merchantA.publicAddress);
      assert.deepEqual(first.body.data.location, { type: "Point", coordinates: [0.123456, 0.654321] });
      assert.deepEqual(second.body.data.location, { type: "Point", coordinates: [0.765432, 0.234567] });
      assert.deepEqual((await db.collection("merchants").findOne({ _id: new ObjectId(merchantAId) })).location.coordinates, [0.123456, 0.654321]);
      assert.equal((await api("GET", "/api/merchants")).body.data.length, 2);
      assert.equal((await api("GET", `/api/merchants/${merchantAId}`)).body.data.id, merchantAId);
      assert.equal((await api("GET", "/api/merchants/bad")).status, 400);
      assert.equal((await api("GET", `/api/merchants/${new ObjectId()}`)).status, 404);
      const noLocationChange = await api("PATCH", `/api/merchants/${merchantAId}`, { city: "Corrected City", category: "retail" });
      assert.equal(noLocationChange.status, 200);
      assert.deepEqual(noLocationChange.body.data.location.coordinates, [0.123456, 0.654321]);
      assert.equal(noLocationChange.body.data.category, "retail");
      assert.equal(merchantGeocodeCalls.filter((input) => input === merchantA.publicAddress).length, 1);
      const addressChange = await api("PATCH", `/api/merchants/${merchantAId}`, { publicAddress: "synthetic-business-c", category: "restaurant" });
      assert.equal(addressChange.status, 200);
      assert.deepEqual(addressChange.body.data.location.coordinates, [0.987654, 0.456789]);
      assert.equal(addressChange.body.data.publicAddress, "synthetic-business-c");
      assert.equal((await api("PATCH", `/api/merchants/${merchantAId}`, {})).status, 400);
      assert.equal((await api("PATCH", `/api/merchants/${merchantAId}`, { location: { type: "Point", coordinates: [2, 2] } })).status, 400);
      assert.equal((await api("PATCH", `/api/merchants/${merchantAId}`, { publicAddress: "synthetic-business-no-match" })).status, 422);
      const afterFailedCorrection = await db.collection("merchants").findOne({ _id: new ObjectId(merchantAId) });
      assert.deepEqual(afterFailedCorrection.location.coordinates, [0.987654, 0.456789]);
      assert.equal(afterFailedCorrection.publicAddress, "synthetic-business-c");
      assert.equal((await api("PATCH", "/api/merchants/bad", { name: "X" })).status, 400);
      assert.equal((await api("DELETE", "/api/merchants/bad")).status, 400);
      const legacyId = new ObjectId();
      await db.collection("merchants").insertOne({ _id: legacyId, name: "Legacy Pickup", category: "other", city: "Test City",
        location: { type: "Point", coordinates: [4.123456, 5.654321] } });
      const legacyEdit = await api("PATCH", `/api/merchants/${legacyId}`, { city: "Corrected City" });
      assert.equal(legacyEdit.status, 200);
      assert.equal(Object.hasOwn(legacyEdit.body.data, "publicAddress"), false);
      assert.deepEqual(legacyEdit.body.data.location.coordinates, [4.123456, 5.654321]);
      await api("DELETE", `/api/merchants/${legacyId}`);
    });

    await t.test("delivery validation, optional payout, and CRUD", async () => {
      const baseDelivery = { merchantId: merchantAId, pickedUpAt: "2026-04-01T10:00:00-07:00" };
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, payout: -1 })).status, 400);
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, distanceMiles: -1 })).status, 400);
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, pickedUpAt: "not-a-date" })).status, 400);
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, merchantId: "bad" })).status, 400);
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, destinationAddress: "" })).status, 400);
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, destinationLocation: { type: "Point", coordinates: [0, 0] } })).status, 400);
      assert.equal((await api("POST", "/api/deliveries", { ...baseDelivery, merchantId: new ObjectId().toHexString() })).status, 422);

      const first = await api("POST", "/api/deliveries", baseDelivery);
      assert.equal(first.status, 201);
      deliveryAId = first.body.data.id;
      assert.equal(Object.hasOwn(first.body.data, "payout"), false);
      assert.equal(first.body.data.hasDestinationLocation, false);
      const stored = await db.collection("deliveries").findOne({ _id: new ObjectId(deliveryAId) });
      assert.equal(Object.hasOwn(stored, "payout"), false);
      assert.equal(Object.hasOwn(stored, "destinationAddress"), false);

      const second = await api("POST", "/api/deliveries", {
        merchantId: merchantBId, pickedUpAt: "2026-04-03T12:00:00-07:00", payout: 0, distanceMiles: 2.5
      });
      assert.equal(second.status, 201);
      deliveryBId = second.body.data.id;
      assert.equal(second.body.data.payout, 0);
      assert.equal((await api("GET", `/api/deliveries/${deliveryAId}`)).body.data.id, deliveryAId);

      const patch = await api("PATCH", `/api/deliveries/${deliveryAId}`, { payout: 12.5, notes: "Synthetic test" });
      assert.equal(patch.status, 200);
      assert.equal(patch.body.data.payout, 12.5);
      assert.equal((await api("PATCH", `/api/deliveries/${deliveryAId}`, {})).status, 400);
      const cleared = await api("PATCH", `/api/deliveries/${deliveryAId}`, { payout: null });
      assert.equal(cleared.status, 200);
      assert.equal(Object.hasOwn(cleared.body.data, "payout"), false);
      assert.equal(Object.hasOwn(await db.collection("deliveries").findOne({ _id: new ObjectId(deliveryAId) }), "payout"), false);
    });

    await t.test("filters, sort, pagination, and malformed IDs", async () => {
      const third = await api("POST", "/api/deliveries", {
        merchantId: merchantAId, pickedUpAt: "2026-04-05T09:00:00-07:00", payout: 7
      });
      assert.equal(third.status, 201);
      const page = await api("GET", "/api/deliveries?page=2&pageSize=2&sort=oldest");
      assert.equal(page.status, 200);
      assert.deepEqual(page.body.pagination, { page: 2, pageSize: 2, total: 3, totalPages: 2 });
      assert.equal(page.body.data.length, 1);
      assert.equal(page.body.data[0].id, third.body.data.id);

      const search = await api("GET", "/api/deliveries?search=pickup%20a&category=grocery");
      assert.equal(search.body.pagination.total, 1);
      assert.equal(search.body.data[0].id, deliveryBId);
      assert.equal((await api("GET", "/api/deliveries?search=.%2A")).body.pagination.total, 0);
      assert.equal((await api("GET", "/api/deliveries?category=restaurant")).body.pagination.total, 2);
      assert.equal((await api("GET", "/api/deliveries?from=2026-04-02T00%3A00%3A00Z&to=2026-04-04T00%3A00%3A00Z")).body.pagination.total, 1);
      assert.equal((await api("GET", "/api/deliveries?sort=payoutDesc")).body.data[0].id, third.body.data.id);
      for (const query of ["page=0", "pageSize=101", "sort=invalid", "category=invalid", "from=bad", "from=2026-04-05T00%3A00%3A00Z&to=2026-04-04T00%3A00%3A00Z"]) {
        assert.equal((await api("GET", `/api/deliveries?${query}`)).status, 400, query);
      }
      for (const method of ["GET", "PATCH", "DELETE"]) {
        assert.equal((await api(method, "/api/deliveries/not-an-id", method === "PATCH" ? { payout: 1 } : undefined)).status, 400);
      }
      assert.equal((await api("GET", `/api/deliveries/${new ObjectId()}`)).status, 404);
    });

    await t.test("synthetic destination fixture is indexed but never exposed as coordinates", async () => {
      await db.collection("deliveries").updateOne(
        { _id: new ObjectId(deliveryBId) },
        { $set: { destinationLocation: { type: "Point", coordinates: [0, 0] } } }
      );
      const indexes = await db.collection("deliveries").indexes();
      assert.ok(indexes.some((index) => index.key.destinationLocation === "2dsphere"));
      const result = await api("GET", `/api/deliveries/${deliveryBId}`);
      assert.equal(result.body.data.hasDestinationLocation, true);
      assert.equal(Object.hasOwn(result.body.data, "destinationLocation"), false);
      assert.equal((await api("PATCH", `/api/deliveries/${deliveryBId}`, { destinationLocation: { type: "Point", coordinates: [0, 0] } })).status, 400);
    });

    await t.test("delete removes only the selected delivery", async () => {
      assert.equal((await api("DELETE", `/api/deliveries/${deliveryAId}`)).status, 204);
      assert.equal((await api("GET", `/api/deliveries/${deliveryAId}`)).status, 404);
      assert.equal((await api("GET", "/api/deliveries")).body.pagination.total, 2);
    });

    await t.test("merchant deletion protects referenced history and removes only unused locations", async () => {
      const existingDeliveryCount = await db.collection("deliveries").countDocuments({ merchantId: new ObjectId(merchantBId) });
      assert.ok(existingDeliveryCount > 0);
      assert.equal((await api("GET", `/api/merchants/${merchantBId}`)).body.data.deliveryCount, existingDeliveryCount);
      assert.equal((await api("GET", "/api/merchants")).body.data.find((merchant) => merchant.id === merchantBId).deliveryCount, existingDeliveryCount);
      const blocked = await api("DELETE", `/api/merchants/${merchantBId}`);
      assert.equal(blocked.status, 409);
      assert.deepEqual(blocked.body, { error: "Merchant has delivery history and cannot be deleted" });
      assert.ok(await db.collection("merchants").findOne({ _id: new ObjectId(merchantBId) }));
      assert.equal(await db.collection("deliveries").countDocuments({ merchantId: new ObjectId(merchantBId) }), existingDeliveryCount);
      const unused = await api("POST", "/api/merchants", { ...merchantA, name: "Unused Pickup" });
      assert.equal(unused.status, 201);
      assert.equal((await api("DELETE", `/api/merchants/${unused.body.data.id}`)).status, 204);
      assert.equal((await api("GET", `/api/merchants/${unused.body.data.id}`)).status, 404);
      assert.equal(await db.collection("deliveries").countDocuments({ merchantId: new ObjectId(merchantBId) }), existingDeliveryCount);
    });

    await t.test("deleting a Merchant during destination geocoding cannot create an orphan Delivery", async () => {
      const temporary = await api("POST", "/api/merchants", { ...merchantA, name: "Temporary Pickup" });
      assert.equal(temporary.status, 201);
      let resume;
      pauseConcurrentGeocode = new Promise((resolve) => { resume = resolve; });
      const started = new Promise((resolve) => { notifyConcurrentGeocode = resolve; });
      const pendingDelivery = api("POST", "/api/deliveries", {
        merchantId: temporary.body.data.id, pickedUpAt: "2026-04-08T10:00:00-07:00",
        destinationAddress: "synthetic-concurrent-geocode"
      });
      await started;
      assert.equal((await api("DELETE", `/api/merchants/${temporary.body.data.id}`)).status, 204);
      resume();
      assert.equal((await pendingDelivery).status, 422);
      assert.equal(await db.collection("deliveries").countDocuments({ merchantId: new ObjectId(temporary.body.data.id) }), 0);
    });

    await t.test("transient destination is generalized, replaced, and never returned", async () => {
      const body = { merchantId: merchantAId, pickedUpAt: "2026-04-06T09:00:00-07:00", destinationAddress: transientInputA };
      const before = await db.collection("deliveries").countDocuments();
      const noMatch = await api("POST", "/api/deliveries", { ...body, destinationAddress: "synthetic-no-match" });
      assert.equal(noMatch.status, 422);
      assert.equal(noMatch.body.code, "no_match");
      assert.equal((await db.collection("deliveries").countDocuments()), before);
      assert.equal((await api("POST", "/api/deliveries", { ...body, destinationAddress: "synthetic-provider-error" })).status, 502);

      const created = await api("POST", "/api/deliveries", body);
      assert.equal(created.status, 201);
      assert.equal(created.body.data.hasDestinationLocation, true);
      assert.equal(JSON.stringify(created.body).includes(transientInputA), false);
      assert.equal(Object.hasOwn(created.body.data, "destinationLocation"), false);
      const id = created.body.data.id;
      let stored = await db.collection("deliveries").findOne({ _id: new ObjectId(id) });
      assert.equal(Object.hasOwn(stored, "destinationAddress"), false);
      assert.deepEqual(stored.destinationLocation, { type: "Point", coordinates: [0.12, 0.65] });
      assert.equal(JSON.stringify(stored).includes("0.123456"), false);

      const normalEdit = await api("PATCH", `/api/deliveries/${id}`, { notes: "synthetic note" });
      assert.equal(normalEdit.status, 200);
      stored = await db.collection("deliveries").findOne({ _id: new ObjectId(id) });
      assert.deepEqual(stored.destinationLocation.coordinates, [0.12, 0.65]);
      assert.equal(geocodeCalls.filter((input) => input === transientInputA).length, 1);

      const replacement = await api("PATCH", `/api/deliveries/${id}`, { destinationAddress: transientInputB });
      assert.equal(replacement.status, 200);
      assert.equal(JSON.stringify(replacement.body).includes(transientInputB), false);
      stored = await db.collection("deliveries").findOne({ _id: new ObjectId(id) });
      assert.deepEqual(stored.destinationLocation.coordinates, [0.77, 0.23]);
      assert.equal(Object.hasOwn(stored, "destinationAddress"), false);
      assert.equal(JSON.stringify(stored).includes("0.765432"), false);
      assert.equal((await api("PATCH", `/api/deliveries/${id}`, { destinationAddress: "synthetic-no-match" })).status, 422);
      const afterFailure = await db.collection("deliveries").findOne({ _id: new ObjectId(id) });
      assert.deepEqual(afterFailure.destinationLocation.coordinates, [0.77, 0.23]);
      await api("DELETE", `/api/deliveries/${id}`);
    });

    await t.test("duration capture, legacy backfill, replacement, preservation, and clearing", async () => {
      const base = { merchantId: merchantAId, pickedUpAt: "2026-04-09T10:00:00Z" };
      const created = await api("POST", "/api/deliveries", { ...base, deliveryDurationSeconds: 4355,
        destinationAddress: transientInputA });
      assert.equal(created.status, 201);
      assert.equal(created.body.data.deliveryDurationSeconds, 4355);
      const id = created.body.data.id;
      const stored = await db.collection("deliveries").findOne({ _id: new ObjectId(id) });
      assert.equal(stored.deliveryDurationSeconds, 4355);
      assert.equal(Object.hasOwn(stored, "destinationAddress"), false);
      assert.deepEqual(stored.destinationLocation.coordinates, [0.12, 0.65]);
      assert.equal(Object.hasOwn(created.body.data, "destinationLocation"), false);
      assert.equal(JSON.stringify(created.body).includes(transientInputA), false);
      const preserved = await api("PATCH", `/api/deliveries/${id}`, { notes: "Synthetic duration test" });
      assert.equal(preserved.body.data.deliveryDurationSeconds, 4355);
      for (const value of [-1, 0, 0.5, "41", null]) {
        assert.equal((await api("POST", "/api/deliveries", { ...base, deliveryDurationSeconds: value })).status, 400);
        if (value !== null) assert.equal((await api("PATCH", `/api/deliveries/${id}`, { deliveryDurationSeconds: value })).status, 400);
      }
      assert.equal((await api("PATCH", `/api/deliveries/${id}`, { deliveryDurationSeconds: 5025 })).body.data.deliveryDurationSeconds, 5025);
      const cleared = await api("PATCH", `/api/deliveries/${id}`, { deliveryDurationSeconds: null });
      assert.equal(cleared.status, 200);
      assert.equal(Object.hasOwn(cleared.body.data, "deliveryDurationSeconds"), false);
      const afterClear = await db.collection("deliveries").findOne({ _id: new ObjectId(id) });
      assert.equal(Object.hasOwn(afterClear, "deliveryDurationSeconds"), false);
      assert.deepEqual(afterClear.destinationLocation, stored.destinationLocation);
      const unknown = await api("POST", "/api/deliveries", base);
      assert.equal(unknown.status, 201);
      assert.equal(Object.hasOwn(unknown.body.data, "deliveryDurationSeconds"), false);
      assert.equal(Object.hasOwn(await db.collection("deliveries").findOne({ _id: new ObjectId(unknown.body.data.id) }), "deliveryDurationSeconds"), false);
      const legacyId = new ObjectId();
      await db.collection("deliveries").insertOne({ _id: legacyId, merchantId: new ObjectId(merchantAId), pickedUpAt: new Date(base.pickedUpAt) });
      assert.equal(Object.hasOwn((await api("GET", `/api/deliveries/${legacyId}`)).body.data, "deliveryDurationSeconds"), false);
      const backfilled = await api("PATCH", `/api/deliveries/${legacyId}`, { deliveryDurationSeconds: 1721 });
      assert.equal(backfilled.status, 200);
      assert.equal(backfilled.body.data.deliveryDurationSeconds, 1721);
      assert.equal((await api("GET", `/api/deliveries/${legacyId}`)).body.data.deliveryDurationSeconds, 1721);
      assert.equal((await api("GET", "/api/deliveries")).body.data.find((row) => row.id === legacyId.toHexString()).deliveryDurationSeconds, 1721);
      for (const item of [id, unknown.body.data.id, legacyId.toHexString()]) await api("DELETE", `/api/deliveries/${item}`);
    });

    await t.test("Prop 22 independent CRUD, currency, date, coverage validation, and index", async () => {
      const base = { type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17 };
      for (const bad of [{ amount: 0 }, { amount: -1 }, { amount: 1.001 }, { amount: "5" },
        { type: "other" }, { paymentDate: "2026-02-30" }, { paymentDate: "2026-10-08T00:00:00Z" },
        { coverageStartDate: "2026-09-21" }, { coverageEndDate: "2026-10-04" },
        { coverageStartDate: "2026-10-04", coverageEndDate: "2026-09-21" }, { merchantId: merchantAId }]) {
        assert.equal((await api("POST", "/api/earnings-adjustments", { ...base, ...bad })).status, 400);
      }
      const before = await db.collection("deliveries").find().toArray();
      const first = await api("POST", "/api/earnings-adjustments", base);
      assert.equal(first.status, 201);
      const id = first.body.data.id;
      assert.equal((await api("GET", `/api/earnings-adjustments/${id}`)).body.data.amount, 24.17);
      const second = await api("POST", "/api/earnings-adjustments", { ...base, paymentDate: "2026-10-15", amount: 12 });
      assert.equal((await api("GET", "/api/earnings-adjustments")).body.data[0].id, second.body.data.id);
      const edit = await api("PATCH", `/api/earnings-adjustments/${id}`, { paymentDate: "2026-10-09", amount: 25.01,
        coverageStartDate: "2026-09-21", coverageEndDate: "2026-10-04", notes: "Synthetic payment" });
      assert.equal(edit.status, 200);
      assert.equal(edit.body.data.paymentDate, "2026-10-09");
      assert.equal(edit.body.data.amount, 25.01);
      assert.equal(edit.body.data.coverageStartDate, "2026-09-21");
      assert.equal((await api("PATCH", `/api/earnings-adjustments/${id}`, { coverageStartDate: "2026-10-05" })).status, 400);
      assert.equal((await api("PATCH", `/api/earnings-adjustments/${id}`, { coverageStartDate: "2026-09-22" })).status, 200);
      assert.equal((await api("PATCH", `/api/earnings-adjustments/${id}`, { coverageStartDate: null })).status, 400);
      assert.equal((await api("PATCH", `/api/earnings-adjustments/${id}`, {})).status, 400);
      assert.equal((await api("PATCH", `/api/earnings-adjustments/${id}`, { amount: 0 })).status, 400);
      const cleared = await api("PATCH", `/api/earnings-adjustments/${id}`, { coverageStartDate: null, coverageEndDate: null, notes: null });
      assert.equal(cleared.status, 200);
      assert.equal(Object.hasOwn(cleared.body.data, "coverageStartDate"), false);
      assert.deepEqual(await db.collection("deliveries").find().toArray(), before);
      assert.ok((await db.collection("earningsAdjustments").indexes()).some((index) => index.key.paymentDate === -1));
      for (const method of ["GET", "PATCH", "DELETE"]) {
        assert.equal((await api(method, "/api/earnings-adjustments/bad", method === "PATCH" ? { amount: 5 } : undefined)).status, 400);
        assert.equal((await api(method, `/api/earnings-adjustments/${new ObjectId()}`, method === "PATCH" ? { amount: 5 } : undefined)).status, 404);
      }
      for (const paymentId of [id, second.body.data.id]) assert.equal((await api("DELETE", `/api/earnings-adjustments/${paymentId}`)).status, 204);
      assert.equal((await api("GET", `/api/earnings-adjustments/${id}`)).status, 404);
      assert.deepEqual((await api("GET", "/api/earnings-adjustments")).body.data, []);
    });

    await t.test("settlement backfill, nested partial updates, explicit clearing, identity, and derived detail output", async () => {
      const base = { type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17 };
      const legacy = await api("POST", "/api/earnings-adjustments", base);
      const id = legacy.body.data.id;
      const path = `/api/earnings-adjustments/${id}`;
      assert.equal(legacy.body.reconciliation.status, "insufficient_data");
      assert.equal(Object.hasOwn(legacy.body.data, "settlementDetails"), false);
      const details = { engagedSeconds: 30240, engagedMiles: 38.123456, eligibleEarningsExcludingTips: 100, reportedGuaranteedAmount: 124.17 };
      const other = await api("POST", "/api/earnings-adjustments", { ...base, settlementDetails: details });
      assert.equal(other.status, 201);
      const backfilled = await api("PATCH", path, { settlementDetails: details });
      assert.equal(backfilled.status, 200); assert.equal(backfilled.body.data.id, id);
      assert.equal(backfilled.body.data.amount, 24.17);
      assert.deepEqual(backfilled.body.data.settlementDetails, details);
      assert.equal(backfilled.body.reconciliation.status, "matched");
      const stored = await db.collection("earningsAdjustments").findOne({ _id: new ObjectId(id) });
      assert.equal(Object.hasOwn(stored, "reconciliation"), false);
      assert.equal(Object.hasOwn(stored, "expectedAdjustment"), false);
      const edited = await api("PATCH", path, { settlementDetails: { engagedMiles: 40.123456 } });
      assert.deepEqual(edited.body.data.settlementDetails, { ...details, engagedMiles: 40.123456 });
      assert.deepEqual((await api("GET", `/api/earnings-adjustments/${other.body.data.id}`)).body.data.settlementDetails, details);
      const mismatch = await api("PATCH", path, { settlementDetails: { reportedGuaranteedAmount: 130 } });
      assert.equal(mismatch.body.reconciliation.status, "mismatch");
      assert.equal(mismatch.body.reconciliation.difference, -5.83);
      const removed = await api("PATCH", path, { settlementDetails: { eligibleEarningsExcludingTips: null } });
      assert.equal(Object.hasOwn(removed.body.data.settlementDetails, "eligibleEarningsExcludingTips"), false);
      assert.equal(removed.body.data.settlementDetails.engagedSeconds, 30240);
      assert.equal(removed.body.reconciliation.status, "insufficient_data");
      assert.equal((await api("PATCH", path, { settlementDetails: { engagedSeconds: 0, eligibleEarningsExcludingTips: 0, reportedGuaranteedAmount: 24.17 } })).body.reconciliation.status, "matched");
      assert.equal((await api("PATCH", path, { coverageStartDate: "2026-09-21", coverageEndDate: "2026-09-21" })).status, 200);
      assert.equal((await api("PATCH", path, { coverageEndDate: "2026-09-20" })).status, 400);
      const clear = await api("PATCH", path, { settlementDetails: null });
      assert.equal(clear.status, 200); assert.equal(Object.hasOwn(clear.body.data, "settlementDetails"), false);
      assert.equal(clear.body.data.amount, 24.17);
      assert.equal((await api("GET", path)).body.reconciliation.status, "insufficient_data");
      assert.equal(Object.hasOwn((await api("GET", "/api/earnings-adjustments")).body, "reconciliation"), false);
      for (const bad of [{ engagedSeconds: -1 }, { engagedSeconds: 1.5 }, { engagedMiles: -1 }, { reportedGuaranteedAmount: 1.001 }]) {
        assert.equal((await api("PATCH", path, { settlementDetails: bad })).status, 400);
      }
      for (const paymentId of [id, other.body.data.id]) await api("DELETE", `/api/earnings-adjustments/${paymentId}`);
    });

    await t.test("History and Dashboard resolve current merchant metadata by ID", async () => {
      const before = (await api("GET", "/api/dashboard?period=month&asOf=2026-04-20")).body;
      const sameName = before.map.pickupVolume.filter((merchant) => merchant.name === "Synthetic Pickup A");
      assert.equal(sameName.length, 2);
      assert.notEqual(sameName[0].id, sameName[1].id);
      assert.equal(before.map.merchantDiversity.filter((merchant) => merchant.name === "Synthetic Pickup A").length, 2);
      const changed = await api("PATCH", `/api/merchants/${merchantBId}`, { name: "Updated Grocery B", category: "retail", city: "Updated City" });
      assert.equal(changed.status, 200);
      const list = (await api("GET", "/api/merchants")).body.data;
      assert.equal(list.find((merchant) => merchant.id === merchantBId).name, "Updated Grocery B");
      const history = (await api("GET", "/api/deliveries?category=retail")).body;
      assert.ok(history.data.some((delivery) => delivery.merchantId === merchantBId));
      const dashboard = (await api("GET", "/api/dashboard?period=month&asOf=2026-04-20")).body;
      const pickup = dashboard.map.pickupVolume.find((merchant) => merchant.id === merchantBId);
      assert.equal(pickup.name, "Updated Grocery B");
      assert.equal(pickup.category, "retail");
      assert.equal(pickup.city, "Updated City");
      assert.deepEqual(pickup.location.coordinates, [0.765432, 0.234567]);
      assert.equal(dashboard.map.merchantDiversity.filter((merchant) => merchant.id === merchantBId).length, 1);
      assert.equal(dashboard.summary.uniqueMerchants, new Set(dashboard.map.pickupVolume.map((merchant) => merchant.id)).size);
    });
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) await client.db(databaseName).dropDatabase();
    await client.close();
  }
});
