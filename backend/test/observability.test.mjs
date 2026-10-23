import test from "node:test";
import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";
import { MongoClient } from "mongodb";
import { testMongoUri } from "./support/environment.mjs";
import { ProviderObservability } from "../dist/observability/collector.js";
import { createHealthProbe } from "../dist/observability/routes.js";
import { monitorMongo } from "../dist/observability/mongodb.js";
import { createArcGisGeocoder, GeocodingError } from "../dist/geocoding.js";
import { createApp } from "../dist/app.js";

const configured = { mongodb: true, arcgis_geocoding: true, openai: true };
const entry = (extra = {}) => ({ provider: "mongodb", operation: "database_read", outcome: "success", evidence: "success", durationMs: 10, ...extra });
const provider = (o, id = "mongodb", window = "24h") => o.snapshot(window).providers.find((p) => p.provider === id);

test("empty/configuration states and unknown latencies/tokens never invent connectivity", () => {
  const o = new ProviderObservability({ mongodb: true, arcgis_geocoding: false, openai: null }, () => 0);
  assert.equal(provider(o).status, "not_yet_verified");
  assert.equal(provider(o, "arcgis_geocoding").status, "not_configured");
  assert.equal(provider(o, "openai").configured, null);
  assert.equal(provider(o).latency.p50Ms, null);
  assert.equal(provider(o).lastSuccessAt, null);
  assert.equal(provider(o, "openai").ai.inputTokens, null);
  assert.equal(provider(o).sampleCount, 0);
});
test("aggregation, nearest-rank quantiles and evidence state transitions", () => {
  let now = 100; const o = new ProviderObservability(configured, () => now);
  o.record(entry({ outcome: "failure", evidence: "failure", errorCategory: "network" }));
  assert.equal(provider(o).status, "unavailable");
  now++; for (const durationMs of [0, 20, 30]) o.record(entry({ durationMs }));
  const p = provider(o);
  assert.equal(p.status, "degraded"); assert.equal(p.successCount, 3); assert.equal(p.failureCount, 1);
  assert.deepEqual(p.latency, { sampleCount: 4, meanMs: 15, p50Ms: 10, p95Ms: 30 });
  assert.equal(p.lastSuccessAt, new Date(now).toISOString());
  now += 86_400_000; assert.equal(provider(o).status, "not_yet_verified");
  o.record(entry()); assert.equal(provider(o).status, "operational");
});
test("rolling windows use (start, now], bounded truncation expires and restart resets", () => {
  let now = 0; const o = new ProviderObservability(configured, () => now, 2);
  o.record(entry()); now = 1; o.record(entry()); now = 2; o.record(entry());
  assert.equal(o.snapshot().incomplete, true); assert.equal(provider(o).sampleCount, 2);
  now = 3_600_001;
  assert.equal(provider(o, "mongodb", "1h").sampleCount, 1);
  assert.equal(o.snapshot("1h").incomplete, false);
  assert.equal(provider(o).sampleCount, 2);
  now = 86_400_002; assert.equal(provider(o).sampleCount, 0);
  assert.equal(new ProviderObservability(configured, () => now).snapshot().providers[0].sampleCount, 0);
  assert.throws(() => new ProviderObservability(configured, Date.now, 0));
});
test("malformed samples fail closed and telemetry stores only projected safe fields", () => {
  const o = new ProviderObservability(configured, () => 1);
  for (const extra of [{ provider: "SECRET" }, { operation: "SECRET" }, { errorCategory: "SECRET" }, { durationMs: NaN }, { durationMs: -1 }, { providerCalls: -1 }]) o.record(entry(extra));
  assert.equal(provider(o).sampleCount, 0);
  o.record(entry({ address: "PRIVATE_ADDRESS", credential: "SECRET", response: "PRIVATE_RESPONSE", coordinates: [1.23456, 2.34567] }));
  assert.equal(provider(o).sampleCount, 1);
  assert.doesNotMatch(JSON.stringify(o), /PRIVATE|SECRET|1\.23456|2\.34567/);
});
test("AI request counts are separate from calls; partial and missing usage remain explicit", () => {
  const o = new ProviderObservability(configured, () => 100);
  const data = { requestId: "PRIVATE_ID", model: "PRIVATE_MODEL", tools: ["PRIVATE_TOOL"], toolPayloadBytes: 999,
    latencyMs: 40, outcome: "success", providerCallCount: 3, providerErrorCount: 0, providerUsage: [{}], usageAvailable: true, inputTokens: 12, outputTokens: 4 };
  o.observeAi(data);
  o.observeAi({ ...data, outcome: "provider_rate_limited", providerCallCount: 1, providerErrorCount: 1, providerUsage: [], usageAvailable: false });
  const p = provider(o, "openai");
  assert.equal(p.requestCount, 2); assert.equal(p.ai.providerCalls, 4); assert.equal(p.ai.providerErrors, 1);
  assert.equal(p.ai.usageSamples, 1); assert.equal(p.ai.inputTokens, 12); assert.equal(p.lastErrorCategory, "rate_limit");
  assert.equal(p.status, "degraded"); assert.doesNotMatch(JSON.stringify(o), /PRIVATE/);
  const empty = new ProviderObservability(configured);
  empty.observeAi({ ...data, outcome: "configuration_missing", providerCallCount: 0, providerUsage: [], usageAvailable: false });
  assert.equal(provider(empty, "openai").status, "not_yet_verified");
  assert.equal(provider(empty, "openai").ai.inputTokens, null);
  for (const [outcome, category] of [["timeout_or_cancelled", "timeout"], ["provider_authentication", "authentication"], ["provider_failure", "provider"], ["invalid_question", "request_rejected"]]) {
    empty.observeAi({ ...data, outcome, providerErrorCount: outcome === "invalid_question" ? 0 : 1 });
    assert.equal(provider(empty, "openai").lastErrorCategory, category);
  }
});
test("ArcGIS observations preserve generalization and expected no-match semantics", async () => {
  const payload = { spatialReference: { wkid: 4326 }, candidates: [{ score: 99, location: { x: 0.123456, y: 0.654321 }, attributes: { Addr_type: "PointAddress" } }] };
  for (const [body, status, expected, category] of [[payload, 200, null, null], [{ ...payload, candidates: [] }, 200, "no_match", "no_match"],
    [{ ...payload, candidates: [{ ...payload.candidates[0], score: 20 }] }, 200, "low_confidence", "low_confidence"],
    [{ error: { code: 429, message: "PRIVATE" } }, 200, "provider_error", "rate_limit"], [{}, 429, "provider_error", "rate_limit"], [{}, 503, "provider_error", "provider"], [{}, 200, "unusable_result", "invalid_response"]]) {
    const o = new ProviderObservability(configured); const fetcher = async () => new Response(JSON.stringify(body), { status });
    const geocode = createArcGisGeocoder("SECRET", 2, fetcher, o);
    if (expected) await assert.rejects(geocode("PRIVATE_ADDRESS"), (e) => e instanceof GeocodingError && e.code === expected);
    else assert.deepEqual((await geocode("PRIVATE_ADDRESS")).coordinates, [0.12, 0.65]);
    const p = provider(o, "arcgis_geocoding");
    assert.equal(p.sampleCount, 1); assert.equal(p.lastErrorCategory, category);
    assert.equal(p.status, expected === null || ["no_match", "low_confidence"].includes(expected) ? "operational" : "unavailable");
    assert.doesNotMatch(JSON.stringify(o), /PRIVATE|SECRET|0\.123456/);
  }
  const o = new ProviderObservability(configured);
  await assert.rejects(createArcGisGeocoder("SECRET", 2, async () => { throw new Error("PRIVATE"); }, o)("PRIVATE"));
  assert.equal(provider(o, "arcgis_geocoding").lastErrorCategory, "network");
  const broken = { record() { throw new Error("broken telemetry"); } };
  assert.deepEqual((await createArcGisGeocoder("SECRET", 2, async () => new Response(JSON.stringify(payload)), broken)("PRIVATE")).coordinates, [0.12, 0.65]);
});
test("health checks are bounded, cached, single-flight and safely sanitize failures", async () => {
  let now = 1, calls = 0; const o = new ProviderObservability(configured, () => now);
  const probe = createHealthProbe(async () => { calls++; throw new Error("PRIVATE_SERVER"); }, o, () => now, 5, 10);
  await Promise.all([probe(), probe()]); await probe(); assert.equal(calls, 1);
  assert.equal(provider(o).lastErrorCategory, "provider");
  now = 12; await probe(); assert.equal(calls, 2);
  await createHealthProbe(() => new Promise(() => {}), o, () => now, 5, 0)();
  assert.equal(provider(o).lastErrorCategory, "timeout"); assert.doesNotMatch(JSON.stringify(o), /PRIVATE_SERVER/);
  await createHealthProbe(async () => { const error = new Error("PRIVATE_DRIVER"); error.name = "MongoOperationTimeoutError"; throw error; }, o, () => now, 100, 0)();
  assert.equal(provider(o).lastErrorCategory, "timeout");
});
test("Mongo completion metrics ignore ping, raw command/reply/error and detach cleanly", () => {
  const emitter = new EventEmitter(), o = new ProviderObservability(configured);
  const stop = monitorMongo(emitter, o);
  emitter.emit("commandSucceeded", { commandName: "find", duration: 2, reply: "PRIVATE" });
  emitter.emit("commandFailed", { commandName: "insert", duration: 3, failure: "PRIVATE" });
  emitter.emit("commandSucceeded", { commandName: "ping", duration: 4 });
  assert.equal(provider(o).sampleCount, 2); assert.equal(provider(o).operations.database_read, 1);
  assert.equal(provider(o).operations.database_write, 1); assert.doesNotMatch(JSON.stringify(o), /PRIVATE/);
  stop(); emitter.emit("commandSucceeded", { commandName: "find", duration: 2 }); assert.equal(provider(o).sampleCount, 2);
});
test("system APIs have versioned contracts, reject malformed queries and never probe paid providers", async () => {
  const o = new ProviderObservability({ mongodb: true, arcgis_geocoding: false, openai: false });
  let calls = 0;
  const db = { collection: () => ({}), command: async (command, options) => { calls++; assert.deepEqual(command, { ping: 1 }); assert.equal(options.timeoutMS, 1500); } };
  const fail = async () => { throw new Error("Paid provider must not run"); };
  const server = createApp(db, fail, fail, undefined, undefined, o).listen(0, "127.0.0.1"); await once(server, "listening");
  const get = (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`);
  try {
    for (const window of ["1h", "24h"]) {
      const r = await get(`/api/system/metrics?window=${window}`); assert.equal(r.status, 200); assert.equal(r.headers.get("cache-control"), "no-store");
      const json = await r.json(); assert.equal(json.schemaVersion, 1); assert.equal(json.window, window); assert.equal(json.providers.length, 3);
    }
    assert.equal(calls, 0);
    for (const suffix of ["", "?window=2h", "?window=1h&window=24h", "?window=1h&extra=SECRET", "?window[x]=1h"]) assert.equal((await get(`/api/system/metrics${suffix}`)).status, 400);
    const r = await get("/api/system/status"); assert.equal(r.status, 200); const result = await r.json();
    assert.equal(result.providers[0].status, "operational"); assert.equal(result.providers[1].status, "not_configured");
    await get("/api/system/status"); await get("/api/system/metrics?window=24h"); assert.equal(calls, 1);
    assert.equal((await get("/api/system/status?key=SECRET")).status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("real disposable MongoDB command monitoring measures queries without telemetry reads adding operations", async () => {
  const client = new MongoClient(testMongoUri, { monitorCommands: true }), o = new ProviderObservability(configured);
  const stop = monitorMongo(client, o);
  try {
    await client.connect();
    await client.db("observability_synthetic").collection("empty").findOne({});
    assert.ok(provider(o).operations.database_read >= 1);
    const count = provider(o).sampleCount;
    o.snapshot(); o.snapshot("1h"); await client.db("observability_synthetic").command({ ping: 1 }, { timeoutMS: 1500 });
    assert.equal(provider(o).sampleCount, count);
  } finally { stop(); await client.close(); }
});

test("ArcGIS abort timeout is categorized without changing its public network error", async (t) => {
  t.mock.method(AbortSignal, "timeout", () => AbortSignal.abort());
  const o = new ProviderObservability(configured);
  const geocode = createArcGisGeocoder("SECRET", 2, async (_url, options) => {
    assert.equal(options.signal.aborted, true); throw new Error("PRIVATE_TIMEOUT");
  }, o);
  await assert.rejects(geocode("PRIVATE_ADDRESS"), { code: "network_error" });
  assert.equal(provider(o, "arcgis_geocoding").lastErrorCategory, "timeout");
  assert.equal(provider(o, "arcgis_geocoding").errorCounts.timeout, 1);
});

test("AI SDK timeouts reach the diagnostics collector while preserving public error codes", async () => {
  const { createAnalyst } = await import("../dist/ai/agent.js");
  const o = new ProviderObservability(configured);
  const sdk = { create: async () => { const error = new Error("PRIVATE_SDK"); error.name = "APIConnectionTimeoutError"; throw error; } };
  const analyst = createAnalyst(sdk, "synthetic", o.observeAi);
  await assert.rejects(analyst("PRIVATE_PROMPT", { definitions: [], currentDate: "2026-10-23" }, "PRIVATE_REQUEST"), { code: "provider_failure" });
  const p = provider(o, "openai");
  assert.equal(p.lastErrorCategory, "timeout"); assert.equal(p.ai.providerCalls, 1); assert.equal(p.ai.providerErrors, 1);
  assert.equal(p.ai.analystRequests, 1); assert.doesNotMatch(JSON.stringify(o), /PRIVATE/);
});

test("unavailable database status is an explicit observation in a valid status contract", async () => {
  const o = new ProviderObservability(configured);
  const db = { collection: () => ({}), command: async () => { throw new Error("PRIVATE_URI"); } };
  const fail = async () => { throw new Error("Unexpected geocoding"); };
  const server = createApp(db, fail, fail, undefined, undefined, o).listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/system/status`);
    assert.equal(r.status, 200); const body = await r.json(); assert.equal(body.schemaVersion, 1);
    assert.equal(body.providers[0].status, "unavailable"); assert.equal(body.providers[0].lastSuccessAt, null);
    assert.doesNotMatch(JSON.stringify(body), /PRIVATE_URI/);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test("system metadata exposes configured model and a separate last ping measurement", () => {
  const o = new ProviderObservability(configured, () => 100, 100, "synthetic-model");
  o.record(entry({ durationMs: 500 }));
  o.record(entry({ operation: "health_ping", durationMs: 3 }));
  assert.deepEqual(provider(o).healthCheck, { timestamp: new Date(100).toISOString(), durationMs: 3, outcome: "success" });
  assert.equal(provider(o, "openai").model, "synthetic-model");
  assert.equal(provider(o).model, null);
  assert.equal(provider(new ProviderObservability(configured)).healthCheck, null);
});
