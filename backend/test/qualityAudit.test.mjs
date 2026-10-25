import test from "./support/scoped-test.mjs";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { MongoServerError } from "mongodb";
import { ProviderObservability } from "../dist/observability/collector.js";
import { monitorMongo } from "../dist/observability/mongodb.js";
const config = { mongodb: true, arcgis_geocoding: false, openai: false };
for (const [code, category, status] of [
  [11000, "request_rejected", "not_yet_verified"], [121, "request_rejected", "not_yet_verified"],
  [13, "authentication", "unavailable"], [18, "authentication", "unavailable"],
  [50, "timeout", "unavailable"], [262, "timeout", "unavailable"], [99999, "provider", "unavailable"]
]) test(`Mongo command failure code ${code} has bounded classification and evidence`, () => {
  const observer = new ProviderObservability(config), client = new EventEmitter();
  const detach = monitorMongo(client, observer);
  const failure = new MongoServerError({ code, errmsg: "SYNTHETIC_PRIVATE_RECORD", keyValue: { secret: "SYNTHETIC_SECRET" } });
  client.emit("commandFailed", { commandName: "insert", duration: 2, failure });
  const row = observer.snapshot().providers.find((p) => p.provider === "mongodb");
  assert.equal(row.status, status); assert.equal(row.failureCount, 1); assert.equal(row.sampleCount, 1);
  assert.equal(row.errorCounts[category], 1); assert.equal(row.lastErrorCategory, category);
  assert.equal(row.latency.p95Ms, 2); assert.equal(row.operations.database_write, 1);
  assert.ok(!JSON.stringify(observer).includes("SYNTHETIC_"));
  detach(); assert.equal(client.listenerCount("commandFailed"), 0); assert.equal(client.listenerCount("commandSucceeded"), 0);
});
test("Mongo business rejection does not degrade earlier successful command evidence", () => {
  const observer = new ProviderObservability(config), client = new EventEmitter();
  const detach = monitorMongo(client, observer);
  client.emit("commandSucceeded", { commandName: "find", duration: 4 });
  client.emit("commandFailed", { commandName: "insert", duration: 2, failure: new MongoServerError({ code: 11000, errmsg: "synthetic" }) });
  const row = observer.snapshot().providers.find((p) => p.provider === "mongodb");
  assert.equal(row.status, "operational"); assert.equal(row.successCount, 1); assert.equal(row.failureCount, 1);
  assert.equal(row.sampleCount, 2); detach();
});
