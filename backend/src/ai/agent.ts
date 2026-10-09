import { z } from "zod";
import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses.js";
import { analystInstructions } from "./prompts.js";
import { AnalystError, type AiAnswer, type AiDiagnostics, type ResponsesClient } from "./types.js";
import type { ToolName, ToolRegistry } from "./tools.js";
import { createEvidenceCollector, requiresComparisonBoundary, validateNarrative } from "./evidence.js";

export const askSchema = z.strictObject({ question: z.string().trim().min(1).max(1000) });
export const AI_LIMITS = { rounds: 3, tools: 6, outputTokens: 1000, timeoutMs: 60_000, toolBytes: 48_000, totalToolBytes: 128_000 } as const;
const finalSchema = z.strictObject({ explanation: z.string().trim().min(1).max(4000), factIds: z.array(z.string()).max(12), comparison: z.enum(["none", "limited"]) });
const finalFormat = { type: "json_schema" as const, name: "dgi_answer", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["explanation", "factIds", "comparison"], properties: {
    comparison: { type: "string", enum: ["none", "limited"] }, explanation: { type: "string" }, factIds: { type: "array", items: { type: "string" } }
  } } };
const tokenCount = z.number().int().nonnegative();
const usageSchema = z.object({ input_tokens: tokenCount, output_tokens: tokenCount, total_tokens: tokenCount,
  input_tokens_details: z.object({ cached_tokens: tokenCount.optional(), cache_write_tokens: tokenCount.optional() }).optional(),
  output_tokens_details: z.object({ reasoning_tokens: tokenCount.optional() }).optional() });
