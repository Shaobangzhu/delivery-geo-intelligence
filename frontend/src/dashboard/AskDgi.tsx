import { useEffect, useRef, useState, type FormEvent } from "react";
import { askDgi, type AnalystAnswer } from "./aiApi";

const suggestions = ["How efficient were my delivery sessions?", "What does my latest Prop 22 settlement show?",
  "Compare my operating strategies.", "What data should I backfill?"];
const sources: Record<string, string> = { get_period_summary: "Period summary", get_delivery_efficiency: "Delivery efficiency",
  get_session_efficiency: "Session efficiency", compare_strategies: "Strategy comparison",
  get_settlement_efficiency: "Settlement efficiency", get_data_quality: "Data completeness" };

export function AskDgi() {
  const [open, setOpen] = useState(false), [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnalystAnswer | null>(null), [submitted, setSubmitted] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null), mounted = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null), toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  function change(value: string) { setQuestion(value); setResult(null); setError(""); }
  function close() {
    pending.current?.abort(); pending.current = null; setBusy(false); setOpen(false); setResult(null); setError(""); toggle.current?.focus();
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return;
    const trimmed = question.trim(); setResult(null); setError("");
    if (!trimmed || trimmed.length > 1000) { setError("Enter a question of 1–1000 characters."); textarea.current?.focus(); return; }
    const controller = new AbortController(); pending.current = controller; setBusy(true); setSubmitted(trimmed);
    try {
      const answer = await askDgi(trimmed, controller.signal);
      if (mounted.current && pending.current === controller && !controller.signal.aborted) setResult(answer);
    } catch {
      if (mounted.current && pending.current === controller && !controller.signal.aborted) setError("DGI analysis is unavailable. Try again or review the recorded analytics below.");
    } finally {
      if (mounted.current && pending.current === controller) { pending.current = null; setBusy(false); }
    }
  }
  return <section className="dash-card ask-dgi" aria-labelledby="ask-dgi-title">
    <div className="ask-dgi-heading"><h2 id="ask-dgi-title">Ask DGI</h2><button ref={toggle} type="button" aria-expanded={open} aria-controls="ask-dgi-panel"
      onClick={() => open ? close() : setOpen(true)}>{open ? "Close analyst" : "Open analyst"}</button></div>
    <p>Explain recorded DGI data with AI. Financial metrics come from existing analytics; answers can be mistaken.</p>
    {open && <div id="ask-dgi-panel" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
      <p className="ask-dgi-note">Questions and relevant aggregate metrics are sent to OpenAI only when you ask. Do not include private addresses or secrets. State your desired period/category in the question; Dashboard filters do not automatically set this scope.</p>
      <div className="ask-dgi-suggestions" role="group" aria-label="Suggested questions">{suggestions.map((item) => <button type="button" key={item} disabled={busy}
        onClick={() => { change(item); textarea.current?.focus(); }}>{item}</button>)}</div>
      <form onSubmit={submit} aria-busy={busy} noValidate>
        <label htmlFor="dgi-question">Your question</label>
        <textarea id="dgi-question" ref={textarea} value={question} onChange={(event) => change(event.target.value)} disabled={busy} maxLength={1000} rows={3} aria-describedby="dgi-question-limit" />
        <small id="dgi-question-limit">Up to 1,000 characters. No conversation is saved in DGI.</small>
        <button type="submit" disabled={busy}>{busy ? "Analyzing…" : error ? "Retry analysis" : "Ask"}</button>
      </form>
      {busy && <p role="status">Reading recorded analytics…</p>}
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {result && <div className="ask-dgi-answer" role="region" aria-label="DGI answer" aria-live="polite">
        <h3>Answer to: {submitted}</h3><p className="ask-dgi-answer-text">{result.answer}</p>
        <p className="ask-dgi-sources">Sources: {result.toolsUsed.map((name) => sources[name] ?? "Recorded analytics").join(" · ")}</p>
        {result.warnings.map((warning, index) => <p className="ask-dgi-note" key={index}>{warning}</p>)}
      </div>}
    </div>}
  </section>;
}
