import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "./support/scoped-test.mjs";
import { waitForTestMongo } from "../../scripts/wait-for-test-mongo.mjs";

const env = {
  DGI_TEST_MONGO_MODE: "service",
  DGI_CI_MONGO_URI: "mongodb://dgi_ci:synthetic_ci_only@127.0.0.1:1/dgi_ci_test?authSource=admin"
};
function fixture(failures = []) {
  const calls = { connect: 0, ping: 0, close: 0, waits: [], logs: [] };
  return {
    calls, env, attempts: 3,
    log: (line) => calls.logs.push(line), wait: async (ms) => { calls.waits.push(ms); },
    createClient: (uri) => {
      assert.equal(uri, env.DGI_CI_MONGO_URI);
      return {
        async connect() {
          calls.connect++;
          const error = failures.shift();
          if (error) throw error;
        },
        db(name) {
          assert.equal(name, "readiness_test");
          return { async command(command, options) {
            assert.deepEqual(command, { ping: 1 });
            assert.deepEqual(options, { timeoutMS: 1500 });
            calls.ping++;
            return { ok: 1 };
          } };
        },
        async close() { calls.close++; }
      };
    }
  };
}

test("Mongo readiness authenticates/pings, retries transient failures, closes every attempt", async () => {
  const f = fixture([{ name: "MongoNetworkError" }, { name: "MongoNetworkTimeoutError" }]);
  await waitForTestMongo(f);
  assert.equal(f.calls.connect, 3); assert.equal(f.calls.close, 3); assert.equal(f.calls.ping, 1);
  assert.deepEqual(f.calls.waits, [500, 500]);
  assert.equal(f.calls.logs.at(-1), "mongo_readiness_ready attempt=3");
});

test("Mongo readiness exhausts its budget and never logs raw provider or credential data", async () => {
  const secret = "SYNTHETIC_SECRET_not_a_real_credential";
  const f = fixture(Array.from({ length: 3 }, () => ({ name: "MongoServerSelectionError", message: secret, cause: { uri: env.DGI_CI_MONGO_URI } })));
  await assert.rejects(waitForTestMongo(f), /^Error: mongo_readiness_failed category=connectivity$/);
  assert.equal(f.calls.connect, 3); assert.equal(f.calls.close, 3); assert.equal(f.calls.ping, 0);
  assert.equal(f.calls.waits.length, 2);
  assert.ok(!f.calls.logs.join("\n").includes(secret));
  assert.ok(!f.calls.logs.join("\n").includes(env.DGI_CI_MONGO_URI));
});

test("Mongo readiness rejects unsafe/missing service configuration before constructing a driver", async () => {
  for (const input of [{}, { ...env, DGI_TEST_MONGO_MODE: "local" },
    { ...env, DGI_CI_MONGO_URI: "mongodb://127.0.0.1:1/delivery_geo_intelligence" },
    { ...env, DGI_CI_MONGO_URI: env.DGI_CI_MONGO_URI.replace("127.0.0.1", "example.invalid") }]) {
    const f = fixture();
    await assert.rejects(waitForTestMongo({ ...f, env: input }), /mongo_readiness_invalid_test_configuration/);
    assert.equal(f.calls.connect, 0);
  }
});

test("Mongo readiness stops immediately on an authentication failure", async () => {
  const f = fixture([{ code: 18, message: "SYNTHETIC_SECRET" }]);
  await assert.rejects(waitForTestMongo(f), /mongo_readiness_failed category=authentication/);
  assert.equal(f.calls.connect, 1); assert.equal(f.calls.close, 1);
  assert.deepEqual(f.calls.waits, []);
});

test("Mongo readiness requires an acknowledged ping and reports cleanup errors as failures", async () => {
  const f = fixture();
  const client = f.createClient(env.DGI_CI_MONGO_URI);
  await assert.rejects(waitForTestMongo({ ...f, attempts: 1,
    createClient: () => ({ ...client, db: () => ({ command: async () => ({ ok: 0 }) }) }) }), /mongo_readiness_failed category=probe_failed/);
  await assert.rejects(waitForTestMongo({ ...f,
    createClient: () => ({ ...client, close: async () => { throw new Error("SYNTHETIC_SECRET"); } }) }), /mongo_readiness_cleanup_failed/);
  assert.ok(!f.calls.logs.some((line) => line.startsWith("mongo_readiness_ready")));
});

test("Mongo readiness rejects an unbounded retry budget", async () => {
  for (const options of [{ attempts: 0 }, { attempts: 21 }, { retryDelayMs: -1 }, { retryDelayMs: 1001 }]) {
    const f = fixture();
    await assert.rejects(waitForTestMongo({ ...f, ...options }), /mongo_readiness_invalid_retry_budget/);
    assert.equal(f.calls.connect, 0);
  }
});

test("Mongo readiness CLI exits nonzero with sanitized configuration diagnostics", () => {
  const result = spawnSync(process.execPath, ["scripts/wait-for-test-mongo.mjs"], {
    cwd: new URL("../../", import.meta.url), encoding: "utf8", timeout: 5000,
    env: { PATH: process.env.PATH, DGI_TEST_MONGO_MODE: "service", DGI_CI_MONGO_URI: "SYNTHETIC_SECRET" }
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), "mongo_readiness_invalid_test_configuration");
  assert.ok(!result.stderr.includes("SYNTHETIC_SECRET"));
});
