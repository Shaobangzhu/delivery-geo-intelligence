import { useEffect, useId, useState } from "react";
import { loadSettlementEfficiency, type SettlementEfficiencyPage } from "./settlementEfficiencyApi";

const reasonLabels: Record<string, string> = {
  missing_coverage_dates: "Enter both settlement coverage dates in History.",
  unconfirmed_session_coverage: "Review the period and confirm that all deliveries and sessions are recorded in the Payment modal.",
  missing_delivery_payout: "Backfill every covered delivery payout.", unlinked_delivery: "Explicitly link every covered delivery to its complete session.",
  missing_linked_session: "Repair a delivery link to a missing session.", covered_delivery_session_outside_coverage: "Review a covered delivery linked to a session outside this interval.",
  missing_session_mileage: "Record valid total driven miles for every included session.", missing_session_duration: "Correct missing or invalid session start/end times.",
  session_crosses_coverage_boundary: "Review boundary-crossing sessions; they cannot be partially allocated.",
  linked_delivery_outside_coverage: "Review sessions linked to deliveries outside this coverage period.",
  linked_delivery_outside_session: "Review linked delivery pickup times outside their session interval.",
  overlapping_sessions: "Correct overlapping session intervals.", overlapping_settlements: "Review overlapping or duplicate settlement coverage periods.",
  session_without_linked_deliveries: "Link deliveries to every included session; no links is not confirmed zero revenue.",
  missing_linked_delivery_payout: "Backfill missing payouts on linked deliveries.", incomplete_vehicle_cost: "Configure tire lifespan and marginal depreciation for full modeled profit.",
  no_recorded_activity: "Record covered deliveries and complete sessions before calculating efficiency.",
  numeric_result_unavailable: "Review numeric inputs; a safe result could not be calculated.", zero_session_mileage_denominator: "Known zero session miles cannot produce a per-mile rate."
};
const money = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const number = (value: number | null) => value === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value);
const coverageLabel = (row: { coverageStartDate: string | null; coverageEndDate: string | null }) => row.coverageStartDate && row.coverageEndDate ? `${row.coverageStartDate} – ${row.coverageEndDate}` : "Coverage not recorded";

