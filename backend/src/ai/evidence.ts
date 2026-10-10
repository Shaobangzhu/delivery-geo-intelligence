import type { AnnualSummary, compareAnnualYears } from "../uberAnnualSummary.js";
import { randomUUID } from "node:crypto";
import { AnalystError } from "./types.js";

export interface Provenance { execution: string; tool: string; scope: string; basis: string; cohort: string; eligibility?: string; year?: number; origin?: "reported" | "calculated"; sourceKind?: string; definition?: string; comparisonGroup?: string }
export interface Fact { id: string; label: string; display: string; source: Provenance; unit?: string; value?: number | null }
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
  compare_strategies: "Strategy observations", get_settlement_efficiency: "Work-period efficiency", get_data_quality: "Data completeness"
};
function labelFor(path: string[]) {
  return path.filter((key) => !["scope", "metrics", "summary", "strategies", "settlements", "dataQuality"].includes(key) && !/^\d+$/.test(key))
    .map((key) => labels[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")).join(" · ");
}
const currencyKeys = new Set("actualAdjustment knownTotal workPeriodRevenue estimatedEconomicProfit fullTotal knownAndEstimatedTotal deliveryEarnings prop22Earnings".split(" "));
function scalarUnit(key: string) {
  return /PerHour$/.test(key) ? "USD/hour" : /PerMile$/.test(key) ? "USD/mile"
    : currencyKeys.has(key) ? "USD" : key === "totalHours" ? "hours" : key === "totalMiles" ? "miles" : undefined;
}
export function createEvidenceCollector() {
  const prefix = randomUUID(), facts = new Map<string, Fact>();
  function collect(data: unknown, tool: string, execution: number): Fact[] {
    if (tool === "get_annual_uber_summary") return collectAnnual(data, execution);
    const root = data as { scope?: { period: string; category: string; range: { startDate: string; endDate: string; timeZone: string } } | string; basis?: string };
    const scope = typeof root.scope === "object" && root.scope?.range
      ? `${root.scope.period} · ${root.scope.category} · ${root.scope.range.startDate}–${root.scope.range.endDate} (${root.scope.range.timeZone})`
      : String(root.scope ?? "unspecified");
    const source: Provenance = { execution: `t${execution}`, tool, scope, basis: root.basis ?? (tool === "get_settlement_efficiency" ? "settlement_coverage_period" : "recorded_operations"),
      cohort: tool === "get_delivery_efficiency" ? "recorded_deliveries" : tool === "get_period_summary" ? "cash_receipts" : "whole_sessions" };
    const added: Fact[] = [];
    function visit(value: unknown, path: string[], context: Provenance) {
      const metricKey = path.at(-1)!;
      if (metricKey.startsWith("estimatedEconomicProfit")) context = { ...context, basis: context.basis === "settlement_coverage_period" ? "settlement_coverage_period_pre_tax" : "pre_tax_excluding_unallocated_prop22" };
      if (path.includes("vehicleCost")) context = { ...context, basis: "current_profile_cost" };
      const add = (display: string, unit?: string, number?: number | null) => {
        const fact: Fact = { id: `${prefix}:e${facts.size + 1}`, label: labelFor(path), display, source: context, ...(unit ? { unit } : {}), ...(number !== undefined ? { value: number } : {}) };
        facts.set(fact.id, fact); added.push(fact);
      };
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const row = value as Record<string, unknown>;
        if (typeof row.strategy === "string") { path = [...path, row.strategy]; context = { ...context, cohort: `strategy:${row.strategy}` }; }
        if (typeof row.paymentDate === "string") {
          context = { ...context, scope: `Payment ${row.paymentDate}; coverage ${row.coverageStartDate ?? "unavailable"}–${row.coverageEndDate ?? "unavailable"} (America/Los_Angeles)`, basis: "settlement_coverage_period" };
          if (row.sessionCoverage && row.deliveryRevenue && row.vehicleCost) {
            const sessions = row.sessionCoverage as Record<string, unknown>, deliveries = row.deliveryRevenue as Record<string, unknown>, costs = row.vehicleCost as Record<string, unknown>;
            context.eligibility = `received payments: 1; status: ${row.status}; sessions: ${sessions.includedSessionCount}; boundary excluded: ${sessions.excludedBoundarySessionCount}; known payouts: ${deliveries.knownPayoutCount}; missing payouts: ${deliveries.missingPayoutCount}; complete cost sessions: ${costs.completeSessionCount}; confirmed: ${sessions.completenessConfirmed}; structurally complete: ${sessions.structurallyComplete}; reasons: ${(row.reasons as string[]).join(", ") || "none"}`;
          }
        }
        if ("value" in row && "sampleCount" in row) {
          const unit = typeof row.unit === "string" ? row.unit : "USD";
          add(`${row.value === null ? "unavailable" : row.value} ${unit} (sample: ${row.sampleCount}; excluded: ${row.excludedCount ?? "not supplied"}; reasons: ${Array.isArray(row.reasons) ? row.reasons.join(", ") || "none" : "not supplied"})`, unit, row.value as number | null);
          // Dashboard earnings also contain meaningful cash component counts/amounts.
          for (const key of ["deliveryEarnings", "prop22Earnings", "prop22PaymentCount"]) if (key in row) visit(row[key], [...path, key], context);
          return;
        }
        for (const [key, item] of Object.entries(row)) {
          if (["limitations", "backfillWorkflows", "units", "settlementId"].includes(key)) continue;
          visit(item, [...path, key], context);
        }
      } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, [...path, String(index)], context));
      else if (path.length) {
        const unit = scalarUnit(path.at(-1)!);
        // Scalar settlement rates retain their completeness denominator in scope;
        // the final renderer also appends all successful tool limitations.
        add(`${value === null ? "unavailable" : String(value)}${unit ? ` ${unit}` : ""}`, unit, unit && (typeof value === "number" || value === null) ? value : undefined);
      }
    }
    visit(data, [tool], source);
    return added;
  }
  // Annual evidence has explicit year, definition, source and reported/calculated
  // provenance. Monthly observations are grouped to keep the unchanged byte budget.
  function collectAnnual(data: unknown, execution: number): Fact[] {
    const result = data as { annualReports: AnnualSummary[]; annualComparisons: ReturnType<typeof compareAnnualYears>[] };
    const added: Fact[] = [];
    const titles: Record<string, string> = { completedTrips: "Completed Trips", onlineMiles: "Online Miles (annual reported)", onlineMilesPerTrip: "Online Miles / Completed Trip", grossPayment: "Gross Payment", expensesFeesTax: "Reported Expenses, Fees and Tax", netPayout: "Net Payout (not economic profit)", netPayoutPerTrip: "Net Payout / Completed Trip", netPayoutPerOnlineMile: "Net Payout / annual Online Mile" };
    const add = (label: string, display: string, source: Provenance, unit: string, value?: number | null) => {
      const fact: Fact = { id: `${prefix}:e${facts.size + 1}`, label, display, source, unit, ...(value !== undefined ? { value } : {}) };
      facts.set(fact.id, fact); added.push(fact);
    };
    for (const row of result.annualReports) {
      const base: Provenance = { execution: `t${execution}`, tool: "get_annual_uber_summary", scope: `Uber annual reporting ${row.year}`, basis: "uber_annual_reporting", cohort: "annual_statement_aggregates", year: row.year, origin: "reported", sourceKind: "uber_tax_summary" };
      for (const [definition, metric] of Object.entries(row.metrics)) add(`${row.year} · ${titles[definition]}`, `${metric.value ?? "unavailable"} ${metric.unit}; denominator: ${metric.denominator ?? "not applicable"}; denominator complete: ${metric.denominatorComplete}; sample: ${metric.sampleCount}`, { ...base, definition, origin: metric.origin }, metric.unit, metric.value);
      for (const definition of ["grossTripEarnings", "tips", "grossTripTotal", "additionalEarnings", "uberServiceFeeOtherAdjustments", "driverOccAccInsuranceExpense"] as const) {
        const value = row.annual[definition];
        if (value !== undefined) add(`${row.year} · Reported ${definition}`, `${value} USD`, { ...base, definition }, "USD", value);
      }
      if (row.annual.additionalBreakdown) add(`${row.year} · Reported additional earnings breakdown`, `incentives: ${row.annual.additionalBreakdown.incentives ?? "unavailable"}; miscellaneous payment: ${row.annual.additionalBreakdown.otherMiscellaneousPayment ?? "unavailable"}; OccAcc insurance: ${row.annual.additionalBreakdown.driverOccAccInsurance ?? "unavailable"} USD; source-reviewed complete: ${row.annual.additionalBreakdownComplete ?? "unknown"}`, { ...base, definition: "additional_earnings_breakdown" }, "USD");
      add(`${row.year} · Source availability`, `Uber Tax Summary: ${row.sources.uberTaxSummary}; 1099-K: ${row.sources.form1099K}; 1099-NEC: ${row.sources.form1099NEC}`, { ...base, definition: "source_availability" }, "metadata");
      for (const [form, values] of Object.entries(row.taxForms)) for (const [definition, value] of Object.entries(values)) add(`${row.year} · ${form} · ${definition}`, `${value} ${definition === "paymentTransactionCount" ? "transactions" : "USD"}`, { ...base, definition, sourceKind: form === "form1099K" ? "form_1099_k" : "form_1099_nec" }, definition === "paymentTransactionCount" ? "transactions" : "USD", value);
      for (const check of row.reconciliation.checks) add(`${row.year} · Reconciliation · ${check.check}`, `${check.status}; reported: ${check.reported ?? "unavailable"}; expected: ${check.expected ?? "unavailable"}; difference: ${check.difference ?? "unavailable"} ${check.unit}; ${check.severity}`, { ...base, definition: check.check, origin: "calculated" }, check.unit);
      const peak = row.monthlyGrossTransactionsPeak;
      add(`${row.year} · Backend-calculated highest observed monthly 1099-K gross transactions`, `${peak.value ?? "unavailable"} USD; months: ${peak.months.join(", ") || "unavailable"}; observed months: ${peak.observedMonths}; complete annual monthly coverage: ${peak.complete}; gross transactions, not Net Payout`, { ...base, definition: "highest_observed_monthly_1099_k_gross", origin: "calculated", sourceKind: "form_1099_k" }, "USD", peak.value);
      for (const month of row.monthlyActivity) add(`${row.year} · Month ${month.month} · Reported monthly observations`, `Completed Trips: ${month.completedTrips ?? "unavailable"}; Online Miles: ${month.onlineMiles ?? "unavailable"}; 1099-K gross transactions: ${month.form1099KGrossTransactions ?? "unavailable"} USD (not monthly Net Payout)`, { ...base, scope: `${row.year} month ${month.month}`, basis: "uber_monthly_reporting", cohort: "monthly_statement_aggregates", sourceKind: "uber_tax_summary_and_form_1099_k", definition: "monthly_trips_online_miles_gross_transactions" }, "trips; miles; USD");
    }
    for (const comparison of result.annualComparisons) for (const change of comparison.changes) {
      const group = `${comparison.fromYear}→${comparison.toYear}`;
      add(`${group} · ${titles[change.metric]} · Backend-calculated change`, `from: ${change.previousValue ?? "unavailable"}; to: ${change.currentValue ?? "unavailable"}; absolute change: ${change.absoluteChange ?? "unavailable"} ${change.unit}; percentage change: ${change.percentageChange ?? "unavailable"}%; denominator complete: ${change.denominatorComplete}; from denominator: ${change.previousDenominator ?? "not applicable"}; to denominator: ${change.currentDenominator ?? "not applicable"}; consecutive years: ${comparison.consecutiveYears}`, { execution: `t${execution}`, tool: "get_annual_uber_summary", scope: `Uber annual comparison ${group}`, basis: "uber_annual_comparison", cohort: "same_annual_metric_definition", year: comparison.toYear, origin: "calculated", sourceKind: change.sourceKind, definition: change.metric, comparisonGroup: group }, change.unit, change.absoluteChange);
    }
    if (!added.length) add("Uber annual statements", "No selected completed-year statements available.", { execution: `t${execution}`, tool: "get_annual_uber_summary", scope: "selected_completed_years", basis: "uber_annual_reporting", cohort: "annual_statement_aggregates", origin: "reported", definition: "availability" }, "metadata");
    return added;
  }
  return { facts, collect };
}

