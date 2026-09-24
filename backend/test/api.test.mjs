import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { MongoClient, ObjectId } from "mongodb";
import { createApp } from "../dist/app.js";
import { ensureIndexes } from "../dist/db.js";
import { GeocodingError, generalizeCoordinates } from "../dist/geocoding.js";

test("Merchant and Delivery API against an isolated DGI MongoDB test database", async (t) => {
  assert.ok(process.env.MONGODB_URI, "Set MONGODB_URI in backend/.env before running tests");
  const client = new MongoClient(process.env.MONGODB_URI);
  const databaseName = `delivery_geo_intelligence_test_${process.pid}_${randomBytes(4).toString("hex")}`;
  let server;
  let connected = false;
  const geocodeCalls = [];
  const transientInputA = "synthetic-destination-token-a";
  const transientInputB = "synthetic-destination-token-b";
  async function geocodeDestination(input) {
    geocodeCalls.push(input);
    if (input === "synthetic-no-match") throw new GeocodingError("no_match");
    if (input === "synthetic-provider-error") throw new GeocodingError("provider_error");
    return input === transientInputB
      ? generalizeCoordinates(0.765432, 0.234567, 2)
      : generalizeCoordinates(0.123456, 0.654321, 2);
  }

  try {
    await client.connect();
    connected = true;
    const db = client.db(databaseName);
    await ensureIndexes(db);
    server = createApp(db, geocodeDestination).listen(0, "127.0.0.1");
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
      location: { type: "Point", coordinates: [0, 0] }, city: "Test City"
    };
    const merchantB = {
      name: "Synthetic Pickup A", category: "grocery",
      location: { type: "Point", coordinates: [1, 1] }, city: "Test City"
    };
    let merchantAId;
    let merchantBId;
    let deliveryAId;
    let deliveryBId;

    await t.test("merchant validation, categories, and physical-location identity", async () => {
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, category: "invalid" })).status, 400);
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, location: { type: "Point", coordinates: [181, 0] } })).status, 400);
      assert.equal((await api("POST", "/api/merchants", { ...merchantA, address: "not allowed" })).status, 400);
      const first = await api("POST", "/api/merchants", merchantA);
      const second = await api("POST", "/api/merchants", merchantB);
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      merchantAId = first.body.data.id;
      merchantBId = second.body.data.id;
      assert.notEqual(merchantAId, merchantBId);
      assert.equal(first.body.data.category, "restaurant");
      assert.equal(second.body.data.category, "grocery");
      assert.equal((await api("GET", "/api/merchants")).body.data.length, 2);
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
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (connected) await client.db(databaseName).dropDatabase();
    await client.close();
  }
});
