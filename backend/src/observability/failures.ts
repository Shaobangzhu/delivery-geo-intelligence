import type { ErrorCategory } from "./collector.js";

// Read only numeric HTTP status and a fixed error-name discriminator. Never retain the error.
export function httpFailure(status: unknown): Extract<ErrorCategory, "authentication" | "rate_limit" | "provider_5xx" | "provider"> {
  if (status === 401 || status === 403 || status === 498 || status === 499) return "authentication";
  if (status === 429) return "rate_limit";
  if (typeof status === "number" && status >= 500 && status <= 599) return "provider_5xx";
  return "provider";
}
export function mongoFailure(error: unknown): ErrorCategory {
  const name = error instanceof Error ? error.name : "";
  // Driver error metadata only; messages/key values can contain personal records.
  const code = error instanceof Error && "code" in error ? error.code : undefined;
  if (name === "MongoServerError") {
    if (code === 11000 || code === 121) return "request_rejected";
    if (code === 13 || code === 18) return "authentication";
    if (code === 50 || code === 262) return "timeout";
  }
  if (["MongoOperationTimeoutError", "MongoNetworkTimeoutError"].includes(name)) return "timeout";
  if (["MongoNetworkError", "MongoServerSelectionError", "MongoTopologyClosedError", "MongoNotConnectedError"].includes(name)) return "connectivity";
  return "provider";
}
