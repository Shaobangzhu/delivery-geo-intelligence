import test from "node:test";
import assert from "node:assert/strict";
import { once, EventEmitter } from "node:events";
import "./support/environment.mjs";
import { ProviderObservability } from "../dist/observability/collector.js";
import { createHealthProbe } from "../dist/observability/routes.js";
import { monitorMongo } from "../dist/observability/mongodb.js";
import { createArcGisGeocoder } from "../dist/geocoding.js";
import { createAnalyst } from "../dist/ai/agent.js";
import { createApp } from "../dist/app.js";
const config = { mongodb: true, arcgis_geocoding: true, openai: true };
const row = (o, id) => o.snapshot().providers.find((p) => p.provider === id);
const secret = "SYNTHETIC_API_KEY_NEVER_RETAIN";
const address = "404 Synthetic Residential Lane, Unit TEST";
const sentinels = [secret, address, "SYNTHETIC_PROMPT", "SYNTHETIC_COMPLETION", "Authorization", "0.123456", "0.654321", "RAW_PROVIDER_EXCEPTION"];
const privateError = (name = "Error", status) => Object.assign(new Error("RAW_PROVIDER_EXCEPTION " + address), { name, status, response: { Authorization: secret } });
const assertPrivate = (data) => { const text = JSON.stringify(data); for (const s of sentinels) assert.ok(!text.includes(s), `Forbidden telemetry sentinel: ${s}`); };
const payload = { spatialReference: { wkid: 4326 }, candidates: [{ score: 99, location: { x: 0.123456, y: 0.654321 }, attributes: { Addr_type: "PointAddress" } }] };
const cases = [
  ["success", () => new Response(JSON.stringify(payload)), null, "operational"],
  ["no match", () => new Response(JSON.stringify({ ...payload, candidates: [] })), "no_match", "operational"],
  ["low confidence", () => new Response(JSON.stringify({ ...payload, candidates: [{ ...payload.candidates[0], score: 10 }] })), "low_confidence", "operational"],
  ["authentication", () => new Response("private", { status: 401 }), "authentication", "unavailable"],
  ["rate limit", () => new Response("private", { status: 429 }), "rate_limit", "unavailable"],
  ["provider 500", () => new Response("private", { status: 500 }), "provider_5xx", "unavailable"],
  ["network", () => { throw privateError(); }, "network", "unavailable"],
  ["timeout", () => { throw privateError(); }, "timeout", "unavailable"],
  ["malformed JSON", () => new Response("RAW_PROVIDER_EXCEPTION"), "invalid_response", "unavailable"]
];
for (const [name, response, category, state] of cases) test(`ArcGIS fault injection: ${name}`, async () => {
  let now = 100, calls = 0; const o = new ProviderObservability(config, () => now);
  const geocode = createArcGisGeocoder(secret, 2, async () => { calls++; now += 7; return response(); }, o, () => now,
    () => name === "timeout" ? AbortSignal.abort() : new AbortController().signal);
  if (category) await assert.rejects(geocode(address)); else assert.deepEqual((await geocode(address)).coordinates, [0.12, 0.65]);
  const p = row(o, "arcgis_geocoding"); assert.equal(calls, 1); assert.equal(p.sampleCount, 1); assert.equal(p.requestCount, 1);
  assert.equal(p.lastErrorCategory, category); assert.equal(p.status, state); assert.equal(p.latency.p95Ms, 7);
  assert.equal(p.successCount + p.failureCount + p.noMatchCount + p.lowConfidenceCount, p.sampleCount); assertPrivate(o);
});
test("missing ArcGIS credential fails before any request", () => {
  let calls = 0; const o = new ProviderObservability({ ...config, arcgis_geocoding: false });
  assert.throws(() => createArcGisGeocoder("  ", 2, () => { calls++; }, o));
  assert.equal(calls, 0); assert.equal(row(o, "arcgis_geocoding").status, "not_configured"); assert.equal(row(o, "arcgis_geocoding").sampleCount, 0);
});
const registry = () => ({ definitions: [{ type: "function", name: "get_period_summary" }], currentDate: "2026-10-23",
  execute: async () => ({ scope: "synthetic", summary: { totalDeliveries: 2 } }) });
