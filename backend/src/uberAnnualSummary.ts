import type { Db } from "mongodb";
import { z } from "zod";

export const ANNUAL_COLLECTION = "uberAnnualSummaries";
export const ANNUAL_LIMIT = 20;
const count = z.number().int().nonnegative().safe();
const miles = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Decimal validation precedes conversion; no binary floating-point equality for money.
export const annualMoneySchema = z.number().finite().nonnegative().multipleOf(0.01)
  .refine((value) => Number.isSafeInteger(Math.round(value * 100)), "Currency exceeds safe cents");
export function moneyCents(value: number): bigint {
  return BigInt(Math.round(annualMoneySchema.parse(value) * 100));
}
export function lastCompletedYear(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric" }).format(now)) - 1;
}
export function completedYearSchema(now = new Date()) { return z.number().int().min(2000).max(lastCompletedYear(now)); }
const annualFields = z.strictObject({
  completedTrips: count.optional(), onlineMiles: miles.optional(),
  grossTripEarnings: annualMoneySchema.optional(), tips: annualMoneySchema.optional(), grossTripTotal: annualMoneySchema.optional(),
  additionalEarnings: annualMoneySchema.optional(), grossPayment: annualMoneySchema.optional(),
  expensesFeesTax: annualMoneySchema.optional(), netPayout: annualMoneySchema.optional(),
  uberServiceFeeOtherAdjustments: annualMoneySchema.optional(), driverOccAccInsuranceExpense: annualMoneySchema.optional(),
  expensesBreakdownComplete: z.boolean().optional(),
  additionalBreakdown: z.strictObject({ incentives: annualMoneySchema.optional(), otherMiscellaneousPayment: annualMoneySchema.optional(), driverOccAccInsurance: annualMoneySchema.optional() }).optional(),
  additionalBreakdownComplete: z.boolean().optional()
});
const monthly = z.strictObject({ month: z.number().int().min(1).max(12), completedTrips: count.optional(), onlineMiles: miles.optional(), form1099KGrossTransactions: annualMoneySchema.optional() });
export function annualInputSchema(now = new Date()) {
  return z.strictObject({
    year: completedYearSchema(now),
    sources: z.strictObject({ uberTaxSummary: z.boolean(), form1099K: z.boolean(), form1099NEC: z.boolean() }),
    annual: annualFields,
    taxForms: z.strictObject({
      form1099K: z.strictObject({ box1aGrossTransactions: annualMoneySchema, paymentTransactionCount: count.optional() }).optional(),
      form1099NEC: z.strictObject({ box1NonemployeeCompensation: annualMoneySchema }).optional()
    }),
    monthlyActivity: z.array(monthly).max(12)
  }).superRefine((row, ctx) => {
    const issue = (path: (string | number)[]) => ctx.addIssue({ code: "custom", path, message: "Inconsistent source metadata" });
    if (!Object.values(row.sources).some(Boolean)) issue(["sources"]);
    if (row.sources.form1099K !== !!row.taxForms.form1099K) issue(["taxForms", "form1099K"]);
    if (row.sources.form1099NEC !== !!row.taxForms.form1099NEC) issue(["taxForms", "form1099NEC"]);
    if (!row.sources.uberTaxSummary && (Object.keys(row.annual).length || row.monthlyActivity.some((m) => m.completedTrips !== undefined || m.onlineMiles !== undefined))) issue(["annual"]);
    if (!row.sources.form1099K && row.monthlyActivity.some((m) => m.form1099KGrossTransactions !== undefined)) issue(["monthlyActivity"]);
    if (new Set(row.monthlyActivity.map((m) => m.month)).size !== row.monthlyActivity.length) ctx.addIssue({ code: "custom", path: ["monthlyActivity"], message: "Duplicate month" });
    if (row.annual.additionalBreakdownComplete && (!row.annual.additionalBreakdown || !Object.values(row.annual.additionalBreakdown).some((v) => v !== undefined))) issue(["annual", "additionalBreakdownComplete"]);
    if (row.annual.expensesBreakdownComplete && row.annual.uberServiceFeeOtherAdjustments === undefined && row.annual.driverOccAccInsuranceExpense === undefined) issue(["annual", "expensesBreakdownComplete"]);
  });
}
export type AnnualInput = z.infer<ReturnType<typeof annualInputSchema>>;
export interface AnnualDocument extends AnnualInput { _id: number; importedAt: Date }
export class AnnualDataError extends Error { constructor(public readonly code: "invalid_annual_data" | "annual_conflict" | "financial_review_required") { super(code); } }
export type CheckStatus = "matched" | "mismatch" | "insufficient_data";
export interface ReconciliationCheck { check: string; status: CheckStatus; expected: number | null; reported: number | null; difference: number | null; unit: "USD" | "miles" | "trips" | "transactions"; severity: "review" | "warning"; }
function safeNumber(value: bigint): number | null { return value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value); }
export function reconcileAnnual(row: AnnualInput) {
  const a = row.annual, checks: ReconciliationCheck[] = [];
  function check(name: string, parts: (number | undefined)[], reported: number | undefined, unit: ReconciliationCheck["unit"], severity: ReconciliationCheck["severity"], subtract = false) {
    const complete = reported !== undefined && parts.length > 0 && parts.every((v) => v !== undefined);
    let expected: number | null = null, difference: number | null = null, matches: boolean | null = null;
    if (complete) {
      if (unit === "USD") {
        const total = parts.reduce<bigint>((sum, value, i) => sum + moneyCents(value!) * (subtract && i > 0 ? -1n : 1n), 0n);
        const cents = safeNumber(total), delta = safeNumber(moneyCents(reported!) - total);
        expected = cents === null ? null : cents / 100; difference = delta === null ? null : delta / 100; matches = moneyCents(reported!) === total;
      } else {
        const sum = parts.reduce<number>((total, value) => total + value!, 0);
        if (Number.isFinite(sum) && sum <= Number.MAX_SAFE_INTEGER) { expected = sum; difference = reported! - sum; matches = difference === 0; }
      }
    }
    checks.push({ check: name, status: matches === null ? "insufficient_data" : matches ? "matched" : "mismatch", expected, reported: reported ?? null, difference, unit, severity });
  }
  check("tax_forms_gross_payment", [row.taxForms.form1099K?.box1aGrossTransactions, row.taxForms.form1099NEC?.box1NonemployeeCompensation], a.grossPayment, "USD", "review");
  check("gross_less_expenses", [a.grossPayment, a.expensesFeesTax], a.netPayout, "USD", "review", true);
  check("trip_earnings_plus_tips", [a.grossTripEarnings, a.tips], a.grossTripTotal, "USD", "review");
  check("trip_total_plus_additional", [a.grossTripTotal, a.additionalEarnings], a.grossPayment, "USD", "review");
  check("additional_breakdown", a.additionalBreakdownComplete ? Object.values(a.additionalBreakdown ?? {}).filter((v) => v !== undefined) : [undefined], a.additionalEarnings, "USD", "review");
  check("expense_breakdown", a.expensesBreakdownComplete ? [a.uberServiceFeeOtherAdjustments, a.driverOccAccInsuranceExpense].filter((v) => v !== undefined) : [undefined], a.expensesFeesTax, "USD", "review");
  const months = [...row.monthlyActivity].sort((x, y) => x.month - y.month);
  const allMonths = months.length === 12;
  check("monthly_trips", allMonths ? months.map((m) => m.completedTrips) : [undefined], a.completedTrips, "trips", "warning");
  check("monthly_online_miles", allMonths ? months.map((m) => m.onlineMiles) : [undefined], a.onlineMiles, "miles", "warning");
  check("monthly_1099_k", allMonths ? months.map((m) => m.form1099KGrossTransactions) : [undefined], row.taxForms.form1099K?.box1aGrossTransactions, "USD", "warning");
  check("transaction_count_vs_trips", [row.taxForms.form1099K?.paymentTransactionCount], a.completedTrips, "transactions", "warning");
  const warnings = checks.filter((c) => c.status === "mismatch");
  return { status: warnings.length ? "warning" as const : checks.some((c) => c.status === "insufficient_data") ? "partial" as const : "matched" as const, checks, warnings };
}

