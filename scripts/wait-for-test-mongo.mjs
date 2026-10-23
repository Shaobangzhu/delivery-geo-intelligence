import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { serviceUri, TestMongoClient } from "../backend/test/support/database.mjs";

class ReadinessError extends Error {}
function category(error) {
  if (error?.code === 18 || error?.code === 13) return "authentication";
  if (["MongoNetworkTimeoutError", "MongoOperationTimeoutError"].includes(error?.name)) return "timeout";
  if (["MongoServerSelectionError", "MongoNetworkError"].includes(error?.name)) return "connectivity";
  return "probe_failed";
}

// Only the explicitly guarded, synthetic CI service can be probed. Never read dotenv,
// use MONGODB_URI, inspect records, create collections or perform cleanup here.
export async function waitForTestMongo({
  env = process.env, attempts = 20, retryDelayMs = 500, wait = delay, log = console.log,
  createClient = (uri) => new TestMongoClient(uri, {
    serverSelectionTimeoutMS: 1000, connectTimeoutMS: 1000, socketTimeoutMS: 1500,
    timeoutMS: 1500, maxPoolSize: 1, retryReads: false, retryWrites: false
  })
} = {}) {
  let uri;
  try { uri = serviceUri(env); } catch { throw new ReadinessError("mongo_readiness_invalid_test_configuration"); }
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 20 ||
      !Number.isInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 1000) {
    throw new ReadinessError("mongo_readiness_invalid_retry_budget");
  }
  let lastCategory;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let client, ready = false, cleanupFailed = false;
    try {
      client = createClient(uri);
      await client.connect();
      const result = await client.db("readiness_test").command({ ping: 1 }, { timeoutMS: 1500 });
      if (result?.ok !== 1) throw new ReadinessError("invalid_ping_response");
      ready = true;
    } catch (error) {
      lastCategory = category(error);
    } finally {
      // Close before retry or success. A cleanup fault must not be reported as ready.
      if (client) {
        try { await client.close(); } catch { cleanupFailed = true; }
      }
    }
    if (cleanupFailed) throw new ReadinessError("mongo_readiness_cleanup_failed");
    if (ready) {
      log(`mongo_readiness_ready attempt=${attempt}`);
      return;
    }
    log(`mongo_readiness_attempt_failed attempt=${attempt}/${attempts} category=${lastCategory}`);
    if (lastCategory === "authentication" || attempt === attempts) break;
    await wait(retryDelayMs);
  }
  throw new ReadinessError(`mongo_readiness_failed category=${lastCategory}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await waitForTestMongo(); } catch (error) {
    // No raw driver exception, URI, credentials, command response or environment dump.
    console.error(error instanceof ReadinessError ? error.message : "mongo_readiness_internal_failure");
    process.exitCode = 1;
  }
}
