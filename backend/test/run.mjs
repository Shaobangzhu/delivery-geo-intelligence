import { spawn } from "node:child_process";
import { readdir, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MongoMemoryServer } from "mongodb-memory-server-core";

// No dotenv, existing MongoDB URI, persistent volume, or user database is used.
const root = fileURLToPath(new URL("../", import.meta.url));
const scope = process.argv[2] ?? "all";
if (!["all", "unit", "integration"].includes(scope)) throw new Error("Invalid test scope");
const service = process.env.DGI_TEST_MONGO_MODE === "service";
const { serviceUri } = await import("./support/database.mjs");
const externalUri = service ? serviceUri(process.env) : null;
const mongo = service || scope === "unit" ? null : await MongoMemoryServer.create({
  binary: {
    version: "7.0.24",
    downloadDir: fileURLToPath(new URL("../../node_modules/.cache/mongodb-binaries/", import.meta.url))
  },
  instance: { ip: "127.0.0.1", storageEngine: "wiredTiger" }
});

try {
  const names = (await readdir(new URL("./", import.meta.url))).filter((file) => file.endsWith(".test.mjs")).sort();
  const files = [];
  for (const name of names) {
    if (scope === "integration" && !(await readFile(new URL(name, import.meta.url), "utf8")).includes("test.integration(")) continue;
    files.push(`test/${name}`);
  }
  if (files.length === 0) throw new Error("No backend test files found");
  const uri = externalUri ?? mongo?.getUri() ?? "mongodb://127.0.0.1:1/";
  await mkdir(new URL("../../reports/", import.meta.url), { recursive: true });
  const child = spawn(process.execPath, ["--test", "--test-concurrency=1", "--test-timeout=30000", "--test-reporter=spec", "--test-reporter-destination=stdout", "--test-reporter=junit", `--test-reporter-destination=../reports/backend-${scope}.xml`, ...files], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: "test",
      DGI_TEST_SCOPE: scope,
      TZ: "UTC",
      MONGODB_URI: uri,
      DGI_TEST_MONGODB_URI: uri,
      OPENAI_API_KEY: "",
      ARCGIS_GEOCODING_API_KEY: ""
    }
  });
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 120_000);
  watchdog.unref();
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
    clearTimeout(watchdog);
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onTerminate);
  }
} finally {
  await mongo?.stop();
}
