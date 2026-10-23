export { TestMongoClient } from "./database.mjs";
import assert from "node:assert/strict";

// Fail before constructing a MongoClient when a test is invoked outside run.mjs.
export const testMongoUri = process.env.DGI_TEST_MONGODB_URI;
assert.ok(testMongoUri && (/^mongodb:\/\/127\.0\.0\.1:\d+\/$/.test(testMongoUri) || /^mongodb:\/\/dgi_ci:synthetic_ci_only@127\.0\.0\.1:\d+\/dgi_ci_test\?authSource=admin$/.test(testMongoUri)),
  "Use npm test: the test runner must provision a disposable loopback MongoDB");
assert.equal(process.env.MONGODB_URI, testMongoUri);

const fetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input);
  assert.equal(url.protocol, "http:", "Backend tests only allow local HTTP requests");
  assert.equal(url.hostname, "127.0.0.1", "External provider requests must be stubbed");
  return fetch(input, init);
};
