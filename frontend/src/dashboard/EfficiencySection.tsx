import { useEffect, useState } from "react";
import type { Category, Period } from "./api";
import { loadEfficiency, type EfficiencyData, type EfficiencyMetric } from "./efficiencyApi";
import { strategies } from "../history/sessionApi";
import { SettlementEfficiencySection } from "./SettlementEfficiencySection";

function valueLabel(metric: EfficiencyMetric) {
  if (metric.value === null) return "—";
  const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(metric.value);
  return metric.unit === "USD/hour" ? `${money}/hr` : metric.unit === "USD/mile" ? `${money}/mi` : money;
}
function Metric({ label, metric, records }: { label: string; metric: EfficiencyMetric; records: "deliveries" | "sessions" }) {
  return <div className="efficiency-metric"><span>{label}</span><strong>{valueLabel(metric)}</strong>
    <small>{metric.sampleCount} eligible {records} · {metric.excludedCount} excluded</small></div>;
}
const qualityLabels: Record<string, string> = {
  deliveriesMissingPayout: "Deliveries missing payout", deliveriesMissingRecordedDuration: "Deliveries missing recorded duration",
  deliveriesMissingDistance: "Deliveries missing distance", deliveriesWithoutSessionAssociation: "Deliveries without session association",
  sessionsMissingTotalMiles: "Sessions missing total miles", sessionsWithoutLinkedDeliveries: "Sessions without linked deliveries",
  sessionsWithIncompleteVehicleCost: "Sessions with incomplete vehicle cost", sessionsWithMissingLinkedPayout: "Sessions with missing linked payout",
  sessionsExcludedBoundaryCrossing: "Sessions excluded at period boundaries", unclassifiedSessions: "Unclassified sessions",
  sessionsWithIncompleteAssociations: "Sessions requiring association review"
};

export function EfficiencySection({ period, category }: { period: Period; category: Category }) {
  const [result, setResult] = useState<{ period: Period; category: Category; data: EfficiencyData } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(""); setResult(null);
    loadEfficiency(period, category, controller.signal).then((data) => {
      if (active) { setResult({ period, category, data }); setLoading(false); }
    }).catch(() => { if (active) { setError("Efficiency analytics are unavailable. Try again."); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [period, category, retry]);
  const data = result?.period === period && result.category === category ? result.data : null;
  return <section className="dash-card efficiency-section" aria-labelledby="efficiency-title">
    <h2 id="efficiency-title">Efficiency Analytics</h2>
    {loading && <p role="status">Loading efficiency analytics…</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry efficiency</button></p>}
    {data && <>
      <h3>Delivery Efficiency</h3>
      <p>Selected category · recorded delivery duration and delivery mileage. Gross payout rates use the same eligible cohort's sums.</p>
      <div className="efficiency-metrics">
        <Metric label="Payout / Recorded Hour" metric={data.deliveryEfficiency.payoutPerRecordedHour} records="deliveries" />
        <Metric label="Payout / Recorded Mile" metric={data.deliveryEfficiency.payoutPerRecordedMile} records="deliveries" />
      </div>
      <h3>Session Efficiency · All Categories</h3>
      <p>Complete sessions inside the selected period, regardless of the category filter. Rates require payouts for every explicitly linked delivery; an unlinked session has unknown revenue attribution.</p>
      <div className="efficiency-metrics">
        <Metric label="Known Linked Delivery Payout (may be partial)" metric={data.sessionEfficiency.knownPayoutTotal} records="sessions" />
        <Metric label="Payout / Session Hour" metric={data.sessionEfficiency.payoutPerSessionHour} records="sessions" />
        <Metric label="Payout / Session Mile" metric={data.sessionEfficiency.payoutPerSessionMile} records="sessions" />
        <Metric label="Known + Estimated Vehicle Cost Components (may be partial)" metric={data.sessionEfficiency.vehicleCost.knownAndEstimatedCost} records="sessions" />
        <Metric label="Full Modeled Vehicle Cost · eligible cohort" metric={data.sessionEfficiency.vehicleCost.fullEconomicCost} records="sessions" />
        <Metric label="Estimated Economic Profit · eligible cohort" metric={data.sessionEfficiency.estimatedEconomicProfit} records="sessions" />
        <Metric label="Estimated Economic Profit / Session Hour" metric={data.sessionEfficiency.estimatedEconomicProfitPerHour} records="sessions" />
      </div>
      <p>Pre-tax, excluding unallocated Prop 22 adjustments. Profit requires linked deliveries, complete payouts, valid duration, known miles, and all three modeled vehicle-cost components. Costs use current A.1 settings; IRS deductions are separate. Missing inputs and zero time or mileage denominators show —.</p>
      <h3>Strategy Comparison · All Categories</h3>
      <div className="ranking-scroll"><table aria-label="Strategy efficiency comparison"><thead><tr>
        <th scope="col">Strategy</th><th scope="col">Sessions</th><th scope="col">Payout / Hour</th><th scope="col">Payout / Mile</th><th scope="col">Estimated Profit</th><th scope="col">Completeness</th>
      </tr></thead><tbody>{data.strategyComparison.map((row) => <tr key={row.strategy}>
        <th scope="row">{strategies.find((item) => item.value === row.strategy)?.label ?? "Unclassified"}</th>
        <td>{row.sessionCount}</td><td>{valueLabel(row.payoutPerSessionHour)}<small>{row.payoutPerSessionHour.sampleCount} eligible · {row.payoutPerSessionHour.excludedCount} excluded</small></td>
        <td>{valueLabel(row.payoutPerSessionMile)}<small>{row.payoutPerSessionMile.sampleCount} eligible · {row.payoutPerSessionMile.excludedCount} excluded</small></td>
        <td>{valueLabel(row.estimatedEconomicProfit)}<small>{row.estimatedEconomicProfit.sampleCount} eligible · {row.estimatedEconomicProfit.excludedCount} excluded</small></td>
        <td>{row.incompleteSessionCount} incomplete of {row.sessionCount}</td>
      </tr>)}</tbody></table></div>
      <p>Comparison uses explicitly recorded strategies and weighted ratios, not recommendations. Boundary-crossing sessions are excluded without splitting; annual mileage is not session data.</p>
      <details><summary>Data completeness</summary><dl className="efficiency-quality">{Object.entries(data.dataQuality).map(([key, value]) =>
        <div key={key}><dt>{qualityLabels[key] ?? key}</dt><dd>{value}</dd></div>)}</dl></details>
    </>}
    <SettlementEfficiencySection />
  </section>;
}
