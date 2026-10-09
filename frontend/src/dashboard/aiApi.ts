export interface AnalystAnswer { requestId: string; answer: string; toolsUsed: string[]; warnings: string[] }
export async function askDgi(question: string, signal: AbortSignal): Promise<AnalystAnswer> {
  const response = await fetch("/api/ai/ask", { method: "POST", signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
  if (!response.ok) throw new Error("DGI analysis is unavailable. Try again or review the recorded analytics below.");
  return response.json() as Promise<AnalystAnswer>;
}