const response = (output = [], output_text = "", usage) => ({ output, output_text, status: "completed", usage });
for (const [name, sdk, category] of [
  ["missing configuration", null, "configuration"],
  ["rate limit", { create: async () => { throw privateError("Error", 429); } }, "rate_limit"],
  ["authentication", { create: async () => { throw privateError("Error", 403); } }, "authentication"],
  ["provider 5xx", { create: async () => { throw privateError("Error", 503); } }, "provider_5xx"],
  ["network", { create: async () => { throw privateError("APIConnectionError"); } }, "network"],
  ["malformed completion", { create: async () => null }, "invalid_response"]
]) test(`OpenAI fault injection: ${name}`, async () => {
  const o = new ProviderObservability({ ...config, openai: sdk !== null });
  await assert.rejects(createAnalyst(sdk, "synthetic", o.observeAi)("SYNTHETIC_PROMPT", registry(), "private"));
  const p = row(o, "openai"); assert.equal(p.requestCount, 1); assert.equal(p.ai.providerCalls, sdk ? 1 : 0);
  assert.equal(p.lastErrorCategory, category); assert.equal(p.ai.inputTokens, null);
  assert.equal(p.status, sdk ? "unavailable" : "not_configured"); assertPrivate(o);
});
for (const usage of [undefined, { input_tokens: 10, output_tokens: 3, total_tokens: 13 }]) test(`one successful analyst request / two model calls with ${usage ? "reported" : "missing"} usage`, async () => {
  const o = new ProviderObservability(config); let calls = 0;
  const sdk = { create: async (input) => {
    if (++calls === 1) return response([{ type: "function_call", name: "get_period_summary", arguments: "{}", call_id: "synthetic" }], "", usage);
    const evidence = JSON.parse(input.input.find((i) => i.type === "function_call_output").output).evidence;
    return response([], JSON.stringify({ explanation: "SYNTHETIC_COMPLETION", factIds: [evidence[0].id], comparison: "none" }), usage);
  } };
  const answer = await createAnalyst(sdk, "synthetic", (diagnostics) => { o.observeAi(diagnostics); throw privateError(); })("SYNTHETIC_PROMPT", registry(), "private");
  assert.match(answer.answer, /SYNTHETIC_COMPLETION/);
  const p = row(o, "openai"); assert.equal(p.successCount, 1); assert.equal(p.requestCount, 1); assert.equal(p.ai.providerCalls, 2);
  assert.equal(p.ai.providerErrors, 0); assert.equal(p.ai.usageSamples, usage ? 2 : 0); assert.equal(p.ai.inputTokens, usage ? 20 : null);
  assert.equal(p.ai.outputTokens, usage ? 6 : null); assertPrivate(o);
});
test("AI deadline and Mongo health deadline use fake timers with exact bounds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const o = new ProviderObservability(config, () => 1);
  const analyst = createAnalyst({ create: () => new Promise(() => {}) }, "synthetic", o.observeAi, 100);
  const rejected = assert.rejects(analyst("SYNTHETIC_PROMPT", registry(), "private"), { code: "timeout_or_cancelled" });
  t.mock.timers.tick(100); await rejected; assert.equal(row(o, "openai").lastErrorCategory, "timeout");
  const probe = createHealthProbe(() => new Promise(() => {}), o, () => 1, 100, 0);
  const pending = probe(); t.mock.timers.tick(100); await pending;
  assert.equal(row(o, "mongodb").sampleCount, 1); assert.equal(row(o, "mongodb").lastErrorCategory, "timeout");
});
test("Mongo transient connectivity errors, recovery, and failing sinks remain isolated", async () => {
  let fail = true; const o = new ProviderObservability(config);
  const probe = createHealthProbe(async () => { if (fail) throw privateError("MongoNetworkError"); }, o, Date.now, 100, 0);
  await probe(); assert.equal(row(o, "mongodb").lastErrorCategory, "connectivity"); assert.equal(row(o, "mongodb").status, "unavailable");
  fail = false; await probe(); assert.equal(row(o, "mongodb").successCount, 1); assert.equal(row(o, "mongodb").failureCount, 1);
  const broken = { record() { throw privateError(); } };
  await createHealthProbe(async () => {}, broken)();
  const emitter = new EventEmitter(); const detach = monitorMongo(emitter, broken);
  assert.doesNotThrow(() => emitter.emit("commandSucceeded", { commandName: "find", duration: 2 })); detach();
  // Analyst's existing completion-callback isolation must also preserve business success.
  const safe = createAnalyst(null, "synthetic", () => { throw privateError(); });
  await assert.rejects(safe("SYNTHETIC_PROMPT", registry(), "private"), { code: "configuration_missing" });
});
test("p95 is nearest-rank over exact retained samples; boundaries and restarts preserve unknowns", () => {
  let now = 0; const o = new ProviderObservability(config, () => now);
  for (let durationMs = 1; durationMs <= 20; durationMs++) o.record({ provider: "mongodb", operation: "database_read", durationMs, outcome: "success", evidence: "success" });
  assert.deepEqual(row(o, "mongodb").latency, { sampleCount: 20, meanMs: 10.5, p50Ms: 10, p95Ms: 19 });
  now = 3_600_000; assert.equal(o.snapshot("1h").providers[0].sampleCount, 0); assert.equal(row(o, "mongodb").sampleCount, 20);
  now = 86_400_000; assert.equal(row(o, "mongodb").latency.p95Ms, null);
  assert.equal(row(new ProviderObservability(config), "openai").ai.inputTokens, null);
});
test("system API and retained telemetry exclude commands, credentials, residences, prompts and exception payloads", async () => {
  const o = new ProviderObservability(config), emitter = new EventEmitter(); const stop = monitorMongo(emitter, o);
  emitter.emit("commandFailed", { commandName: "insert", duration: 4, command: { insert: address, Authorization: secret }, failure: privateError("MongoNetworkError"), reply: payload });
  o.record({ provider: "arcgis_geocoding", operation: "geocode", outcome: "success", evidence: "success", durationMs: 1, Authorization: secret, address, payload });
  await assert.rejects(createAnalyst({ create: async () => { throw privateError("APIConnectionError"); } }, "synthetic", o.observeAi)("SYNTHETIC_PROMPT", registry(), "private"));
  const db = { collection: () => ({}), command: async () => { throw privateError("MongoNetworkError"); } };
  const never = () => { throw new Error("Paid provider attempted"); };
  const server = createApp(db, never, never, undefined, undefined, o).listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    for (const path of ["status", "metrics?window=1h", "metrics?window=24h"]) {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/api/system/${path}`); assert.equal(r.status, 200); assertPrivate(await r.json());
    }
    assertPrivate(o); assert.equal(row(o, "mongodb").sampleCount, 2); // failed command + single status ping, not metrics reads
  } finally { stop(); await new Promise((resolve) => server.close(resolve)); }
});


test("validation/internal failures supply no outage evidence; malformed provider structures do", async () => {
  const o = new ProviderObservability(config);
  await assert.rejects(createAnalyst({ create: async () => { throw new Error("must not run"); } }, "synthetic", o.observeAi)("", registry(), "id"));
  assert.equal(row(o, "openai").lastErrorCategory, "request_rejected"); assert.equal(row(o, "openai").status, "not_yet_verified");
  const brokenRegistry = { get currentDate() { throw privateError(); }, definitions: [] };
  await assert.rejects(createAnalyst({ create: async () => response() }, "synthetic", o.observeAi)("SYNTHETIC_PROMPT", brokenRegistry, "id"));
  assert.equal(row(o, "openai").ai.providerCalls, 0);
  assert.equal(row(o, "openai").lastErrorCategory, "internal"); assert.equal(row(o, "openai").status, "not_yet_verified");
  assertPrivate(o);
});
