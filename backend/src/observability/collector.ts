import { z } from "zod";
import type { AiDiagnostics } from "../ai/types.js";

export const providers = ["mongodb", "arcgis_geocoding", "openai"] as const;
export type Provider = typeof providers[number];
export type OperationalState = "not_configured" | "not_yet_verified" | "operational" | "degraded" | "unavailable";
export type Configuration = Record<Provider, boolean | null>;
export const errorCategories = ["network", "timeout", "rate_limit", "authentication", "configuration", "provider", "invalid_response", "no_match", "low_confidence", "request_rejected", "internal"] as const;
export type ErrorCategory = typeof errorCategories[number];
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const observationSchema = z.object({
  provider: z.enum(providers), operation: z.enum(["database_read", "database_write", "database_other", "health_ping", "geocode", "analyst_request"]),
  outcome: z.enum(["success", "failure", "no_match", "low_confidence"]),
  evidence: z.enum(["success", "failure", "none"]),
  durationMs: z.number().finite().nonnegative(), errorCategory: z.enum(errorCategories).nullable().default(null),
  providerCalls: count.default(0), providerErrors: count.default(0), usageSamples: count.default(0),
  inputTokens: count.nullable().default(null), outputTokens: count.nullable().default(null)
});
export type Observation = z.input<typeof observationSchema>;
type Sample = z.output<typeof observationSchema> & { timestamp: number };
const DAY = 86_400_000;

export class ProviderObservability {
  private samples: Sample[] = [];
  private lastEvictedAt: number | null = null;
  readonly startedAt: number;
  constructor(readonly configuration: Configuration, private readonly now: () => number = Date.now, readonly capacity = 10_000) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100_000) throw new Error("Invalid telemetry capacity");
    this.startedAt = now();
  }
  record(input: unknown): void {
    // Explicit projection discards extra fields. Telemetry must never throw into business code.
    try {
      const parsed = observationSchema.safeParse(input);
      if (!parsed.success) return;
      const timestamp = this.now();
      if (!Number.isFinite(timestamp)) return;
      this.samples = this.samples.filter((row) => row.timestamp > timestamp - DAY);
      this.samples.push({ ...parsed.data, timestamp });
      if (this.samples.length > this.capacity) this.lastEvictedAt = this.samples.shift()!.timestamp;
    } catch { /* Observability is best effort. */ }
  }
  observeAi = (data: AiDiagnostics): void => {
    try {
      const category: ErrorCategory | null = data.providerFailureCategory ?? (data.outcome === "success" ? null
        : data.outcome === "provider_rate_limited" ? "rate_limit"
        : data.outcome === "timeout_or_cancelled" ? "timeout"
        : data.outcome === "provider_authentication" ? "authentication"
        : ["configuration_missing", "provider_configuration"].includes(data.outcome) ? "configuration"
        : data.providerErrorCount > 0 ? "provider" : "request_rejected");
      this.record({ provider: "openai", operation: "analyst_request", outcome: data.outcome === "success" ? "success" : "failure",
        evidence: data.providerErrorCount > 0 ? "failure" : data.providerCallCount > 0 ? "success" : "none",
        durationMs: data.latencyMs, errorCategory: category, providerCalls: data.providerCallCount, providerErrors: data.providerErrorCount,
        usageSamples: data.providerUsage.length, inputTokens: data.usageAvailable ? data.inputTokens : null, outputTokens: data.usageAvailable ? data.outputTokens : null });
    } catch { /* Never retain the diagnostic object or arbitrary strings. */ }
  };
  snapshot(window: "1h" | "24h" = "24h") {
    const now = this.now(), start = now - (window === "1h" ? DAY / 24 : DAY);
    const rows = this.samples.filter((row) => row.timestamp > start && row.timestamp <= now);
    return { schemaVersion: 1 as const, window, generatedAt: new Date(now).toISOString(), startedAt: new Date(this.startedAt).toISOString(),
      capacity: this.capacity, incomplete: this.lastEvictedAt !== null && this.lastEvictedAt > start,
      providers: providers.map((provider) => {
        const samples = rows.filter((row) => row.provider === provider), last = samples.at(-1);
        const evidence = samples.filter((row) => row.evidence !== "none"), latestEvidence = evidence.at(-1);
        const successful = evidence.filter((row) => row.evidence === "success");
        const errors = samples.filter((row) => row.errorCategory !== null);
        const infrastructureFailures = evidence.filter((row) => row.evidence === "failure");
        let status: OperationalState = "not_yet_verified";
        if (this.configuration[provider] === false) status = "not_configured";
        else if (latestEvidence?.evidence === "failure") status = successful.length ? "degraded" : "unavailable";
        else if (latestEvidence) status = infrastructureFailures.length ? "degraded" : "operational";
        const durations = samples.map((row) => row.durationMs).sort((a, b) => a - b);
        const sum = (field: "providerCalls" | "providerErrors" | "usageSamples") => samples.reduce((n, row) => n + row[field], 0);
        const usage = samples.filter((row) => row.inputTokens !== null && row.outputTokens !== null);
        const iso = (sample: Sample | undefined) => sample ? new Date(sample.timestamp).toISOString() : null;
        return { provider, configured: this.configuration[provider], status, lastSuccessAt: iso(successful.at(-1)),
          lastErrorCategory: errors.at(-1)?.errorCategory ?? null, lastUpdatedAt: iso(last), sampleCount: samples.length,
          requestCount: samples.length, successCount: samples.filter((row) => row.outcome === "success").length,
          failureCount: samples.filter((row) => row.outcome === "failure").length,
          noMatchCount: samples.filter((row) => row.outcome === "no_match").length, lowConfidenceCount: samples.filter((row) => row.outcome === "low_confidence").length,
          errorCounts: Object.fromEntries(errorCategories.map((category) => [category, samples.filter((row) => row.errorCategory === category).length])),
          operations: Object.fromEntries(["database_read", "database_write", "database_other", "health_ping", "geocode", "analyst_request"].map((op) => [op, samples.filter((row) => row.operation === op).length])),
          latency: { sampleCount: durations.length, meanMs: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null,
            p50Ms: durations.length ? durations[Math.ceil(durations.length * 0.5) - 1] : null, p95Ms: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : null },
          ai: provider === "openai" ? { analystRequests: samples.length, providerCalls: sum("providerCalls"), providerErrors: sum("providerErrors"),
            usageSamples: sum("usageSamples"), inputTokens: usage.length ? usage.reduce((n, row) => n + row.inputTokens!, 0) : null,
            outputTokens: usage.length ? usage.reduce((n, row) => n + row.outputTokens!, 0) : null } : null };
      }) };
  }
}
