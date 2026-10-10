import { useEffect, useState } from "react";
import { requestJson } from "./api";

interface AnnualMetric { value: number | null }
interface AnnualStatement {
  year: number;
  sources: { uberTaxSummary: boolean; form1099K: boolean; form1099NEC: boolean };
  annual: { completedTrips?: number; onlineMiles?: number; grossPayment?: number; netPayout?: number };
  metrics: { netPayoutPerTrip: AnnualMetric; netPayoutPerOnlineMile: AnnualMetric };
  monthlyActivity: { month: number; completedTrips?: number; onlineMiles?: number; form1099KGrossTransactions?: number }[];
  reconciliation: { status: "matched" | "partial" | "warning"; warnings: { check: string; expected: number | null; reported: number | null; difference: number | null; unit: string }[] };
}
interface AnnualPage { data: AnnualStatement[]; limit: number; hasMore: boolean }
function isAnnualPage(value: unknown): value is AnnualPage {
  if (!value || typeof value !== "object") return false;
  const page = value as Partial<AnnualPage>;
  const finite = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  const optional = (v: unknown) => v === undefined || finite(v);
  return Number.isInteger(page.limit) && typeof page.hasMore === "boolean" && Array.isArray(page.data) && page.data.length <= 20 && page.data.every((row) =>
    row && Number.isInteger(row.year) && row.sources && Object.values(row.sources).length === 3 && Object.values(row.sources).every((v) => typeof v === "boolean")
    && row.annual && [row.annual.completedTrips, row.annual.onlineMiles, row.annual.grossPayment, row.annual.netPayout].every(optional)
    && row.metrics?.netPayoutPerTrip && row.metrics?.netPayoutPerOnlineMile && [row.metrics.netPayoutPerTrip.value, row.metrics.netPayoutPerOnlineMile.value].every((v) => v === null || finite(v))
    && Array.isArray(row.monthlyActivity) && row.monthlyActivity.length <= 12 && row.monthlyActivity.every((m) => m && Number.isInteger(m.month) && m.month >= 1 && m.month <= 12 && [m.completedTrips, m.onlineMiles, m.form1099KGrossTransactions].every(optional))
    && row.reconciliation && ["matched", "partial", "warning"].includes(row.reconciliation.status) && Array.isArray(row.reconciliation.warnings) && row.reconciliation.warnings.length <= 10 && row.reconciliation.warnings.every((w) => w && typeof w.check === "string" && typeof w.unit === "string" && [w.expected, w.reported, w.difference].every((v) => v === null || finite(v))));
}
const number = (value: number | null | undefined) => value == null ? "Unknown" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const usd = (value: number | null | undefined) => value == null ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const checkLabels: Record<string, string> = { monthly_online_miles: "Monthly Online Miles", monthly_trips: "Monthly Completed Trips", monthly_1099_k: "Monthly 1099-K Gross Transactions", transaction_count_vs_trips: "1099-K transactions versus Completed Trips", tax_forms_gross_payment: "1099 forms versus Gross Payment", gross_less_expenses: "Gross Payment less expenses", trip_earnings_plus_tips: "Trip earnings plus tips", trip_total_plus_additional: "Trip total plus additional earnings", additional_breakdown: "Additional earnings breakdown", expense_breakdown: "Expense breakdown" };
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function UberAnnualStatements() {
  const [page, setPage] = useState<AnnualPage | null>(null), [error, setError] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setPage(null); setError(false);
    requestJson<AnnualPage>("/api/uber-annual-summaries", { signal: controller.signal })
      .then((value) => { if (!isAnnualPage(value)) throw new Error("Invalid annual response"); if (active) setPage(value); })
      .catch(() => { if (active && !controller.signal.aborted) setError(true); });
    return () => { active = false; controller.abort(); };
  }, [revision]);
  return <section className="session-section annual-statements" aria-labelledby="annual-statements-title">
    <div className="session-section-heading"><h2 id="annual-statements-title">Uber Annual Statements</h2></div>
    <p className="annual-description">Independent platform annual and monthly aggregates. Uber Tax Summary is not an official tax document; issued Forms 1099-K and 1099-NEC are separate tax forms. These amounts are not added to DGI delivery or payment income.</p>
    <p className="annual-description">Net Payout is not full vehicle economic profit or after-tax income. Online Miles are Uber-reported activity miles, not DGI Session, official Prop 22 engaged, or verified tax-eligible miles. Unknown values remain unknown.</p>
    {error ? <div className="history-alert" role="alert">Annual statements could not be loaded. <button type="button" className="button button-secondary" onClick={() => setRevision((value) => value + 1)}>Retry Annual Statements</button></div>
      : !page ? <p role="status">Loading annual statements…</p>
      : !page.data.length ? <p>No Uber annual statements imported. Use the private local import CLI.</p>
      : <>
        <div className="history-table-card"><div className="table-scroll" role="region" aria-label="Uber annual comparison" tabIndex={0}>
          <table className="history-table annual-statements-table"><caption className="annual-caption">Uber-reported annual aggregates and calculated rates</caption><thead><tr>
            <th scope="col">Year</th><th scope="col">Completed Trips</th><th scope="col">Online Miles</th><th scope="col">Gross Payment</th><th scope="col">Net Payout</th><th scope="col">Net Payout / Online Mile</th><th scope="col">Net Payout / Completed Trip</th><th scope="col">Sources / Reconciliation</th>
          </tr></thead><tbody>{page.data.map((row) => <tr key={row.year}>
            <th scope="row">{row.year}</th><td>{number(row.annual.completedTrips)}</td><td>{number(row.annual.onlineMiles)}</td><td>{usd(row.annual.grossPayment)}</td><td>{usd(row.annual.netPayout)}</td><td>{usd(row.metrics.netPayoutPerOnlineMile.value)}</td><td>{usd(row.metrics.netPayoutPerTrip.value)}</td>
            <td><span>{[row.sources.uberTaxSummary && "Uber Tax Summary", row.sources.form1099K && "1099-K", row.sources.form1099NEC && "1099-NEC"].filter(Boolean).join(" · ") || "Unavailable"}</span><br />{row.reconciliation.status === "partial" ? "Partial — some checks lack data" : row.reconciliation.status === "warning" ? "Warning — source differences preserved" : "Matched"}</td>
          </tr>)}</tbody></table>
        </div></div>
        {page.hasMore && <p className="annual-description">Showing the most recent {page.limit} completed years.</p>}
        {page.data.map((row) => <div key={row.year}>
          {row.reconciliation.warnings.map((warning) => <p key={warning.check} className="annual-warning" role="note">{row.year}: {checkLabels[warning.check] ?? "Source reconciliation"} — reported {number(warning.reported)}, expected {number(warning.expected)}, difference {number(warning.difference)} {warning.unit}. Original source observations were preserved.</p>)}
          <details className="settlement-details"><summary>{row.year} Monthly Activity</summary>
            <p className="annual-description">1099-K amounts are gross reported transactions, not monthly Net Payout. Missing monthly values are unknown; reported zero is valid.</p>
            <div className="table-scroll" role="region" aria-label={`${row.year} monthly activity`} tabIndex={0}><table className="history-table annual-monthly-table"><thead><tr><th scope="col">Month</th><th scope="col">Completed Trips</th><th scope="col">Online Miles</th><th scope="col">1099-K Gross Transactions (USD)</th></tr></thead><tbody>
              {months.map((month, index) => { const entry = row.monthlyActivity.find((item) => item.month === index + 1); return <tr key={month}><th scope="row">{month}</th><td>{number(entry?.completedTrips)}</td><td>{number(entry?.onlineMiles)}</td><td>{usd(entry?.form1099KGrossTransactions)}</td></tr>; })}
            </tbody></table></div>
          </details>
        </div>)}
      </>}
    <p className="annual-description">Tracking workflow: 2024–2025 use platform-reported aggregates. January 1–September 23, 2026 detailed History backfill is in progress; September 24, 2026 onward uses DGI detailed records. This describes the recording workflow and does not prove complete coverage or reconstruct historical GIS observations.</p>
  </section>;
}
