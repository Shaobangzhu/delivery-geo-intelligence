import { getAnnualSummaries, completedYearSchema } from "../uberAnnualSummary.js";
import type { Db } from "mongodb";
import { z } from "zod";
import { createDashboardFilterSchema, dashboardFilterSchema, getDashboardAnalytics } from "../dashboard.js";
import { getEfficiencyAnalytics } from "../efficiency.js";
import { getSettlementEfficiency } from "../settlementEfficiency.js";
import { objectIdSchema } from "../model.js";
import { AnalystError, type ReadCoordinator } from "./types.js";
import { projectAggregate } from "./projection.js";

const period = dashboardFilterSchema.shape.period.removeDefault();
const asOf = z.iso.date().nullable().describe("Use null for the current period. For a historical period use a date in that period; the trusted current Los Angeles date is in instructions.");
const category = dashboardFilterSchema.shape.category.removeDefault();
const year = z.number().int().min(2026).nullable().describe("Selected detailed calendar year, or null. Only for Year; do not combine with asOf. Never use official annual years before 2026.");
const periodArgs = z.strictObject({ period, asOf, year });
const categoryArgs = periodArgs.extend({ category });
const annualArgs = z.strictObject({ years: z.array(z.number().int().min(2000)).min(1).max(2).refine((years) => new Set(years).size === years.length), includeMonthly: z.boolean() });
const settlementArgs = z.strictObject({ settlementId: objectIdSchema.nullable(), limit: z.number().int().min(1).max(5) });
export interface DomainServices {
  dashboard: typeof getDashboardAnalytics;
  efficiency: typeof getEfficiencyAnalytics;
  settlements: typeof getSettlementEfficiency;
  annual: typeof getAnnualSummaries;
}
const services: DomainServices = { dashboard: getDashboardAnalytics, efficiency: getEfficiencyAnalytics, settlements: getSettlementEfficiency, annual: getAnnualSummaries };
const limitations = ["Personally observed convenience sample, not market demand.", "Missing is unknown; recorded zero is valid.", "Separate tool reads are not one shared snapshot."];
const sessionLimitations = ["All categories; whole sessions only. Boundary crossings are excluded.", "Partial known payout and partial costs are not complete revenue or full cost.", "Current vehicle assumptions; pre-tax profit excludes unallocated Prop 22. IRS deduction is separate."];
const descriptions = {
  get_annual_uber_summary: "Independent Uber annual statements for up to two completed years. Optional monthly gross 1099-K transactions, not monthly net income. Changes are calculated by the backend; never merge with DGI cash income or infer Prop 22 from 1099-NEC.",
  get_period_summary: "Detailed DGI cash-basis Dashboard summary from 2026 onward. All is cumulative detailed history; Year accepts a selected year. Actual received adjustments use payment dates; category earnings exclude them.",
  get_delivery_efficiency: "Gross recorded-delivery payout/hour and payout/mile, matched eligible cohorts, units and sample counts.",
  get_session_efficiency: "All-category whole-session linked payout, weighted rates, current modeled costs, pre-tax profit and completeness.",
  compare_strategies: "Descriptive comparison of explicitly recorded strategies, including unclassified; no causal or inferred superiority.",
  get_settlement_efficiency: "Work-period Prop 22 efficiency with confirmation and structural checks. Latest by default; up to five recent settlements, or an ID within the existing twenty-record result. Never allocate adjustments.",
  get_data_quality: "Existing missing-observation counts plus up to five recent settlement completeness summaries. Backfill only through History's existing forms."
};
export type ToolName = keyof typeof descriptions;
const schemas = { get_annual_uber_summary: annualArgs, get_period_summary: categoryArgs, get_delivery_efficiency: categoryArgs,
  get_session_efficiency: periodArgs, compare_strategies: periodArgs, get_settlement_efficiency: settlementArgs, get_data_quality: periodArgs };
// Responses strict mode requires every property to be required; optional inputs use null.
export const toolDefinitions = (Object.keys(descriptions) as ToolName[]).map((name) => {
  const schema = z.toJSONSchema(schemas[name]) as Record<string, unknown>;
  delete schema.$schema;
  if (name === "get_settlement_efficiency") {
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    delete properties.limit.default;
  }
  schema.required = Object.keys(schema.properties as object);
  return { type: "function" as const, name, description: descriptions[name], parameters: schema, strict: true };
});

