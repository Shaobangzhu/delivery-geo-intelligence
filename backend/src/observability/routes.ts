import { mongoFailure } from "./failures.js";
import type { Express } from "express";
import type { Db } from "mongodb";
import { z } from "zod";
import { ProviderObservability } from "./collector.js";

export function createHealthProbe(ping: () => Promise<unknown>, observer: ProviderObservability, now = Date.now, timeoutMs = 1500, cacheMs = 5000) {
  let pending: Promise<void> | null = null, checkedAt: number | null = null;
  return () => {
    if (pending) return pending;
    if (checkedAt !== null && now() - checkedAt < cacheMs) return Promise.resolve();
    pending = (async () => {
      const start = now(); let timer: ReturnType<typeof setTimeout> | undefined; let timedOut = false;
      let errorCategory: ReturnType<typeof mongoFailure> | null = null;
      try {
        await Promise.race([Promise.resolve().then(ping), new Promise<never>((_, reject) => {
          timer = setTimeout(() => { timedOut = true; reject(new Error("Health timeout")); }, timeoutMs);
        })]);

      } catch (error) {
        errorCategory = timedOut ? "timeout" : mongoFailure(error);
      } finally { clearTimeout(timer); checkedAt = now(); pending = null; }
      try {
        observer.record({ provider: "mongodb", operation: "health_ping", outcome: errorCategory ? "failure" : "success",
          evidence: errorCategory ? "failure" : "success", durationMs: Math.max(0, now() - start), errorCategory });
      } catch { /* Only the optional telemetry sink is isolated, not the database probe. */ }
    })();
    return pending;
  };
}
export function registerSystemRoutes(app: Express, db: Db, observer: ProviderObservability) {
  const probe = createHealthProbe(() => db.command({ ping: 1 }, { timeoutMS: 1500 }), observer);
  const query = z.object({ window: z.enum(["1h", "24h"]) }).strict();
  app.get("/api/system/status", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (Object.keys(request.query).length) return response.status(400).json({ schemaVersion: 1, error: "invalid_query" });
    await probe();
    return response.json(observer.snapshot("24h"));
  });
  app.get("/api/system/metrics", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const parsed = query.safeParse(request.query);
    if (!parsed.success) return response.status(400).json({ schemaVersion: 1, error: "invalid_query" });
    return response.json(observer.snapshot(parsed.data.window));
  });
}
