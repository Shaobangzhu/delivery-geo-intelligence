import type { MongoClient } from "mongodb";
import type { ProviderObservability, Observation } from "./collector.js";

// Subscribe only to completion events: never inspect commands, replies, namespaces or failures.
export function monitorMongo(client: MongoClient, observer: ProviderObservability): () => void {
  const record = (event: { commandName: string; duration: number }, failed: boolean) => {
    try {
      if (["ping", "hello", "isMaster", "endSessions"].includes(event.commandName)) return;
      const operation: Observation["operation"] = ["find", "aggregate", "getMore", "count", "distinct"].includes(event.commandName) ? "database_read"
        : ["insert", "update", "delete", "findAndModify"].includes(event.commandName) ? "database_write" : "database_other";
      observer.record({ provider: "mongodb", operation, durationMs: event.duration, outcome: failed ? "failure" : "success",
        evidence: failed ? "failure" : "success", errorCategory: failed ? "provider" : null });
    } catch { /* No telemetry error can reach the driver. */ }
  };
  const succeeded = (event: { commandName: string; duration: number }) => record(event, false);
  const failed = (event: { commandName: string; duration: number }) => record(event, true);
  client.on("commandSucceeded", succeeded); client.on("commandFailed", failed);
  return () => { client.off("commandSucceeded", succeeded); client.off("commandFailed", failed); };
}
