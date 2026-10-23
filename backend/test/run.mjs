import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server-core";

// No dotenv, existing MongoDB URI, persistent volume, or user database is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const mongo = await MongoMemoryServer.create({
  binary: {
    version: "7.0.24",
    downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-binaries/", import.meta.url))
  },
  instance: { ip: "127.0.0.1", storageEngine: "wiredTiger" }
});

try {
  const files = (await readdir(new URL("./", import.meta.url)))
    .filter((file) => file.endsWith(".test.mjs")).sort().map((file) => `test/${file}`);
  if (files.length === 0) throw new Error("No backend test files found");
  const uri = mongo.getUri();
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-timeout=30000", ...files], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      TZ: "UTC",
      MONGODB_URI: uri,
      DGI_TEST_MONGODB_URI: uri,
      OPENAI_API_KEY: "",
      ARCGIS_GEOCODING_API_KEY: ""
    }
  });
  const forward = (signal) => child.kill(signal);
  const onInterrupt = () => forward("SIGINT");
  const onTerminate = () => forward("SIGTERM");
  process.on("SIGINT", onInterrupt);
  process.on("SIGTERM", onTerminate);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
} finally {
  await mongo.stop();
}
