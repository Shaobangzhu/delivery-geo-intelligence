import type { ResponseCreateParamsNonStreaming, Response } from "openai/resources/responses/responses.js";

export interface ProviderUsage {
  input_tokens: number; output_tokens: number; total_tokens: number;
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  output_tokens_details?: { reasoning_tokens?: number };
}

export interface ResponsesClient {
  create(input: ResponseCreateParamsNonStreaming, signal: AbortSignal): Promise<Pick<Response, "output" | "output_text" | "status" | "usage">>;
}
export interface AiDiagnostics {
  requestId: string; model: string; tools: string[]; toolCallCount: number;
  latencyMs: number; inputTokens: number; outputTokens: number; usageAvailable: boolean; outcome: string;
  providerCallCount: number; providerErrorCount: number; toolPayloadBytes: number;
  // Exact usage records, including cached/reasoning details when supplied. No prompts or tool data.
  providerUsage: ProviderUsage[];
}
export interface AiAnswer {
  requestId: string; answer: string; toolsUsed: string[]; warnings: string[];
}
export class AnalystError extends Error {
  constructor(public readonly code: string, public readonly status: 502 | 503 = 502) {
    super("DGI analysis is unavailable. Try again or review deterministic analytics.");
  }
}
export type ReadCoordinator = <T>(read: () => Promise<T>) => Promise<T>;
