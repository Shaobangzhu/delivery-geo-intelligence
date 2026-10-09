import { useEffect, useRef, useState } from "react";
import type { Merchant } from "./api";
import { DialogFrame } from "./DialogFrame";
import { SessionModal } from "./SessionModal";
import { VehicleModal } from "./VehicleModal";
import { AnnualMileageModal } from "./AnnualMileageModal";
import { SessionCost } from "./SessionCost";
import { formatDuration } from "./duration";
import { displaySessionDate, displaySessionTime } from "./sessionTime";
import { deleteSession, getEconomics, initializeEconomics, listSessions, sessionError, strategies, usd, type AnnualMileage, type DeliverySession, type EconomicsResponse } from "./sessionApi";

export function UberSessions({ merchants, deliveryRevision }: { merchants: Merchant[]; deliveryRevision: number }) {
  const [rows, setRows] = useState<DeliverySession[]>([]);
  const [economics, setEconomics] = useState<EconomicsResponse>({ data: null, historicalMileage: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<DeliverySession | null | undefined>(undefined);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [annual, setAnnual] = useState<AnnualMileage | null | undefined>(undefined);
  const [target, setTarget] = useState<DeliverySession | null>(null);
  const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState(""); const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    Promise.all([listSessions(controller.signal), getEconomics(controller.signal)]).then(([sessions, settings]) => {
      if (active) { setRows(sessions); setEconomics(settings); setLoading(false); }
    }).catch((cause) => { if (active) { setError(sessionError(cause)); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [reload, deliveryRevision]);
  function saved() { setEditing(undefined); setVehicleOpen(false); setAnnual(undefined); setReload((value) => value + 1); }
  async function initialize() {
    if (pending.current) return; pending.current = true; setBusy(true); setActionError("");
    try { await initializeEconomics(); setReload((value) => value + 1); }
    catch (cause) { setActionError(sessionError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  async function remove() {
    if (!target || pending.current) return; pending.current = true; setBusy(true); setActionError("");
    try { await deleteSession(target.id); setTarget(null); setReload((value) => value + 1); }
    catch (cause) { setActionError(sessionError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  const profile = economics.data;
  return <section className="session-section" aria-labelledby="sessions-title">
    <div className="session-section-heading"><div><h2 id="sessions-title">Uber Eats Sessions</h2><p className="duration-help">Complete operating periods; time and mileage are recorded independently of individual deliveries.</p></div><button type="button" className="button secondary" disabled={loading || Boolean(error)} onClick={() => setEditing(null)}>＋ Add Session</button></div>
    {error && <p role="alert" className="history-alert">{error} <button type="button" className="text-button" onClick={() => setReload((value) => value + 1)}>Retry session data</button></p>}
    <div className="history-table-card table-scroll"><table className="history-table session-table">
      <thead><tr><th scope="col">Date</th><th scope="col">Start–End (Los Angeles)</th><th scope="col">Duration</th><th scope="col">Strategy</th><th scope="col">Total Miles</th><th scope="col">Estimated Vehicle Cost</th><th scope="col">Actions</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={7}>Loading sessions…</td></tr> : error ? <tr><td colSpan={7}>Sessions unavailable.</td></tr> : !rows.length ? <tr><td colSpan={7}>No Uber Eats sessions recorded.</td></tr> : rows.map((row) => <tr key={row.id}>
        <td>{displaySessionDate(row.startedAt)}</td><td>{displaySessionTime(row.startedAt)}<br />{displaySessionTime(row.endedAt)}</td><td>{formatDuration(row.sessionDurationSeconds)}</td>
        <td>{strategies.find((item) => item.value === row.strategy)?.label ?? "Not recorded"}<span className="merchant-city">{row.deliveryIds.length} linked deliveries</span></td><td>{row.totalDrivenMiles === undefined ? "Unknown" : `${row.totalDrivenMiles} mi`}</td>
        <td><details><summary>{row.vehicleCost.knownAndEstimatedCost === null ? "Unavailable" : usd(row.vehicleCost.knownAndEstimatedCost)} · {row.vehicleCost.completeness === "complete" ? "Complete" : "Incomplete"}</summary><SessionCost cost={row.vehicleCost} /></details></td>
        <td><div className="row-actions"><button type="button" className="icon-action" aria-label={`Edit session ${row.id.slice(-6)}`} onClick={() => setEditing(row)}>✎</button><button type="button" className="icon-action destructive" aria-label={`Delete session ${row.id.slice(-6)}`} onClick={() => { setActionError(""); setTarget(row); }}>⌫</button></div></td>
      </tr>)}</tbody>
    </table></div>
    <details className="vehicle-panel">
      <summary>Tesla Model Y — Vehicle Economics</summary>
      {loading ? <p>Loading vehicle data…</p> : profile ? <>
        <dl className="vehicle-facts"><div><dt>Energy Cash Cost</dt><dd>{usd(profile.energyCashCostPerMile)}/mi</dd></div><div><dt>Tire Replacement Set</dt><dd>{usd(profile.tireReplacementSetCost)}</dd></div><div><dt>Expected Tire Set Life</dt><dd>{profile.expectedTireSetLifeMiles === undefined ? "Not configured" : `${profile.expectedTireSetLifeMiles} mi`}</dd></div><div><dt>Marginal Mileage Depreciation</dt><dd>{profile.marginalDepreciationCostPerMile === undefined ? "Not configured" : `${profile.marginalDepreciationCostPerMile.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 })}/mi`}</dd></div></dl>
        <button type="button" className="button secondary" onClick={() => setVehicleOpen(true)}>Edit Vehicle Settings</button>
        <p className="duration-help">Personal home-charging cash-cost assumption; economic opportunity cost is excluded. Paid repairs, tire rotations, and alignment are historically $0. Washing and cabin filters are excluded.</p>
      </> : !error && <p>Initialize the confirmed vehicle assumptions and 2024–2025 mileage once. Existing settings and annual records are preserved.</p>}
      {!loading && !error && <button type="button" className="text-button initialize-economics" disabled={busy} onClick={() => void initialize()}>{busy && !target ? "Initializing…" : "Initialize Missing Confirmed Records"}</button>}
      {actionError && !target && <p role="alert" className="form-error">{actionError}</p>}
      {!loading && !error && <>
        <div className="session-section-heading"><h3>Annual Business Mileage</h3><button type="button" className="button secondary" onClick={() => setAnnual(null)}>＋ Add Annual Mileage</button></div>
        <div className="table-scroll"><table className="history-table annual-mileage-table"><thead><tr><th scope="col">Year</th><th scope="col">Total Vehicle Miles</th><th scope="col">Business Miles by Purpose</th><th scope="col">Business Use</th><th scope="col">Standard Mileage Deduction Preview</th><th scope="col">Actions</th></tr></thead><tbody>
          {!economics.historicalMileage.length ? <tr><td colSpan={6}>No annual mileage recorded.</td></tr> : economics.historicalMileage.map((record) => <tr key={record.taxYear}><td>{record.taxYear}</td><td>{record.totalVehicleMiles.toLocaleString()}</td><td>Uber Eats: {record.uberEatsBusinessMiles.toLocaleString()}<br />Realtor: {record.realtorBusinessMiles === undefined ? "Unknown" : record.realtorBusinessMiles.toLocaleString()}<br />Other: {record.otherBusinessMiles === undefined ? "Unknown" : record.otherBusinessMiles.toLocaleString()}</td><td>{record.businessUsePercentage === null ? "Incomplete or unavailable" : `${record.businessUsePercentage.toFixed(2)}%`}</td><td>{record.standardMileage.estimatedDeduction === null ? "Unavailable" : usd(record.standardMileage.estimatedDeduction)}</td><td><button type="button" className="icon-action" aria-label={`Edit annual mileage ${record.taxYear}`} onClick={() => setAnnual(record)}>✎</button></td></tr>)}
        </tbody></table></div>
        <p className="duration-help">Standard Mileage method. Annual totals are entered independently of sessions. Preview supports sourced 2024/2025 rates only; it is a deduction, not income, vehicle cost, or tax savings. Unknown categories or unsupported years show unavailable.</p>
      </>}
    </details>
    {editing !== undefined && <SessionModal key={editing?.id ?? "new"} session={editing} merchants={merchants} onClose={() => setEditing(undefined)} onSaved={saved} />}
    {vehicleOpen && profile && <VehicleModal profile={profile} onClose={() => setVehicleOpen(false)} onSaved={saved} />}
    {annual !== undefined && <AnnualMileageModal key={annual?.taxYear ?? "new"} record={annual} onClose={() => setAnnual(undefined)} onSaved={saved} />}
    {target && <DialogFrame title="Delete Uber Eats session?" onClose={() => setTarget(null)} busy={busy} className="confirm-dialog">
      <p className="dialog-intro">This session will be permanently removed. Linked deliveries will be unlinked and retained.</p>
      {actionError && <p role="alert" className="form-error">{actionError}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" data-autofocus disabled={busy} onClick={() => setTarget(null)}>Cancel</button><button type="button" className="button danger" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete Session"}</button></div>
    </DialogFrame>}
  </section>;
}