export function SettlementEfficiencySection() {
  const id = useId();
  const [page, setPage] = useState<SettlementEfficiencyPage | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(""); setPage(null);
    loadSettlementEfficiency(controller.signal).then((data) => {
      if (active) { setPage(data); setSelected((previous) => data.data.some((row) => row.settlementId === previous) ? previous : data.data[0]?.settlementId ?? ""); setLoading(false); }
    }).catch(() => { if (active) { setError("Settlement efficiency is unavailable. Try again."); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [revision]);
  const row = page?.data.find((item) => item.settlementId === selected);
  return <section aria-labelledby={`${id}-title`} className="settlement-efficiency">
    <h3 id={`${id}-title`}>Prop 22 Work-Period Efficiency</h3>
    <p><strong>All Categories · Settlement Coverage Period</strong></p>
    <p>Dashboard earnings use payment dates. This section attributes actual adjustments to their reported work periods.</p>
    <p>Independent of calendar/category filters above. Do not add these totals to Dashboard earnings.</p>
    {loading && <p role="status">Loading settlement efficiency…</p>}
    {error && <p role="alert">{error}</p>}
    <button type="button" className="button secondary" onClick={() => setRevision((n) => n + 1)} disabled={loading}>{error ? "Retry settlements" : "Refresh settlements"}</button>
    {page && !page.data.length && <p>No Prop 22 settlements recorded.</p>}
    {page && page.data.length > 0 && <div className="form-field"><label htmlFor={`${id}-select`}>Settlement</label>
      <select id={`${id}-select`} value={selected} onChange={(event) => setSelected(event.target.value)}>{page.data.map((item) =>
        <option key={item.settlementId} value={item.settlementId}>{coverageLabel(item)} · paid {item.paymentDate} · {item.settlementId.slice(-6)}</option>)}</select>
      {page.hasMore && <small>Showing the {page.limit} most recent payments of {page.totalSettlements}.</small>}
    </div>}
    {row && <>
      <p>Coverage: {coverageLabel(row)} · Payment date: {row.paymentDate} · Status: <strong>{row.status}</strong></p>
      <p>Coverage confirmation: {row.sessionCoverage.completenessConfirmed ? "User confirmed" : "Not confirmed"}. Confirmation is a user declaration, not independent proof of complete records.</p>
      <p>Structural checks: {row.sessionCoverage.structurallyComplete ? "Passed" : "Blocked — review the reasons below"}.</p>
      <dl className="efficiency-quality">
        <div><dt>Actual Prop 22 Adjustment</dt><dd>{money(row.actualAdjustment)}</dd></div>
        <div><dt>Known Delivery Payout (may be partial)</dt><dd>{money(row.deliveryRevenue.knownTotal)} · {row.deliveryRevenue.knownPayoutCount} known / {row.deliveryRevenue.deliveryCount} recorded</dd></div>
        <div><dt>Recorded Work-Period Gross Revenue</dt><dd>{money(row.workPeriodRevenue)}</dd></div>
        <div><dt>Complete Session Hours</dt><dd>{number(row.sessionCoverage.totalHours)}</dd></div>
        <div><dt>Complete Session Miles</dt><dd>{number(row.sessionCoverage.totalMiles)}</dd></div>
        <div><dt>Prop 22-Adjusted Work-Period Earnings / Hour</dt><dd>{money(row.adjustedEarningsPerHour)}</dd></div>
        <div><dt>Prop 22-Adjusted Work-Period Earnings / Mile</dt><dd>{money(row.adjustedEarningsPerMile)}</dd></div>
        <div><dt>Known + Estimated Vehicle Cost Components (may be partial)</dt><dd>{money(row.vehicleCost.knownAndEstimatedTotal)}</dd></div>
        <div><dt>Full Modeled Vehicle Cost</dt><dd>{money(row.vehicleCost.fullTotal)}</dd></div>
        <div><dt>Estimated Work-Period Economic Profit</dt><dd>{money(row.estimatedEconomicProfit)}</dd></div>
        <div><dt>Estimated Economic Profit / Hour</dt><dd>{money(row.estimatedEconomicProfitPerHour)}</dd></div>
        <div><dt>Estimated Economic Profit / Mile</dt><dd>{money(row.estimatedEconomicProfitPerMile)}</dd></div>
      </dl>
      <p>{row.sessionCoverage.includedSessionCount} included sessions · {row.sessionCoverage.excludedBoundarySessionCount} boundary-crossing sessions excluded · {row.deliveryRevenue.missingPayoutCount} missing payouts.</p>
      <details><summary>Vehicle cost breakdown · current assumptions</summary><dl className="efficiency-quality">{([['energy', 'Energy Cash Cost'], ['tireWear', 'Estimated Tire Wear'], ['depreciation', 'Estimated Marginal Depreciation']] as const).map(([key, label]) =>
        <div key={key}><dt>{label}</dt><dd>{money(row.vehicleCost.componentTotals[key].value)} · {row.vehicleCost.componentTotals[key].sampleCount} known / {row.vehicleCost.sessionCount} sessions</dd></div>)}</dl></details>
      {!!row.reasons.length && <ul>{row.reasons.map((reason) => <li key={reason}>{reasonLabels[reason] ?? "Review recorded period data."}</li>)}</ul>}
      <p>Pre-tax modeled profit uses current A.1 vehicle assumptions, including configured zero energy cash cost. No IRS deductions or taxes are included. Adjustment income is never allocated to deliveries, sessions, merchants, or strategies.</p>
      <p>Coverage uses Los Angeles midnight boundaries and delivery pickup timestamps as an approximation of Uber attribution. Date-only records may differ from statement cutoffs.</p>
    </>}
  </section>;
}