export function createToolRegistry(db: Db, coordinate: ReadCoordinator, domain: DomainServices = services, now = new Date()) {
  const filters = (args: z.infer<typeof periodArgs>, selectedCategory: z.infer<typeof category> = "all") =>
    createDashboardFilterSchema(now).parse({ period: args.period, category: selectedCategory, ...(args.asOf ? { asOf: args.asOf } : {}), ...(args.year !== null ? { year: args.year } : {}) });
  const handlers = {
    async get_annual_uber_summary(args: z.infer<typeof annualArgs>) {
      const data = await domain.annual(db, args.years, now);
      return { scope: "uber_annual_reporting", basis: "uber_annual_reporting",
        annualReports: data.data.map((row) => ({ ...row, monthlyActivity: args.includeMonthly ? row.monthlyActivity : [] })), annualComparisons: data.comparisons,
        limitations: [...limitations, "Independent annual statements are not additional DGI cash income or detailed delivery/GIS coverage.",
          "Uber Tax Summary is a platform report, not an official tax document; issued 1099-K/NEC are separate tax forms.",
          "Monthly 1099-K values are gross reported transactions, not monthly Net Payout. Missing months/fields are unknown.",
          "Net Payout is not full economic profit or after-tax income. Online Miles are not Session, Prop 22 engaged or verified tax miles.",
          "1099-NEC/miscellaneous compensation does not establish Prop 22. Historical deliveries, sessions and hours cannot be reconstructed.",
          "Only backend-derived changes compare the same annual metric definitions; differences do not establish causality or strategy superiority."] };
    },
    async get_period_summary(args: z.infer<typeof categoryArgs>) {
      const data = await domain.dashboard(db, filters(args, args.category), now);
      return { scope: data.filters, basis: "cash_basis", summary: { totalDeliveries: data.summary.totalDeliveries,
        uniqueMerchants: data.summary.uniqueMerchants, totalEarnings: data.summary.totalEarnings },
        units: { earnings: "USD", counts: "records" }, limitations };
    },
    async get_delivery_efficiency(args: z.infer<typeof categoryArgs>) {
      const data = await domain.efficiency(db, filters(args, args.category), now);
      return { scope: data.filters, metrics: data.deliveryEfficiency,
        limitations: [...limitations, "Recorded delivery duration/distance are not Session or official engaged time/miles."] };
    },
    async get_session_efficiency(args: z.infer<typeof periodArgs>) {
      const data = await domain.efficiency(db, filters(args), now);
      return { scope: data.filters, metrics: data.sessionEfficiency, dataQuality: data.dataQuality, limitations: [...limitations, ...sessionLimitations] };
    },
    async compare_strategies(args: z.infer<typeof periodArgs>) {
      const data = await domain.efficiency(db, filters(args), now);
      return { scope: data.filters, strategies: data.strategyComparison,
        limitations: [...limitations, ...sessionLimitations, "Small or excluded cohorts do not establish causal strategy superiority."] };
    },
    async get_settlement_efficiency(args: z.infer<typeof settlementArgs>) {
      const data = await domain.settlements(db);
      const selected = args.settlementId ? data.data.filter((row) => row.settlementId === args.settlementId!.toLowerCase()) : data.data.slice(0, args.limit);
      return { scope: "all_categories_settlement_coverage", status: selected.length ? "available" : "unavailable",
        settlements: selected.map(({ settlementId: _id, ...row }) => row), recentResultLimit: data.limit, totalSettlements: data.totalSettlements, hasMore: data.hasMore,
        units: { revenueAndCost: "USD", hourlyRates: "USD/hour", mileageRates: "USD/mile", time: "hours", distance: "miles" },
        limitations: [...limitations, "No unrestricted ID lookup. IDs outside the recent result are unavailable.",
          "Cash receipt dates differ from work-period coverage. These income views are not additive.", "Confirmation cannot prove all activity was recorded or override structural issues."] };
    },
    async get_data_quality(args: z.infer<typeof periodArgs>) {
      const data = await domain.efficiency(db, filters(args), now), settlements = await domain.settlements(db);
      return { scope: data.filters, dataQuality: data.dataQuality,
        recentSettlements: settlements.data.slice(0, 5).map((row) => ({ paymentDate: row.paymentDate,
          coverageStartDate: row.coverageStartDate, coverageEndDate: row.coverageEndDate, status: row.status,
          completenessConfirmed: row.sessionCoverage.completenessConfirmed, structurallyComplete: row.sessionCoverage.structurallyComplete, reasons: row.reasons })),
        backfillWorkflows: ["History Delivery: payout, duration, distance.", "History Session: times, total driven miles, explicit links, strategy; review pending associations.",
          "History Vehicle Settings: observed tire life/depreciation only if known.", "History Payment: official coverage dates and manual completeness confirmation after review."],
        limitations: [...limitations, "Recent settlement quality has its own coverage scope, independent of the selected calendar period."] };
    }
  };
  async function execute<K extends ToolName>(name: K, args: unknown, signal?: AbortSignal): Promise<Awaited<ReturnType<typeof handlers[K]>>> {
    if (!Object.hasOwn(schemas, name)) throw new AnalystError("unknown_tool");
    const parsed = schemas[name].safeParse(args);
    if (!parsed.success) throw new AnalystError("invalid_tool_arguments");
    if (name === "get_annual_uber_summary" && (parsed.data as z.infer<typeof annualArgs>).years.some((year) => !completedYearSchema(now).safeParse(year).success)) throw new AnalystError("invalid_tool_arguments");
    if (name !== "get_annual_uber_summary" && name !== "get_settlement_efficiency") {
      const input = parsed.data as z.infer<typeof periodArgs>;
      // Validate temporal combinations before entering the read coordinator.
      try { filters(input); } catch { throw new AnalystError("invalid_tool_arguments"); }
      if (input.asOf !== null && input.asOf < "2026-01-01") throw new AnalystError("invalid_tool_arguments");
    }
    // Name/schema pairing is validated above; the allowlist never accepts query expressions.
    const handler = handlers[name] as (input: typeof parsed.data) => ReturnType<typeof handlers[K]>;
    return coordinate(async () => {
      if (signal?.aborted) throw new AnalystError("timeout_or_cancelled", 503);
      return projectAggregate(await handler(parsed.data));
    }) as Promise<Awaited<ReturnType<typeof handlers[K]>>>;
  }
  const dateParts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => dateParts.find((item) => item.type === name)!.value;
  return { execute, definitions: toolDefinitions, currentDate: `${part("year")}-${part("month")}-${part("day")}` };
}
export type ToolRegistry = ReturnType<typeof createToolRegistry>;
