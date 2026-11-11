import { Button, Table } from "@shaobangzhu/clu-ui";
import { Pagination } from "../components/Pagination";
import { PAGE_SIZE, pageRange } from "../components/pageRange";
import { useEffect, useRef, useState } from "react";
import type { Merchant } from "./api";
import { DialogFrame } from "./DialogFrame";
import { SessionModal } from "./SessionModal";
import { VehicleModal } from "./VehicleModal";
import { AnnualMileageModal } from "./AnnualMileageModal";
import { SessionCost } from "./SessionCost";
import { formatDuration } from "./duration";
import { displaySessionDate, displaySessionTime } from "./sessionTime";
import { platforms } from "./platform";
import { deleteSession, getEconomics, initializeEconomics, listSessions, sessionError, strategies, usd, type AnnualMileage, type DeliverySession, type EconomicsResponse } from "./sessionApi";

export function UberSessions({ merchants, deliveryRevision }: { merchants: Merchant[]; deliveryRevision: number }) {
  const [rows, setRows] = useState<DeliverySession[]>([]);
  const [economics, setEconomics] = useState<EconomicsResponse>({ data: null, historicalMileage: [] });
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  const range = pageRange(page, rows.length);
  const [editing, setEditing] = useState<DeliverySession | null | undefined>(undefined);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [annual, setAnnual] = useState<AnnualMileage | null | undefined>(undefined);
  const [target, setTarget] = useState<DeliverySession | null>(null);
  const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState(""); const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    Promise.all([listSessions(controller.signal), getEconomics(controller.signal)]).then(([sessions, settings]) => {
      if (active) { setRows(sessions); setPage((page) => pageRange(page, sessions.length).page); setEconomics(settings); setLoading(false); }
    }).catch((cause) => { if (active) { setRows([]); setEconomics({ data: null, historicalMileage: [] }); setError(sessionError(cause)); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [reload, deliveryRevision]);
  function saved() { if (editing === null) setPage(1); setEditing(undefined); setVehicleOpen(false); setAnnual(undefined); setReload((value) => value + 1); }
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
    <div className="session-section-heading"><div><h2 id="sessions-title">Delivery Sessions</h2><p className="duration-help">Complete operating periods; time and mileage are recorded independently of individual deliveries.</p></div><Button type="button" variant="secondary" size="small" disabled={loading || Boolean(error)} onClick={() => setEditing(null)}>＋ Add Session</Button></div>
    {error && <p role="alert" className="history-alert">{error} <Button type="button" variant="quiet" size="small" onClick={() => setReload((value) => value + 1)}>Retry session data</Button></p>}
    <div className="history-table-card"><Table.ScrollArea label="Delivery sessions" className="table-scroll"><Table density="compact" className="history-table session-table">
      <Table.Header><Table.Row><Table.HeadCell scope="col">Date</Table.HeadCell><Table.HeadCell scope="col">Start–End (Los Angeles)</Table.HeadCell><Table.HeadCell scope="col">Duration</Table.HeadCell><Table.HeadCell scope="col">Strategy</Table.HeadCell><Table.HeadCell scope="col">Trips Offered</Table.HeadCell><Table.HeadCell scope="col">Total Miles</Table.HeadCell><Table.HeadCell scope="col">Estimated Vehicle Cost</Table.HeadCell><Table.HeadCell scope="col">Actions</Table.HeadCell></Table.Row></Table.Header>
      <Table.Body>{loading ? <Table.MessageRow colSpan={8} className="dgi-table-message">Loading sessions…</Table.MessageRow> : error ? <Table.MessageRow colSpan={8} className="dgi-table-message">Sessions unavailable.</Table.MessageRow> : !rows.length ? <Table.MessageRow colSpan={8} className="dgi-table-message">No delivery sessions recorded.</Table.MessageRow> : rows.slice(range.offset, range.offset + PAGE_SIZE).map((row) => <Table.Row key={row.id}>
        <Table.Cell>{displaySessionDate(row.startedAt)}{row.associationIntegrity && <small className="merchant-city">Association review required</small>}</Table.Cell><Table.Cell>{displaySessionTime(row.startedAt)}<br />{displaySessionTime(row.endedAt)}</Table.Cell><Table.Cell>{formatDuration(row.sessionDurationSeconds)}</Table.Cell>
        <Table.Cell>{strategies.find((item) => item.value === row.strategy)?.label ?? "Not recorded"}<span className="merchant-city">{row.deliveryIds.length} linked deliveries</span></Table.Cell>
        <Table.Cell className="session-offers-cell">{platforms.map(({ value, label }) => `${label}: ${row.tripsOfferedByPlatform?.[value] ?? "—"}`).join(" · ")}</Table.Cell>
        <Table.Cell>{row.totalDrivenMiles === undefined ? "Unknown" : `${row.totalDrivenMiles} mi`}</Table.Cell>
        <Table.Cell><details><summary>{row.vehicleCost.knownAndEstimatedCost === null ? "Unavailable" : usd(row.vehicleCost.knownAndEstimatedCost)} · {row.vehicleCost.completeness === "complete" ? "Complete" : "Incomplete"}</summary><SessionCost cost={row.vehicleCost} /></details></Table.Cell>
        <Table.Cell><div className="row-actions"><Button type="button" variant="secondary" size="small" className="dgi-row-action" aria-label={`Edit session ${row.id.slice(-6)}`} onClick={() => setEditing(row)}>✎</Button><Button type="button" variant="danger" size="small" className="dgi-row-action" aria-label={`Delete session ${row.id.slice(-6)}`} onClick={() => { setActionError(""); setTarget(row); }}>⌫</Button></div></Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table></Table.ScrollArea>
    {!loading && !error && <Pagination page={page} total={rows.length} noun="sessions" label="Delivery session pages" onPageChange={setPage} />}
    </div>
    <details className="vehicle-panel">
      <summary>Tesla Model Y — Vehicle Economics</summary>
      {loading ? <p>Loading vehicle data…</p> : profile ? <>
        <dl className="vehicle-facts"><div><dt>Energy Cash Cost</dt><dd>{usd(profile.energyCashCostPerMile)}/mi</dd></div><div><dt>Tire Replacement Set</dt><dd>{usd(profile.tireReplacementSetCost)}</dd></div><div><dt>Expected Tire Set Life</dt><dd>{profile.expectedTireSetLifeMiles === undefined ? "Not configured" : `${profile.expectedTireSetLifeMiles} mi`}</dd></div><div><dt>Marginal Mileage Depreciation</dt><dd>{profile.marginalDepreciationCostPerMile === undefined ? "Not configured" : `${profile.marginalDepreciationCostPerMile.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 })}/mi`}</dd></div></dl>
        <Button type="button" variant="secondary" size="small" onClick={() => setVehicleOpen(true)}>Edit Vehicle Settings</Button>
        <p className="duration-help">Personal home-charging cash-cost assumption; economic opportunity cost is excluded. Paid repairs, tire rotations, and alignment are historically $0. Washing and cabin filters are excluded.</p>
      </> : !error && <p>Initialize the confirmed vehicle assumptions and 2024–2025 mileage once. Existing settings and annual records are preserved.</p>}
      {!loading && !error && <Button type="button" variant="quiet" size="small" className="initialize-economics" disabled={busy} onClick={() => void initialize()}>{busy && !target ? "Initializing…" : "Initialize Missing Confirmed Records"}</Button>}
      {actionError && !target && <p role="alert" className="form-error">{actionError}</p>}
      {!loading && !error && <>
        <div className="session-section-heading"><h3>Annual Business Mileage</h3><Button type="button" variant="secondary" size="small" onClick={() => setAnnual(null)}>＋ Add Annual Mileage</Button></div>
        <div className="table-scroll"><Table density="compact" className="history-table annual-mileage-table"><Table.Header><Table.Row><Table.HeadCell scope="col">Year</Table.HeadCell><Table.HeadCell scope="col">Total Vehicle Miles</Table.HeadCell><Table.HeadCell scope="col">Business Miles by Purpose</Table.HeadCell><Table.HeadCell scope="col">Business Use</Table.HeadCell><Table.HeadCell scope="col">Standard Mileage Deduction Preview</Table.HeadCell><Table.HeadCell scope="col">Actions</Table.HeadCell></Table.Row></Table.Header><Table.Body>
          {!economics.historicalMileage.length ? <Table.MessageRow colSpan={6} className="dgi-table-message">No annual mileage recorded.</Table.MessageRow> : economics.historicalMileage.map((record) => <Table.Row key={record.taxYear}><Table.Cell>{record.taxYear}</Table.Cell><Table.Cell>{record.totalVehicleMiles.toLocaleString()}</Table.Cell><Table.Cell>Uber Eats: {record.uberEatsBusinessMiles.toLocaleString()}<br />Realtor: {record.realtorBusinessMiles === undefined ? "Unknown" : record.realtorBusinessMiles.toLocaleString()}<br />Other: {record.otherBusinessMiles === undefined ? "Unknown" : record.otherBusinessMiles.toLocaleString()}</Table.Cell><Table.Cell>{record.businessUsePercentage === null ? "Incomplete or unavailable" : `${record.businessUsePercentage.toFixed(2)}%`}</Table.Cell><Table.Cell>{record.standardMileage.estimatedDeduction === null ? "Unavailable" : usd(record.standardMileage.estimatedDeduction)}</Table.Cell><Table.Cell><Button type="button" variant="secondary" size="small" className="dgi-row-action" aria-label={`Edit annual mileage ${record.taxYear}`} onClick={() => setAnnual(record)}>✎</Button></Table.Cell></Table.Row>)}
        </Table.Body></Table></div>
        <p className="duration-help">Standard Mileage method. Annual totals are entered independently of sessions. Preview supports sourced 2024/2025 rates only; it is a deduction, not income, vehicle cost, or tax savings. Unknown categories or unsupported years show unavailable.</p>
      </>}
    </details>
    {editing !== undefined && <SessionModal key={editing?.id ?? "new"} session={editing} merchants={merchants} onClose={() => setEditing(undefined)} onSaved={saved} />}
    {vehicleOpen && profile && <VehicleModal profile={profile} onClose={() => setVehicleOpen(false)} onSaved={saved} />}
    {annual !== undefined && <AnnualMileageModal key={annual?.taxYear ?? "new"} record={annual} onClose={() => setAnnual(undefined)} onSaved={saved} />}
    {target && <DialogFrame title="Delete delivery session?" onClose={() => setTarget(null)} busy={busy} className="confirm-dialog">
      <p className="dialog-intro">This session will be permanently removed. Linked deliveries will be unlinked and retained.</p>
      {actionError && <p role="alert" className="form-error">{actionError}</p>}
      <div className="dialog-actions"><Button type="button" variant="secondary" size="small" data-autofocus disabled={busy} onClick={() => setTarget(null)}>Cancel</Button><Button type="button" variant="danger" size="small" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Delete Session"}</Button></div>
    </DialogFrame>}
  </section>;
}
