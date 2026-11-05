import assert from "node:assert/strict";
import { ObjectId } from "mongodb";

// Read-only synthetic collections; no MongoDB connection or persistent records.
export function syntheticDb(mode = "complete") {
  const sessionId = new ObjectId("000000000000000000000001"), merchantId = new ObjectId("000000000000000000000002");
  const session = { _id: sessionId, startedAt: new Date("2026-03-08T09:00:00Z"), endedAt: new Date("2026-03-08T10:00:00Z"),
    totalDrivenMiles: 10, strategy: "eastvale_local_only", notes: "SYNTHETIC_PRIVATE_NOTE" };
  const delivery = { _id: new ObjectId("000000000000000000000003"), merchantId, sessionId, pickedUpAt: session.startedAt,
    payout: 20, distanceMiles: 1, deliveryDurationSeconds: 3600, destinationLocation: { coordinates: [0.123456, 0.654321] } };
  const profile = { _id: "primary", vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0.1,
    tireReplacementSetCost: 100, expectedTireSetLifeMiles: 1000, marginalDepreciationCostPerMile: 0.1 };
  const rows = { merchants: [{ _id: merchantId }], deliveries: [delivery], deliverySessions: [session], vehicleEconomics: [profile] };
  if (mode === "empty") { rows.deliveries = []; rows.deliverySessions = []; }
  if (mode === "incomplete") { delete session.totalDrivenMiles; delete delivery.payout; session.associationIntegrity = true; }
  if (mode === "partial") {
    delivery.payout = 0;
    rows.deliveries.push({ ...delivery, _id: new ObjectId("000000000000000000000004"), payout: undefined });
    delete profile.expectedTireSetLifeMiles; delete profile.marginalDepreciationCostPerMile;
  }
  if (mode === "unlinked") rows.deliveries = [];
  const reads = [];
  const equal = (a, b) => a instanceof ObjectId ? a.equals(b) : a === b;
  const matches = (row, query) => Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === "object" && !(expected instanceof ObjectId) && !(expected instanceof Date)) {
      return Object.entries(expected).every(([op, value]) => {
        if (op === "$in") return value.some((item) => equal(row[key], item));
        if (op === "$gte") return row[key] >= value;
        if (op === "$lt") return row[key] < value;
        if (op === "$gt") return row[key] > value;
        assert.fail("Unexpected synthetic query operator");
      });
    }
    return equal(row[key], expected);
  });
  return { reads, rows, collection(name) {
    assert.ok(Object.hasOwn(rows, name), "Only synthetic analytics collections may be read");
    return {
      find(query = {}) { reads.push(name); return { async toArray() { return rows[name].filter((row) => matches(row, query)); } }; },
      async findOne(query) { reads.push(name); return rows[name].find((row) => matches(row, query)) ?? null; }
    };
  } };
}

