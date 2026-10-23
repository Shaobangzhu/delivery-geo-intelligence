import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

export function serviceUri(env) {
  assert.equal(env.DGI_TEST_MONGO_MODE, "service", "Explicit test service mode required");
  assert.ok(/^mongodb:\/\/dgi_ci:synthetic_ci_only@127\.0\.0\.1:\d+\/dgi_ci_test\?authSource=admin$/.test(env.DGI_CI_MONGO_URI ?? ""), "Only the synthetic loopback CI service URI is allowed");
  return env.DGI_CI_MONGO_URI;
}
export class TestMongoClient extends MongoClient {
  db(name, options) {
    assert.equal(typeof name, "string", "Explicit synthetic database name required");
    assert.ok((name.includes("test") || name === "observability_synthetic") && /^[a-zA-Z0-9_]+$/.test(name), "Refusing a non-test database");
    return super.db(`dgi_ci_test_${createHash("sha256").update(name).digest("hex").slice(0, 24)}`, options);
  }
}
