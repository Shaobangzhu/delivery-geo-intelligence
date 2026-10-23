import { useEffect, useState } from "react";
import { loadSnapshot, type Snapshot, type Window } from "../settings/api";
import { useBrowserMapStatus } from "../settings/browserStatus";
import "../settings/settings.css";
const labels = { mongodb: "MongoDB", arcgis_geocoding: "ArcGIS Geocoding API (Backend)", openai: "OpenAI Analyst" };
const stateLabel = (state: string) => state.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
const value = (v: number | null | undefined) => v == null ? "Unavailable" : v.toLocaleString();
const time = (v: string | null | undefined) => v ? new Date(v).toLocaleString() : "Not observed";
const ms = (v: number | null | undefined) => v == null ? "Unavailable" : `${v.toFixed(1)} ms`;
export function Settings() {
  const [window, setWindow] = useState<Window>("1h"), [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<Snapshot | null>(null), [metrics, setMetrics] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true), [errors, setErrors] = useState<string[]>([]);
  const browser = useBrowserMapStatus();
  useEffect(() => {
    const controller = new AbortController(); let active = true, timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    setLoading(true); setErrors([]); setMetrics(null);
    void Promise.allSettled([loadSnapshot("status", window, controller.signal), loadSnapshot("metrics", window, controller.signal)]).then(([s, m]) => {
      if (!active) return;
      const problems: string[] = [];
      if (s.status === "fulfilled") setStatus(s.value); else problems.push("Status unavailable; retained status is stale.");
      if (m.status === "fulfilled") setMetrics(m.value); else problems.push("Request metrics unavailable.");
      if (timedOut) problems.push("Backend request timed out.");
      setErrors(problems); setLoading(false); clearTimeout(timer);
    });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [window, revision]);
  const stale = loading || errors.some((error) => error.startsWith("Status"));
  const mongo = status?.providers.find((p) => p.provider === "mongodb"), aiStatus = status?.providers.find((p) => p.provider === "openai");
  const ai = metrics?.providers.find((p) => p.provider === "openai");
  const browserState = browser.event === null ? "not_yet_verified" : browser.event === "map_initialized" ? "operational" : browser.event === "not_configured" ? "not_configured" : "unavailable";
  return <div className="settings-page">
    <div className="settings-heading"><div><span className="section-kicker">Data operations</span><h1>Data &amp; Settings</h1><p>Dependency health and usage from recorded observations.</p></div>
      <button className="settings-button" onClick={() => setRevision((n) => n + 1)} disabled={loading}>{loading ? "Refreshing…" : "Refresh status"}</button></div>
    <div className="settings-toolbar"><label>Observation window <select value={window} onChange={(e) => setWindow(e.target.value as Window)}><option value="1h">Last 1 hour</option><option value="24h">Last 24 hours</option></select></label><span>Status uses 24h evidence. No automatic polling.</span></div>
    {loading && <p role="status">Loading observations… Previously loaded status may be stale.</p>}
    {errors.length > 0 && <div role="alert" className="settings-alert"><strong>Backend data is unavailable or partial.</strong>{errors.map((e) => <p key={e}>{e}</p>)}<p>Provider connectivity cannot be inferred from this page while the backend is unreachable.</p></div>}
    {(metrics?.incomplete || status?.incomplete) && <p className="settings-alert">Partial history: collector capacity was reached.</p>}
    <section aria-labelledby="overview-title"><h2 id="overview-title">System Overview</h2><div className="settings-summary">
      {[ ["Observed Provider Status", status && stale ? "Unavailable · stale snapshot" : status ? `${status.providers.filter((p) => p.status === "operational").length} / 3 operational` : "Unavailable"], ["MongoDB Health", mongo ? `${stale ? "Stale · " : ""}${stateLabel(mongo.status)}` : "Unavailable"], ["Recent Provider Requests", metrics ? value(metrics.providers.reduce((n, p) => n + p.requestCount, 0)) : "Unavailable"], ["AI Configuration Status", aiStatus?.configured === true ? "Configured" : aiStatus?.configured === false ? "Not Configured" : "Unknown"] ].map(([label, content]) => <article className="settings-card" key={label}><h3>{label}</h3><strong>{content}</strong></article>)}
    </div></section>
    <section className="settings-panel" aria-labelledby="providers-title"><h2 id="providers-title">Provider Status</h2><div className="settings-providers">
      <article><h3>ArcGIS Maps SDK (Browser)</h3><span className={`settings-badge ${browserState}`}>{stateLabel(browserState)}</span><p>Browser-session lifecycle observation</p><p>{time(browser.timestamp)}</p>{browser.event && <p>{stateLabel(browser.event)}</p>}</article>
      {(status?.providers ?? []).map((p) => <article key={p.provider}><h3>{labels[p.provider]}</h3><span className={`settings-badge ${p.status}`}>{stale ? "Stale · " : ""}{stateLabel(p.status)}</span><p>Backend observation · updated {time(p.lastUpdatedAt)}</p></article>)}
      {!status && <p>Backend providers: status unavailable.</p>}
    </div><p className="settings-note">Browser observations persist across navigation in this tab, reset on reload, and do not measure every network request.</p></section>
    <section className="settings-panel" aria-labelledby="requests-title"><h2 id="requests-title">Request Metrics</h2>
      {!metrics ? <p>No current metrics available.</p> : <><p>Snapshot: {time(metrics.generatedAt)} · Process started: {time(metrics.startedAt)}. History resets on restart and may cover less than the selected window.</p>
      {metrics.providers.every((p) => p.sampleCount === 0) && <p>No operations observed in this window.</p>}
      <div className="settings-table-scroll" tabIndex={0} role="region" aria-label="Provider request metrics"><table><caption>Retained backend observations · {window}</caption><thead><tr>{["Provider", "Observed calls", "Success / Failure", "Success rate", "p50 / p95", "Samples", "Latest success", "Latest error"].map((h) => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{metrics.providers.map((p) => <tr key={p.provider}><th scope="row">{labels[p.provider]}</th><td>{value(p.requestCount)}</td><td>{p.successCount} / {p.failureCount}</td><td>{p.requestCount ? `${(100 * p.successCount / p.requestCount).toFixed(1)}%` : "Unavailable"}</td><td>{ms(p.latency.p50Ms)} / {ms(p.latency.p95Ms)}<small>{p.latency.sampleCount} duration samples</small></td><td>{p.sampleCount}</td><td>{time(p.lastSuccessAt)}</td><td>{p.lastErrorCategory ? stateLabel(p.lastErrorCategory) : "None observed"}</td></tr>)}</tbody></table></div></>}
      <p className="settings-note">Calls count MongoDB commands (including marked health pings), geocoding lookups and analyst requests. Model invocations are separate below. Expected no-match/low-confidence results are not infrastructure outages and do not count as successful geocodes.</p></section>
    <div className="settings-details"><section className="settings-panel"><h2>Local MongoDB</h2><dl><dt>Connection observation</dt><dd>{mongo ? `${stale ? "Stale · " : ""}${stateLabel(mongo.status)}` : "Unavailable"}</dd><dt>Ping duration</dt><dd>{ms(mongo?.healthCheck?.durationMs)}</dd><dt>Last health check</dt><dd>{time(mongo?.healthCheck?.timestamp)}</dd><dt>Database identity</dt><dd>Not exposed by the system API</dd><dt>Observed reads / writes</dt><dd>{value(metrics?.providers.find((p) => p.provider === "mongodb")?.operations.database_read)} / {value(metrics?.providers.find((p) => p.provider === "mongodb")?.operations.database_write)}</dd></dl><p className="settings-note">Status probes reuse the backend connection; results may be cached for five seconds.</p></section>
    <section className="settings-panel"><h2>AI Usage</h2><dl>{[["Configured model", aiStatus?.model ?? "Unavailable"], ["Analyst requests", value(ai?.ai?.analystRequests)], ["Model invocations", value(ai?.ai?.providerCalls)], ["Reported input tokens", value(ai?.ai?.inputTokens)], ["Reported output tokens", value(ai?.ai?.outputTokens)], ["Provider errors", value(ai?.ai?.providerErrors)], ["Timeout / rate-limit", `${value(ai?.errorCounts.timeout)} / ${value(ai?.errorCounts.rate_limit)}`], ["Usage samples", value(ai?.ai?.usageSamples)]].map(([label, content]) => <div key={label}><dt>{label}</dt><dd>{content}</dd></div>)}</dl>{ai?.ai && ai.ai.usageSamples < ai.ai.providerCalls && <p className="settings-alert">Partial token coverage: {ai.ai.usageSamples} / {ai.ai.providerCalls} model invocations reported usage.</p>}<p className="settings-note">Only reported tokens are shown; missing exchanges make totals partial. No usage or billing estimates. Timeout counts may include cancellation.</p></section></div>
  </div>;
}