export function requiresComparisonBoundary(selected: Fact[]) {
  const values = selected.filter((fact) => fact.unit);
  return selected.some((fact) => fact.source.tool === "compare_strategies") || new Set(selected.map((fact) =>
    JSON.stringify([fact.source.scope, fact.source.basis, fact.source.cohort]))).size > 1 || new Set(values.map((fact) => fact.unit)).size > 1;
}

// This exception changes only the server-authored explanation. It never permits
// model arithmetic, mixed DGI bases, other tools or arbitrary annual comparisons.
export function isDeterministicAnnualComparison(selected: Fact[]) {
  return selected.length > 0 && selected.every((fact) => fact.source.tool === "get_annual_uber_summary" && fact.source.basis === "uber_annual_comparison" && fact.source.origin === "calculated" && fact.source.comparisonGroup)
    && new Set(selected.map((fact) => `${fact.source.execution}:${fact.source.comparisonGroup}`)).size === 1;
}

// Amounts, signs, percentages and dates belong in server evidence, not model
// prose. A few exact conceptual phrases avoid rejecting useful null/zero
// explanations or the names of accounting views. NFKC closes full-width forms.
export function validateNarrative(explanation: string) {
  const qualitative = explanation.normalize("NFKC").replace(/Prop\s*22/gi, "Prop guarantee")
    .replace(/\b(?:not double counted|do not double count|half-open intervals?|recorded zero is valid|missing values should not be treated as zero)\b/gi, "accounting concept")
    .replace(/(?:unknown|missing|unavailable)(?:\s+is|\s+means|\s+payout\s+is)?[,;]?\s+not\s+(?:a\s+recorded\s+)?zero/gi, "unknown")
    .replace(/(?:one|two)\s+(?:different\s+)?(?:accounting\s+)?views?/gi, "accounting views")
    .replace(/(?:未知|缺失|不可用)(?:值|数据|收入|记录)?(?:不是|不等于|不代表|不能当作|不能视为|不应视为)(?:零|0)/gu, "未知")
    .replace(/一般|进一步|一致|一些|一定|一方面|另一方面|百分比|统一|千万不要/gu, "概念");
  if (/\p{N}|[%％$€£]|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|dozen|double[ds]?|triple[ds]?|halved|twice|half|quarter)\b|[零〇一二三四五六七八九十百千万亿两壹贰叁肆伍陆柒捌玖拾佰仟萬億]|翻倍|减半/iu.test(qualitative)) throw new AnalystError("ungrounded_answer");
  // Defense in depth for unsupported actions/comparative conclusions. Scope
  // safety itself is structured; this is not a complete NLP truth detector.
  if (/\b(?:deleted|updated|inserted|modified|erased)\b|已(?:删除|修改|更新|写入)|\b(?:outperform(?:s|ed)?|improved|caused|superior|better|increased|higher|lower|exceed(?:s|ed)?|more profitable)\b|(?:更赚钱|更高|更低|优于|改善了|提高了|导致)/iu.test(qualitative)) throw new AnalystError("ungrounded_answer");
}