async function bounded<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new AnalystError("timeout_or_cancelled", 503);
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new AnalystError("timeout_or_cancelled", 503)); signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([promise, interrupted]); }
  finally { signal.removeEventListener("abort", abort); }
}
export function createAnalyst(client: ResponsesClient | null, model: string,
  observe: (metadata: AiDiagnostics) => void = () => {}, timeoutMs: number = AI_LIMITS.timeoutMs) {
  const diagnose = (metadata: AiDiagnostics) => {
    try { observe(metadata); } catch { /* Metadata diagnostics must not break a request. */ }
  };
  const run = async (question: string, registry: ToolRegistry, requestId: string, parentSignal?: AbortSignal): Promise<AiAnswer> => {
    const started = Date.now(), controller = new AbortController();
    const cancel = () => controller.abort(); parentSignal?.addEventListener("abort", cancel, { once: true });
    if (parentSignal?.aborted) cancel();
    const timer = setTimeout(cancel, timeoutMs);
    const metadata: AiDiagnostics = { requestId, model, tools: [], toolCallCount: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, usageAvailable: false, providerCallCount: 0, providerErrorCount: 0, toolPayloadBytes: 0, providerUsage: [], outcome: "failure" };
    try {
      if (!client) throw new AnalystError("configuration_missing", 503);
      if (!askSchema.safeParse({ question }).success) throw new AnalystError("invalid_question");
      const input: ResponseInput = [{ role: "user", content: question }], collector = createEvidenceCollector();
      const { facts } = collector;
      let rounds = 0;
      const limitations = new Set<string>(), callIds = new Set<string>();
      while (true) {
        if (controller.signal.aborted) throw new AnalystError("timeout_or_cancelled", 503);
        let response: Awaited<ReturnType<ResponsesClient["create"]>>;
        try {
          metadata.providerCallCount++;
          response = await bounded(client.create({ model, instructions: `${analystInstructions}\nTrusted request date (America/Los_Angeles): ${registry.currentDate}. Use asOf=null for current calendar periods.`, input, tools: registry.definitions,
            tool_choice: facts.size ? (rounds === AI_LIMITS.rounds || metadata.toolCallCount === AI_LIMITS.tools ? "none" : "auto") : "required",
            parallel_tool_calls: false, max_output_tokens: AI_LIMITS.outputTokens, store: false,
            text: { format: finalFormat } }, controller.signal), controller.signal);
        } catch (error) {
          metadata.providerErrorCount++;
          if (error instanceof AnalystError) throw error;
          const status = (error as { status?: unknown })?.status;
          const code = controller.signal.aborted ? "timeout_or_cancelled" : status === 429 ? "provider_rate_limited"
            : status === 401 || status === 403 ? "provider_authentication" : status === 404 ? "provider_configuration" : "provider_failure";
          throw new AnalystError(code, controller.signal.aborted || status === 429 ? 503 : 502);
        }
        if (response.usage) {
          const usage = usageSchema.safeParse(response.usage);
          if (!usage.success) throw new AnalystError("invalid_provider_response");
          metadata.providerUsage.push(usage.data);
          metadata.usageAvailable = true; metadata.inputTokens += usage.data.input_tokens; metadata.outputTokens += usage.data.output_tokens;
        }
        if (response.status !== "completed") throw new AnalystError("incomplete_provider_response");
        if (!Array.isArray(response.output)) throw new AnalystError("invalid_provider_response");
        const calls = response.output.filter((item) => item.type === "function_call");
        if (calls.length) {
          if (++rounds > AI_LIMITS.rounds || metadata.toolCallCount + calls.length > AI_LIMITS.tools) throw new AnalystError("tool_limit");
          // Retain output items, including reasoning, for the Responses continuation protocol.
          input.push(...response.output as ResponseInputItem[]);
          for (const call of calls) {
            if (controller.signal.aborted) throw new AnalystError("timeout_or_cancelled", 503);
            if (typeof call.call_id !== "string" || !call.call_id || call.call_id.length > 200 || callIds.has(call.call_id)) throw new AnalystError("invalid_tool_call");
            callIds.add(call.call_id);
            if (!registry.definitions.some((tool) => tool.name === call.name)) throw new AnalystError("unknown_tool");
            if (typeof call.arguments !== "string" || call.arguments.length > 2000) throw new AnalystError("invalid_tool_arguments");
            let args: unknown;
            try { args = JSON.parse(call.arguments); } catch { throw new AnalystError("invalid_tool_arguments"); }
            metadata.toolCallCount++; metadata.tools.push(call.name);
            let data: unknown;
            try { data = await bounded(registry.execute(call.name as ToolName, args, controller.signal), controller.signal); }
            catch (error) { if (error instanceof AnalystError) throw error; throw new AnalystError("tool_failure", 503); }
            const result = data as { limitations?: string[]; backfillWorkflows?: string[] };
            for (const note of result.limitations ?? []) limitations.add(note);
            const evidence = collector.collect(data, call.name, metadata.toolCallCount);
            // Evidence already contains the projected values; avoid duplicating the
            // entire aggregate tree in every continuation's input.
            const sources = new Map<string, { id: string; source: (typeof evidence)[number]["source"] }>();
            const compact = evidence.map(({ source, ...fact }) => {
              const key = JSON.stringify(source);
              if (!sources.has(key)) sources.set(key, { id: `${source.execution}s${sources.size + 1}`, source });
              return { ...fact, sourceId: sources.get(key)!.id };
            });
            const payload = JSON.stringify({ evidence: compact, sources: [...sources.values()], limitations: result.limitations ?? [], backfillWorkflows: result.backfillWorkflows ?? [] });
            const size = Buffer.byteLength(payload); metadata.toolPayloadBytes += size;
            if (size > AI_LIMITS.toolBytes || metadata.toolPayloadBytes > AI_LIMITS.totalToolBytes) throw new AnalystError("tool_payload_limit", 503);
            input.push({ type: "function_call_output", call_id: call.call_id, output: payload });
          }
          continue;
        }
        // Never accept provider-only prose as a successful operational analysis.
        if (!metadata.toolCallCount || !facts.size) throw new AnalystError("no_tool_evidence");
        let parsed: z.infer<typeof finalSchema>;
        try { parsed = finalSchema.parse(JSON.parse(response.output_text)); } catch { throw new AnalystError("ungrounded_answer"); }
        const selected = [...new Set(parsed.factIds)].map((id) => facts.get(id));
        if (selected.some((fact) => !fact) || !selected.length) throw new AnalystError("ungrounded_answer");
        const trusted = selected.filter((fact) => fact !== undefined);
        const boundary = requiresComparisonBoundary(trusted);
        if (boundary && parsed.comparison !== "limited") throw new AnalystError("scope_conflict");
        if (parsed.comparison === "none") validateNarrative(parsed.explanation);
        // Unsupported comparisons never inherit the model's interpretation. The
        // server renders a qualitative boundary and independent facts instead.
        const chinese = /\p{Script=Han}/u.test(question);
        const explanation = parsed.comparison === "limited"
          ? chinese ? "这些是不同范围或观察群体的独立结果，不能直接相加，也不能据此判断策略优劣、因果关系或前后改善。请分别查看期间、分母、样本数和完整性。"
            : "These are separate observations. Different periods, accounting bases or cohorts do not establish strategy superiority, causality or before/after improvement. Do not add income views; review each scope, denominator, sample size and completeness separately."
          : parsed.explanation;
        const scopes = [...new Set(trusted.map((fact) => `${fact.source.tool} [${fact.source.execution}]: ${fact.source.scope}; basis: ${fact.source.basis}; cohort: ${fact.source.cohort}${fact.source.eligibility ? `; ${fact.source.eligibility}` : ""}`))];
        const answer = `${explanation}\n\n${scopes.join("\n")}\n\n${trusted.map((fact) => `${fact.label}: ${fact.display}`).join("\n")}`;
        metadata.outcome = "success";
        return { requestId, answer, toolsUsed: [...new Set(metadata.tools)],
          warnings: ["Recorded observations only; LLM explanations may be mistaken. Metrics below come from deterministic tools.", "Different tool scopes/cohorts may not be directly comparable; refresh after record edits.", ...limitations] };
      }
    } catch (error) {
      metadata.outcome = error instanceof AnalystError ? error.code : "internal_failure";
      if (error instanceof AnalystError) throw error;
      throw new AnalystError("internal_failure", 503);
    } finally {
      clearTimeout(timer); parentSignal?.removeEventListener("abort", cancel);
      metadata.latencyMs = Date.now() - started;
      diagnose(metadata);
    }
  };
  return Object.assign(run, {
    invalidQuestion(requestId: string, latencyMs: number) {
      diagnose({ requestId, model, tools: [], toolCallCount: 0, latencyMs, inputTokens: 0, outputTokens: 0,
        usageAvailable: false, providerCallCount: 0, providerErrorCount: 0, toolPayloadBytes: 0, providerUsage: [], outcome: "invalid_question" });
    }
  });
}
export type Analyst = ReturnType<typeof createAnalyst>;
