import { usd, type VehicleCost } from "./sessionApi";

export function SessionCost({ cost }: { cost: VehicleCost }) {
  const amount = (key: "energy" | "tireWear" | "depreciation") => cost.rates[key] === null ? "Not configured"
    : cost.amounts[key] === null ? "Unavailable — mileage unknown or amount outside numeric range" : usd(cost.amounts[key]);
  return <div className="session-cost" aria-label="Session vehicle cost preview">
    <dl>
      <div><dt>Energy Cash Cost</dt><dd>{amount("energy")}</dd></div>
      <div><dt>Estimated Tire Wear</dt><dd>{amount("tireWear")}</dd></div>
      <div><dt>Estimated Marginal Depreciation</dt><dd>{amount("depreciation")}</dd></div>
      <div><dt>Known + Estimated Cost Components</dt><dd>{cost.knownAndEstimatedCost === null ? "Unavailable" : usd(cost.knownAndEstimatedCost)}</dd></div>
      <div><dt>Full Economic Cost</dt><dd>{cost.fullEconomicCost === null ? "Incomplete" : usd(cost.fullEconomicCost)}</dd></div>
    </dl>
    <p className="duration-help">Estimate using current vehicle settings. Tire wear amortizes a replacement set; depreciation is an estimate. Complete covers these three modeled components only. These values do not change Dashboard earnings or tax deductions.</p>
  </div>;
}
