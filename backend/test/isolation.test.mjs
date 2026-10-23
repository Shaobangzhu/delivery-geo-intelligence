import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "./support/scoped-test.mjs";
import "./support/environment.mjs";

test("backend test requests reject live services before making a network request", () => {
  assert.throws(() => fetch("https://www.arcgis.com/"), /only allow local HTTP/);
  assert.throws(() => fetch("http://api.openai.com/"), /must be stubbed/);
});

test("database test setup fails closed outside the disposable runner", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", "import './test/support/environment.mjs'"], {
    cwd: new URL("../", import.meta.url),
    encoding: "utf8",
    env: { PATH: process.env.PATH, MONGODB_URI: "mongodb://127.0.0.1:27017/personal" }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runner must provision a disposable loopback MongoDB/);
});

test("CI service selection and database cleanup reject real targets", async () => {
  const { serviceUri, TestMongoClient } = await import("./support/database.mjs");
  assert.throws(() => serviceUri({ DGI_TEST_MONGO_MODE: "service", DGI_CI_MONGO_URI: "mongodb://127.0.0.1:27017/delivery_geo_intelligence" }));
  assert.throws(() => serviceUri({ DGI_CI_MONGO_URI: "mongodb://dgi_ci:synthetic_ci_only@127.0.0.1:27017/dgi_ci_test?authSource=admin" }));
  const client = new TestMongoClient("mongodb://127.0.0.1:1/");
  try {
    assert.throws(() => client.db("delivery_geo_intelligence")); assert.throws(() => client.db());
    assert.match(client.db("synthetic_test").databaseName, /^dgi_ci_test_[a-f0-9]{24}$/);
    assert.equal(client.db("synthetic_test").databaseName, client.db("synthetic_test").databaseName);
  } finally { await client.close(); }
});
