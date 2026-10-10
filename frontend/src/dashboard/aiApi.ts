export interface AnalystAnswer { requestId: string; answer: string; toolsUsed: string[]; warnings: string[] }
const unavailable = "DGI analysis is unavailable. Try again or review the recorded analytics below.";
const tools = new Set(["get_period_summary", "get_delivery_efficiency", "get_session_efficiency", "compare_strategies", "get_settlement_efficiency", "get_data_quality", "get_annual_uber_summary"]);
function isAnswer(value: unknown): value is AnalystAnswer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.requestId === "string" && row.requestId.length > 0 && row.requestId.length <= 200
    && typeof row.answer === "string" && row.answer.length > 0 && row.answer.length <= 100_000
    && Array.isArray(row.toolsUsed) && row.toolsUsed.length > 0 && row.toolsUsed.length <= 6 && row.toolsUsed.every((item) => typeof item === "string" && tools.has(item))
    && Array.isArray(row.warnings) && row.warnings.length <= 50 && row.warnings.every((item) => typeof item === "string" && item.length <= 1000);
}
export async function askDgi(question: string, signal: AbortSignal): Promise<AnalystAnswer> {
  const response = await fetch("/api/ai/ask", { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
  if (!response.ok) throw new Error(unavailable);
  const value: unknown = await response.json();
  if (!isAnswer(value)) throw new Error(unavailable);
  return value;
}