export const annualMetricNames = ["completedTrips", "onlineMiles", "onlineMilesPerTrip", "grossPayment", "expensesFeesTax", "netPayout", "netPayoutPerTrip", "netPayoutPerOnlineMile"] as const;
export type AnnualMetricName = typeof annualMetricNames[number];
export interface AnnualMetric {
  value: number | null; unit: "USD" | "miles" | "trips" | "miles/trip" | "USD/trip" | "USD/mile";
  sampleCount: number; denominator: number | null; denominatorComplete: boolean;
  origin: "reported" | "calculated"; sourceKind: "uber_tax_summary";
}
export function annualMetrics(row: AnnualInput): Record<AnnualMetricName, AnnualMetric> {
  const a = row.annual;
  const metric = (value: number | undefined, unit: AnnualMetric["unit"]): AnnualMetric => ({ value: value ?? null, unit, sampleCount: value === undefined ? 0 : 1, denominator: null, denominatorComplete: true, origin: "reported", sourceKind: "uber_tax_summary" });
  const ratio = (numerator: number | undefined, denominator: number | undefined, unit: AnnualMetric["unit"]): AnnualMetric => {
    const result = numerator !== undefined && denominator !== undefined && denominator > 0 ? numerator / denominator : null;
    const value = result !== null && Number.isFinite(result) ? result : null;
    return { value, unit, sampleCount: value === null ? 0 : 1, denominator: denominator ?? null, denominatorComplete: denominator !== undefined && denominator > 0, origin: "calculated", sourceKind: "uber_tax_summary" };
  };
  return { completedTrips: metric(a.completedTrips, "trips"), onlineMiles: metric(a.onlineMiles, "miles"),
    onlineMilesPerTrip: ratio(a.onlineMiles, a.completedTrips, "miles/trip"), grossPayment: metric(a.grossPayment, "USD"),
    expensesFeesTax: metric(a.expensesFeesTax, "USD"), netPayout: metric(a.netPayout, "USD"),
    netPayoutPerTrip: ratio(a.netPayout, a.completedTrips, "USD/trip"), netPayoutPerOnlineMile: ratio(a.netPayout, a.onlineMiles, "USD/mile") };
}
export function monthlyGrossPeak(row: AnnualInput) {
  const available = row.monthlyActivity.filter((month) => month.form1099KGrossTransactions !== undefined);
  const value = available.length ? Math.max(...available.map((month) => month.form1099KGrossTransactions!)) : null;
  return { value, months: available.filter((month) => month.form1099KGrossTransactions === value).map((month) => month.month).sort((a, b) => a - b), observedMonths: available.length, complete: available.length === 12 };
}
export function annualSummary(row: AnnualInput) {
  return { year: row.year, sources: row.sources, annual: row.annual, taxForms: row.taxForms,
    monthlyActivity: [...row.monthlyActivity].sort((a, b) => a.month - b.month), metrics: annualMetrics(row), monthlyGrossTransactionsPeak: monthlyGrossPeak(row), reconciliation: reconcileAnnual(row) };
}
export type AnnualSummary = ReturnType<typeof annualSummary>;
export function compareAnnualYears(before: AnnualSummary, after: AnnualSummary) {
  return { fromYear: before.year, toYear: after.year, consecutiveYears: after.year === before.year + 1,
    changes: annualMetricNames.map((metric) => {
      const previous = before.metrics[metric], current = after.metrics[metric];
      let absoluteChange: number | null = null, percentageChange: number | null = null;
      if (previous.value !== null && current.value !== null) {
        if (previous.origin === "reported" && previous.unit === "USD") {
          const change = safeNumber(moneyCents(current.value) - moneyCents(previous.value)); absoluteChange = change === null ? null : change / 100;
        } else absoluteChange = current.value - previous.value;
        if (absoluteChange !== null && previous.value !== 0) percentageChange = absoluteChange / previous.value * 100;
      }
      if (absoluteChange !== null && !Number.isFinite(absoluteChange)) absoluteChange = null;
      if (percentageChange !== null && !Number.isFinite(percentageChange)) percentageChange = null;
      return { metric, unit: previous.unit, origin: "calculated" as const, sourceKind: "uber_tax_summary" as const,
        previousValue: previous.value, currentValue: current.value, absoluteChange, percentageChange,
        previousDenominator: previous.denominator, currentDenominator: current.denominator,
        denominatorComplete: previous.denominatorComplete && current.denominatorComplete };
    }) };
}
export function summarizeAnnualRows(rows: AnnualInput[]) {
  const data = rows.map(annualSummary).sort((a, b) => b.year - a.year);
  return { data, comparisons: data.slice(0, -1).map((newer, index) => compareAnnualYears(data[index + 1]!, newer)) };
}
function validateDocument(doc: AnnualDocument, now: Date): AnnualInput {
  const { _id, importedAt, ...input } = doc;
  const parsed = annualInputSchema(now).safeParse(input);
  if (!parsed.success || _id !== parsed.data.year || !(importedAt instanceof Date) || !Number.isFinite(importedAt.getTime())) throw new AnnualDataError("invalid_annual_data");
  return parsed.data;
}
export async function getAnnualSummaries(db: Db, years?: number[], now = new Date()) {
  if (years && (!years.length || years.length > 3 || new Set(years).size !== years.length || years.some((y) => !completedYearSchema(now).safeParse(y).success))) throw new AnnualDataError("invalid_annual_data");
  const rows = await db.collection<AnnualDocument>(ANNUAL_COLLECTION).find(years ? { _id: { $in: years } } : {}).sort({ _id: -1 }).limit(ANNUAL_LIMIT + 1).toArray();
  return { ...summarizeAnnualRows(rows.slice(0, ANNUAL_LIMIT).map((row) => validateDocument(row, now))), limit: ANNUAL_LIMIT, hasMore: rows.length > ANNUAL_LIMIT };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function identity(row: AnnualInput) { return canonical({ ...row, monthlyActivity: [...row.monthlyActivity].sort((a, b) => a.month - b.month) }); }
export async function importAnnualSummary(db: Db, input: unknown, apply: boolean, now = new Date()) {
  const parsed = annualInputSchema(now).safeParse(input);
  if (!parsed.success) throw new AnnualDataError("invalid_annual_data");
  const row = parsed.data, reconciliation = reconcileAnnual(row);
  if (reconciliation.warnings.some((check) => check.severity === "review")) throw new AnnualDataError("financial_review_required");
  const collection = db.collection<AnnualDocument>(ANNUAL_COLLECTION);
  const existing = await collection.findOne({ _id: row.year });
  if (existing) {
    if (identity(validateDocument(existing, now)) !== identity(row)) throw new AnnualDataError("annual_conflict");
    return { status: "already_imported" as const, year: row.year, reconciliation };
  }
  if (!apply) return { status: "dry_run" as const, year: row.year, reconciliation };
  try { await collection.insertOne({ _id: row.year, ...row, importedAt: now }); }
  catch (error) {
    // Unique _id also protects concurrent CLI runs; never overwrite on races.
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      const concurrent = await collection.findOne({ _id: row.year });
      if (concurrent && identity(validateDocument(concurrent, now)) === identity(row)) return { status: "already_imported" as const, year: row.year, reconciliation };
      throw new AnnualDataError("annual_conflict");
    }
    throw error;
  }
  return { status: "imported" as const, year: row.year, reconciliation };
}
