import { z } from "zod";
import type { ResponseInput, ResponseInputItem } from "openai/resources/responses/responses.js";
import { analystInstructions } from "./prompts.js";
import { AnalystError, type AiAnswer, type AiDiagnostics, type ResponsesClient } from "./types.js";
import type { ToolName, ToolRegistry } from "./tools.js";

export const askSchema = z.strictObject({ question: z.string().trim().min(1).max(1000) });
export const AI_LIMITS = { rounds: 3, tools: 6, outputTokens: 1000, timeoutMs: 60_000, toolBytes: 48_000, totalToolBytes: 128_000 } as const;
const finalSchema = z.strictObject({ explanation: z.string().trim().min(1).max(4000), factIds: z.array(z.string()).max(12) });
const finalFormat = { type: "json_schema" as const, name: "dgi_answer", strict: true,
  schema: { type: "object", additionalProperties: false, required: ["explanation", "factIds"], properties: {
    explanation: { type: "string" }, factIds: { type: "array", items: { type: "string" } }
  } } };
interface Fact { id: string; label: string; display: string }
const labels: Record<string, string> = {
  totalEarnings: "Total earnings (cash basis)", knownPayoutTotal: "Known payout (may be partial)",
  knownAndEstimatedCost: "Known and estimated cost components (may be partial)", knownAndEstimatedTotal: "Known and estimated cost components (may be partial)",
  fullEconomicCost: "Full modeled vehicle cost (eligible cohort)", fullTotal: "Full modeled vehicle cost",
  estimatedEconomicProfit: "Estimated pre-tax economic profit", workPeriodRevenue: "Recorded work-period revenue",
  payoutPerRecordedHour: "Payout per recorded delivery hour", payoutPerRecordedMile: "Payout per recorded delivery mile",
  payoutPerSessionHour: "Payout per complete session hour", payoutPerSessionMile: "Payout per complete session mile",
  value: "Value", deliveryEarnings: "Known delivery earnings (USD)", prop22Earnings: "Actual received Prop 22 (USD)",
  actualAdjustment: "Actual received adjustment (USD)", knownTotal: "Known recorded delivery payout (USD)",
  adjustedEarningsPerHour: "Adjusted earnings (USD/hour)", adjustedEarningsPerMile: "Adjusted earnings (USD/mile)",
  get_period_summary: "Cash-basis summary", get_delivery_efficiency: "Delivery efficiency", get_session_efficiency: "Session efficiency",
  compare_strategies: "Strategy comparison", get_settlement_efficiency: "Work-period efficiency", get_data_quality: "Data completeness"
};
function labelFor(path: string[]) {
  return path.filter((key) => !["scope", "metrics", "summary", "strategies", "settlements", "dataQuality"].includes(key) && !/^\d+$/.test(key))
    .map((key) => labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")).join(" · ");
}
function collectFacts(data: unknown, facts: Map<string, Fact>, path: string[] = []): Fact[] {
  const added: Fact[] = [];
  const add = (display: string) => {
    const fact = { id: `e${facts.size + 1}`, label: labelFor(path), display }; facts.set(fact.id, fact); added.push(fact);
  };
  if (data && typeof data === "object" && !Array.isArray(data) && "value" in data && "unit" in data && "sampleCount" in data) {
    const metric = data as { value: number | null; unit: string; sampleCount: number; excludedCount: number; reasons?: string[] };
    add(`${metric.value === null ? "unavailable" : `${metric.value} ${metric.unit}`} (sample: ${metric.sampleCount}; excluded: ${metric.excludedCount}; reasons: ${metric.reasons?.join(", ") || "none"})`);
  } else if (data && typeof data === "object") {
    const row = data as Record<string, unknown>;
    if (typeof row.strategy === "string") path = [...path, row.strategy];
    if (typeof row.paymentDate === "string") path = [...path, `Payment ${row.paymentDate}; coverage ${row.coverageStartDate ?? "unavailable"}–${row.coverageEndDate ?? "unavailable"}`];
    for (const [key, value] of Object.entries(data)) {
      if (["limitations", "backfillWorkflows", "units", "settlementId"].includes(key)) continue;
      added.push(...collectFacts(value, facts, [...path, key]));
    }
  } else if (path.length) add(data === null ? "unavailable" : String(data));
  return added;
}
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
    const metadata: AiDiagnostics = { requestId, model, tools: [], toolCallCount: 0, latencyMs: 0, inputTokens: 0, outputTokens: 0, usageAvailable: false, outcome: "failure" };
    try {
      if (!client) throw new AnalystError("configuration_missing", 503);
      if (!askSchema.safeParse({ question }).success) throw new AnalystError("invalid_question");
      const input: ResponseInput = [{ role: "user", content: question }], facts = new Map<string, Fact>();
      let rounds = 0, bytes = 0;
      const scopes = new Map<string, string>();
      while (true) {
        if (controller.signal.aborted) throw new AnalystError("timeout_or_cancelled", 503);
        let response: Awaited<ReturnType<ResponsesClient["create"]>>;
        try {
          response = await bounded(client.create({ model, instructions: `${analystInstructions}\nTrusted request date (America/Los_Angeles): ${registry.currentDate}. Use asOf=null for current calendar periods.`, input, tools: registry.definitions,
            tool_choice: facts.size ? (rounds === AI_LIMITS.rounds || metadata.toolCallCount === AI_LIMITS.tools ? "none" : "auto") : "required",
            parallel_tool_calls: false, max_output_tokens: AI_LIMITS.outputTokens, store: false,
            text: { format: finalFormat } }, controller.signal), controller.signal);
        } catch (error) {
          if (error instanceof AnalystError) throw error;
          throw new AnalystError(controller.signal.aborted ? "timeout_or_cancelled" : "provider_failure", controller.signal.aborted ? 503 : 502);
        }
        if (response.usage) {
          metadata.usageAvailable = true; metadata.inputTokens += response.usage.input_tokens; metadata.outputTokens += response.usage.output_tokens;
        }
        if (response.status !== "completed") throw new AnalystError("incomplete_provider_response");
        const calls = response.output.filter((item) => item.type === "function_call");
        if (calls.length) {
          if (++rounds > AI_LIMITS.rounds || metadata.toolCallCount + calls.length > AI_LIMITS.tools) throw new AnalystError("tool_limit");
          // Retain output items, including reasoning, for the Responses continuation protocol.
          input.push(...response.output as ResponseInputItem[]);
          for (const call of calls) {
            if (!registry.definitions.some((tool) => tool.name === call.name)) throw new AnalystError("unknown_tool");
            if (call.arguments.length > 2000) throw new AnalystError("invalid_tool_arguments");
            let args: unknown;
            try { args = JSON.parse(call.arguments); } catch { throw new AnalystError("invalid_tool_arguments"); }
            metadata.toolCallCount++; metadata.tools.push(call.name);
            let data: unknown;
            try { data = await bounded(registry.execute(call.name as ToolName, args, controller.signal), controller.signal); }
            catch (error) { if (error instanceof AnalystError) throw error; throw new AnalystError("tool_failure", 503); }
            const scope = (data as { scope?: unknown }).scope;
            if (scope && typeof scope === "object" && "range" in scope) {
              const range = scope as { period: string; category: string; range: { startDate: string; endDate: string; timeZone: string } };
              scopes.set(call.name, `${range.period} · ${range.category} · ${range.range.startDate}–${range.range.endDate} (${range.range.timeZone})`);
            } else if (typeof scope === "string") scopes.set(call.name, scope.replaceAll("_", " "));
            const evidence = collectFacts(data, facts, [call.name]);
            const payload = JSON.stringify({ data, evidence });
            const size = Buffer.byteLength(payload); bytes += size;
            if (size > AI_LIMITS.toolBytes || bytes > AI_LIMITS.totalToolBytes) throw new AnalystError("tool_payload_limit", 503);
            input.push({ type: "function_call_output", call_id: call.call_id, output: payload });
          }
          continue;
        }
        // Never accept provider-only prose as a successful operational analysis.
        if (!metadata.toolCallCount || !facts.size) throw new AnalystError("no_tool_evidence");
        let parsed: z.infer<typeof finalSchema>;
        try { parsed = finalSchema.parse(JSON.parse(response.output_text)); } catch { throw new AnalystError("ungrounded_answer"); }
        const qualitative = parsed.explanation.replace(/Prop 22/gi, "Prop guarantee");
        if (/\p{N}|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|hundred|thousand|million|billion)\b|[零〇一二三四五六七八九十百千万亿两]+(?=美元|小时|英里|次|单|笔|个|元|%)/iu.test(qualitative)) throw new AnalystError("ungrounded_answer");
        const selected = [...new Set(parsed.factIds)].map((id) => facts.get(id));
        if (selected.some((fact) => !fact) || !selected.length) throw new AnalystError("ungrounded_answer");
        const scopeLabels = [...scopes].map(([name, scope]) => `${labels[name]} scope: ${scope}`).join("\n");
        const answer = `${parsed.explanation}\n\n${scopeLabels}\n\n${selected.map((fact) => `${fact!.label}: ${fact!.display}`).join("\n")}`;
        metadata.outcome = "success";
        return { requestId, answer, toolsUsed: [...new Set(metadata.tools)],
          warnings: ["Recorded observations only; LLM explanations may be mistaken. Metrics below come from deterministic tools.", "Different tool scopes/cohorts may not be directly comparable; refresh after record edits."] };
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
        usageAvailable: false, outcome: "invalid_question" });
    }
  });
}
export type Analyst = ReturnType<typeof createAnalyst>;
