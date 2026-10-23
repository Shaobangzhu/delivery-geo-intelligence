import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
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
