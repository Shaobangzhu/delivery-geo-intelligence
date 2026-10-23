export type Window = "1h" | "24h";
export const ids = ["mongodb", "arcgis_geocoding", "openai"] as const;
export const states = ["not_configured", "not_yet_verified", "operational", "degraded", "unavailable"] as const;
export const categories = ["network", "timeout", "rate_limit", "authentication", "configuration", "provider", "invalid_response", "no_match", "low_confidence", "request_rejected", "internal"] as const;
export interface Provider {
  provider: typeof ids[number]; configured: boolean | null; status: typeof states[number];
  lastSuccessAt: string | null; lastUpdatedAt: string | null; lastErrorCategory: string | null;
  sampleCount: number; requestCount: number; successCount: number; failureCount: number; noMatchCount: number; lowConfidenceCount: number;
  latency: { sampleCount: number; p50Ms: number | null; p95Ms: number | null };
  errorCounts: Record<string, number>; operations: Record<string, number>;
  model: string | null;
  healthCheck: { timestamp: string; durationMs: number; outcome: "success" | "failure" } | null;
  ai: { analystRequests: number; providerCalls: number; providerErrors: number; usageSamples: number; inputTokens: number | null; outputTokens: number | null } | null;
}
export interface Snapshot { schemaVersion: 1; window: Window; generatedAt: string; startedAt: string; incomplete: boolean; providers: Provider[] }
const bad = () => { throw new Error("invalid_response"); };
const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : bad();
const number = (v: unknown): number => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : bad();
const count = (v: unknown): number => Number.isSafeInteger(number(v)) ? v as number : bad();
const optionalNumber = (v: unknown) => v === null ? null : number(v);
const date = (v: unknown): string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : bad();
const optionalDate = (v: unknown) => v === null ? null : date(v);
const enumValue = <T extends string>(v: unknown, choices: readonly T[]): T => choices.includes(v as T) ? v as T : bad();
const counts = (v: unknown, keys: readonly string[]) => { const row = object(v); return Object.fromEntries(keys.map((key) => [key, count(row[key])])); };
export function parseSnapshot(input: unknown, window: Window): Snapshot {
  const root = object(input);
  if (root.schemaVersion !== 1 || root.window !== window || typeof root.incomplete !== "boolean" || !Array.isArray(root.providers) || root.providers.length !== 3) return bad();
  const providers = root.providers.map((input): Provider => {
    const p = object(input), latency = object(p.latency);
    const provider = enumValue(p.provider, ids);
    if (p.configured !== null && typeof p.configured !== "boolean") return bad();
    const a = p.ai === null ? null : object(p.ai);
    if ((provider === "openai") !== (a !== null)) return bad();
    const health = p.healthCheck == null ? null : object(p.healthCheck);
    const model = p.model == null ? null : typeof p.model === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(p.model) ? p.model : bad();
    return { provider, configured: p.configured as boolean | null, status: enumValue(p.status, states),
      lastSuccessAt: optionalDate(p.lastSuccessAt), lastUpdatedAt: optionalDate(p.lastUpdatedAt), lastErrorCategory: p.lastErrorCategory === null ? null : enumValue(p.lastErrorCategory, categories),
      sampleCount: count(p.sampleCount), requestCount: count(p.requestCount), successCount: count(p.successCount), failureCount: count(p.failureCount), noMatchCount: count(p.noMatchCount), lowConfidenceCount: count(p.lowConfidenceCount),
      latency: { sampleCount: count(latency.sampleCount), p50Ms: optionalNumber(latency.p50Ms), p95Ms: optionalNumber(latency.p95Ms) },
      errorCounts: counts(p.errorCounts, categories), operations: counts(p.operations, ["database_read", "database_write", "database_other", "health_ping", "geocode", "analyst_request"]), model,
      healthCheck: health ? { timestamp: date(health.timestamp), durationMs: number(health.durationMs), outcome: enumValue(health.outcome, ["success", "failure"] as const) } : null,
      ai: a ? { analystRequests: count(a.analystRequests), providerCalls: count(a.providerCalls), providerErrors: count(a.providerErrors), usageSamples: count(a.usageSamples), inputTokens: optionalNumber(a.inputTokens), outputTokens: optionalNumber(a.outputTokens) } : null };
  });
  if (new Set(providers.map((p) => p.provider)).size !== 3) return bad();
  return { schemaVersion: 1, window, generatedAt: date(root.generatedAt), startedAt: date(root.startedAt), incomplete: root.incomplete, providers };
}
export async function loadSnapshot(kind: "status" | "metrics", window: Window, signal: AbortSignal) {
  const response = await fetch(kind === "status" ? "/api/system/status" : `/api/system/metrics?window=${window}`, { signal, cache: "no-store" });
  if (!response.ok) throw new Error("backend_unavailable");
  return parseSnapshot(await response.json(), kind === "status" ? "24h" : window);
}
