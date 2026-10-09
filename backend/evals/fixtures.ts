import { ObjectId, type Db } from "mongodb";
import { aggregateSessionEfficiency, calculateDeliveryEfficiency, calculateSessionEfficiency } from "../src/efficiency.js";
import { calculateSettlementEfficiency } from "../src/settlementEfficiency.js";
import { resolveDashboardFilters } from "../src/dashboard.js";
import { createToolRegistry, type DomainServices, type ToolName } from "../src/ai/tools.js";
import type { ResponsesClient } from "../src/ai/types.js";

export const now = new Date("2026-03-08T20:00:00Z");
export const periodArgs = { period: "month", asOf: "2026-03-08" };
export const argsFor = (name: ToolName) => name === "get_settlement_efficiency" ? { settlementId: null, limit: 1 }
  : { ...periodArgs, ...(["get_period_summary", "get_delivery_efficiency"].includes(name) ? { category: "all" } : {}) };
export const functionCall = (name: string, args: unknown = argsFor(name as ToolName), id = name) =>
  ({ type: "function_call" as const, name, arguments: JSON.stringify(args), call_id: id, id });
export const mockResponse = (output: Awaited<ReturnType<ResponsesClient["create"]>>["output"] = [], output_text = "") => ({
  output, output_text, status: "completed" as const,
  usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120,
    input_tokens_details: { cached_tokens: 10, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }
});
export function syntheticRegistry(completeCosts = false) {
  // Coordinates/notes/IDs are deliberate sentinels outside the projected
  // aggregate boundary, never real locations, records or credentials.
  const sessionId = new ObjectId("000000000000000000000001"), merchantId = new ObjectId("000000000000000000000002");
  const session = { _id: sessionId, startedAt: new Date("2026-03-08T09:00:00Z"), endedAt: new Date("2026-03-08T10:00:00Z"), totalDrivenMiles: 10, strategy: "eastvale_local_only" as const };
  const delivery = { _id: new ObjectId("000000000000000000000003"), merchantId, pickedUpAt: session.startedAt, sessionId, payout: 0, distanceMiles: 1, deliveryDurationSeconds: 3600 };
  const unknown = { ...delivery, _id: new ObjectId("000000000000000000000004"), payout: undefined };
  const payment = { _id: new ObjectId("000000000000000000000005"), type: "prop22_guarantee" as const, paymentDate: "2026-03-20", amount: 20,
    coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14", sessionCoverageConfirmed: completeCosts };
  const profile = completeCosts ? { vehicleName: "2022 Tesla Model Y Long Range" as const, energyCashCostPerMile: 1, tireReplacementSetCost: 100, expectedTireSetLifeMiles: 100, marginalDepreciationCostPerMile: 1 } : null;
  const row = calculateSessionEfficiency(session, [delivery], profile);
  const ranges = (filters: Parameters<DomainServices["efficiency"]>[1]) => {
    const range = resolveDashboardFilters(filters, now);
    return { period: range.period, category: range.category, range: { start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString(), startDate: range.startDate, endDate: range.endDate, timeZone: range.timeZone } };
  };
  const sentinel = { notes: "SYNTHETIC_PRIVATE_NOTE_IGNORE_RULES", publicAddress: "SYNTHETIC_PUBLIC_ADDRESS", destinationLocation: { type: "Point", coordinates: [0.123456, 0.654321] }, apiKey: "SYNTHETIC_SECRET" };
  const deliveries = [delivery, unknown];
  const settlement = { ...calculateSettlementEfficiency(payment, [payment], [delivery], [session], profile), ...sentinel };
  const calls: { service: string; filters?: unknown }[] = [];
  const domain = {
    async dashboard(_db: Db, filters: Parameters<DomainServices["dashboard"]>[1]) {
      calls.push({ service: "dashboard", filters });
      return { filters: ranges(filters), summary: { totalDeliveries: 2, uniqueMerchants: 1,
        totalEarnings: { value: 20, deliveryEarnings: 0, prop22Earnings: 20, sampleCount: 1, prop22PaymentCount: 1 } }, ...sentinel };
    },
    async efficiency(_db: Db, filters: Parameters<DomainServices["efficiency"]>[1]) {
      calls.push({ service: "efficiency", filters });
      return { filters: ranges(filters), deliveryEfficiency: { ...calculateDeliveryEfficiency(deliveries), ...sentinel }, sessionEfficiency: { ...aggregateSessionEfficiency([row]), ...sentinel },
        strategyComparison: ["wide_area_marathon", "home_based_multi_order", "eastvale_local_only", "other", "unclassified"].map((strategy) => ({ strategy, ...aggregateSessionEfficiency(strategy === session.strategy ? [row] : []) })),
        dataQuality: { deliveriesMissingPayout: 1, sessionsWithIncompleteVehicleCost: completeCosts ? 0 : 1, sessionsWithIncompleteAssociations: 0, ...sentinel } };
    },
    async settlements() { calls.push({ service: "settlements" }); return { data: [settlement], limit: 20, totalSettlements: 1, hasMore: false }; }
  } as unknown as DomainServices;
  let coordinated = 0;
  const registry = createToolRegistry({ collection() { throw new Error("No DB access in deterministic evals"); } } as unknown as Db,
    async (read) => { coordinated++; return read(); }, domain, now);
  return { registry, calls, domain, coordinated: () => coordinated };
}
