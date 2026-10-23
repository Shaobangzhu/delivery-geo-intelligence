import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server-core";
import { TestMongoClient, serviceUri } from "../backend/test/support/database.mjs";
import { createApp } from "../backend/dist/app.js";
import { ensureIndexes } from "../backend/dist/db.js";
import { ProviderObservability } from "../backend/dist/observability/collector.js";
import { monitorMongo } from "../backend/dist/observability/mongodb.js";

// This entrypoint never imports production index/config, dotenv, or a live SDK client.
globalThis.fetch = () => { throw new Error("External fetch is forbidden in the E2E backend"); };
const memory = process.env.DGI_TEST_MONGO_MODE === "service" ? null : await MongoMemoryServer.create({
  binary: { version: "7.0.24", downloadDir: fileURLToPath(new URL("../node_modules/.cache/mongodb-binaries/", import.meta.url)) },
  instance: { ip: "127.0.0.1", storageEngine: "wiredTiger" }
});
const client = new TestMongoClient(memory ? memory.getUri() : serviceUri(process.env), { monitorCommands: true });
const db = client.db("e2e_test");
// TestMongoClient hashes names into this namespace; guard every destructive operation too.
function guardedDatabase() {
  assert.match(db.databaseName, /^dgi_ci_test_[a-f0-9]{24}$/);
  return db;
}
const fixtureTime = "2026-03-08T20:00:00.000Z";
let app, observer, unmonitor = () => {};
const ids = ["111111111111111111111111", "222222222222222222222222"];
// Resolve the backend workspace's pinned driver, whether hoisted or nested.
const { ObjectId } = createRequire(new URL("../backend/package.json", import.meta.url))("mongodb");
async function reset() {
  unmonitor();
  await guardedDatabase().dropDatabase();
  await ensureIndexes(db);
  await db.collection("merchants").insertMany(ids.map((id, index) => ({
    _id: new ObjectId(id), name: index ? "Synthetic Market" : "Synthetic Cafe",
    category: index ? "grocery" : "restaurant", publicAddress: `Synthetic business site ${index + 1}`,
    city: "Synthetic City", location: { type: "Point", coordinates: [0.01 + index * 0.01, 0.01] }
  })));
  await db.collection("deliveries").insertMany([
    { merchantId: new ObjectId(ids[0]), pickedUpAt: new Date("2026-03-08T17:00:00Z"), destinationLocation: { type: "Point", coordinates: [0.01, 0.01] }, payout: 12.5, distanceMiles: 4, deliveryDurationSeconds: 1200 },
    { merchantId: new ObjectId(ids[1]), pickedUpAt: new Date("2026-03-07T17:00:00Z"), payout: 7.5, distanceMiles: 2, deliveryDurationSeconds: 600 },
    { merchantId: new ObjectId(ids[0]), pickedUpAt: new Date("2026-03-01T17:00:00Z"), destinationLocation: { type: "Point", coordinates: [0.01, 0.01] }, payout: 10, distanceMiles: 3, deliveryDurationSeconds: 900 }
  ]);
  await db.collection("earningsAdjustments").insertOne({ type: "prop22_guarantee", paymentDate: "2026-03-08", amount: 5 });
  observer = new ProviderObservability({ mongodb: true, arcgis_geocoding: true, openai: false });
  unmonitor = monitorMongo(client, observer);
  const geocode = async (address) => {
    assert.match(address, /^Synthetic (business site|destination zone) /);
    observer.record({ provider: "arcgis_geocoding", operation: "geocode", outcome: "success", evidence: "success", durationMs: 1 });
    return { type: "Point", coordinates: [0.01, 0.01] };
  };
  app = createApp(db, geocode, geocode, undefined, () => new Date(fixtureTime), observer);
}
const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/__e2e/reset") {
      await reset();
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ synthetic: true, fixtureTime }));
    } else if (request.method === "POST" && request.url === "/__e2e/provider-failure") {
      observer.record({ provider: "arcgis_geocoding", operation: "geocode", outcome: "failure", evidence: "failure", durationMs: 25, errorCategory: "rate_limit" });
      response.writeHead(204).end();
    } else if (request.method === "GET" && request.url === "/__e2e/ready") {
      response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ synthetic: true, fixtureTime }));
    } else app(request, response);
  } catch {
    // Never put database/provider exception objects in artifacts.
    response.writeHead(500).end("Synthetic harness failure");
  }
});
async function close() {
  await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
  unmonitor();
  try { await guardedDatabase().dropDatabase(); } finally { await client.close(); await memory?.stop(); }
}
try {
  await client.connect();
  await reset();
  server.listen(4310, "127.0.0.1");
  let closing = false;
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
    if (closing) return;
    closing = true;
    void close().catch(() => { process.exitCode = 1; });
  });
} catch {
  await client.close();
  await memory?.stop();
  throw new Error("Synthetic E2E backend startup failed");
}
