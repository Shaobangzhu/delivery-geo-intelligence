import type { Db } from "mongodb";
import { resolveDashboardFilters, type DashboardFilters } from "./dashboard.js";
import type { DeliveryDocument, MerchantDocument } from "./model.js";
import { strategySchema, type DeliverySessionDocument, type VehicleEconomicsProfile, type VehicleProfileDocument } from "./sessionModel.js";
import { calculateVehicleCost } from "./vehicleEconomics.js";

export interface EfficiencyMetric {
  value: number | null;
  unit: "USD" | "USD/hour" | "USD/mile" | "hours" | "miles";
  sampleCount: number;
  excludedCount: number;
  reasons: string[];
}
const nonnegative = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value) && value >= 0;
const positive = (value: number | undefined): value is number => nonnegative(value) && value > 0;
const finite = (value: number): number | null => Number.isFinite(value) ? value : null;
const sum = (values: number[]) => values.length ? finite(values.reduce((total, value) => total + value, 0)) : null;
function metric(value: number | null, unit: EfficiencyMetric["unit"], sampleCount: number, total: number, reasons: string[] = []): EfficiencyMetric {
  return { value, unit, sampleCount, excludedCount: total - sampleCount,
    reasons: [...new Set([...reasons, ...(total === 0 ? ["no_records"] : []), ...(value === null && sampleCount > 0 ? ["numeric_result_unavailable"] : [])])] };
}
function rate(numerators: number[], denominators: number[], unit: "USD/hour" | "USD/mile", total: number, reasons: string[]) {
  const numerator = sum(numerators), denominator = sum(denominators);
  return metric(numerator !== null && denominator !== null && denominator > 0 ? finite(numerator / denominator) : null,
    unit, numerators.length, total, reasons);
}

type DeliveryInputs = Pick<DeliveryDocument, "payout" | "distanceMiles" | "deliveryDurationSeconds" | "sessionId">;
export function calculateDeliveryEfficiency(rows: DeliveryInputs[]) {
  const hourly = rows.filter((row) => nonnegative(row.payout) && positive(row.deliveryDurationSeconds));
  const mileage = rows.filter((row) => nonnegative(row.payout) && positive(row.distanceMiles));
  const known = rows.filter((row) => nonnegative(row.payout));
  return {
    deliveryCount: rows.length,
    knownPayoutTotal: metric(sum(known.map((row) => row.payout!)), "USD", known.length, rows.length,
      known.length < rows.length ? ["missing_or_invalid_payout"] : []),
    payoutPerRecordedHour: rate(hourly.map((row) => row.payout!), hourly.map((row) => row.deliveryDurationSeconds! / 3600), "USD/hour", rows.length,
      hourly.length < rows.length ? ["requires_known_payout_and_positive_recorded_duration"] : []),
    payoutPerRecordedMile: rate(mileage.map((row) => row.payout!), mileage.map((row) => row.distanceMiles!), "USD/mile", rows.length,
      mileage.length < rows.length ? ["requires_known_payout_and_positive_delivery_distance"] : [])
  };
}

export function calculateSessionEfficiency(session: DeliverySessionDocument, linked: DeliveryInputs[], profile: VehicleEconomicsProfile | null) {
  const known = linked.filter((row) => nonnegative(row.payout));
  const knownPayoutTotal = sum(known.map((row) => row.payout!));
  const seconds = (session.endedAt.getTime() - session.startedAt.getTime()) / 1000;
  const durationHours = positive(seconds) ? finite(seconds / 3600) : null;
  const totalMiles = nonnegative(session.totalDrivenMiles) ? session.totalDrivenMiles : null;
  const vehicleCost = calculateVehicleCost(profile, session.totalDrivenMiles);
  const revenueComplete = linked.length > 0 && known.length === linked.length && knownPayoutTotal !== null;
  const reasons = [
    ...(linked.length === 0 ? ["no_linked_deliveries"] : []),
    ...(known.length < linked.length ? ["missing_linked_payout"] : []),
    ...(durationHours === null ? ["invalid_session_duration"] : []),
    ...(totalMiles === null ? ["missing_session_miles"] : []),
    ...(vehicleCost.completeness !== "complete" ? ["incomplete_vehicle_cost"] : []),
    ...(known.length > 0 && knownPayoutTotal === null ? ["numeric_result_unavailable"] : [])
  ];
  const estimatedEconomicProfit = revenueComplete && durationHours !== null && totalMiles !== null && vehicleCost.fullEconomicCost !== null
    ? finite(knownPayoutTotal! - vehicleCost.fullEconomicCost) : null;
  return { strategy: session.strategy ?? "unclassified", linkedDeliveryCount: linked.length, knownPayoutCount: known.length,
    missingPayoutCount: linked.length - known.length, knownPayoutTotal, revenueComplete, durationHours, totalMiles,
    payoutPerSessionHour: revenueComplete && durationHours !== null && durationHours > 0 ? finite(knownPayoutTotal! / durationHours) : null,
    payoutPerSessionMile: revenueComplete && totalMiles !== null && totalMiles > 0 ? finite(knownPayoutTotal! / totalMiles) : null,
    estimatedEconomicProfitPerHour: estimatedEconomicProfit !== null && durationHours !== null && durationHours > 0 ? finite(estimatedEconomicProfit / durationHours) : null,
    vehicleCost, estimatedEconomicProfit, reasons };
}
type SessionCalculation = ReturnType<typeof calculateSessionEfficiency>;
export function aggregateSessionEfficiency(rows: SessionCalculation[]) {
  const reasons = rows.flatMap((row) => row.reasons);
  const hourly = rows.filter((row) => row.revenueComplete && row.durationHours !== null);
  const mileage = rows.filter((row) => row.revenueComplete && row.totalMiles !== null && row.totalMiles > 0);
  const profit = rows.filter((row) => row.estimatedEconomicProfit !== null);
  const durations = rows.filter((row) => row.durationHours !== null);
  const miles = rows.filter((row) => row.totalMiles !== null);
  const partialCost = rows.filter((row) => row.vehicleCost.knownAndEstimatedCost !== null);
  const completeCost = rows.filter((row) => row.vehicleCost.fullEconomicCost !== null);
  const known = rows.filter((row) => row.knownPayoutTotal !== null);
  const total = rows.length;
  return {
    categoryScope: "all" as const, selection: "whole_interval" as const,
    profitBasis: "pre_tax_excluding_unallocated_prop22" as const, sessionCount: total,
    linkedDeliveryCount: rows.reduce((n, row) => n + row.linkedDeliveryCount, 0),
    missingPayoutCount: rows.reduce((n, row) => n + row.missingPayoutCount, 0),
    incompleteSessionCount: rows.filter((row) => row.estimatedEconomicProfit === null).length,
    knownPayoutTotal: metric(sum(known.map((row) => row.knownPayoutTotal!)), "USD", known.length, total,
      reasons.filter((reason) => ["missing_linked_payout", "no_linked_deliveries", "numeric_result_unavailable"].includes(reason))),
    durationHours: metric(sum(durations.map((row) => row.durationHours!)), "hours", durations.length, total, durations.length < total ? ["invalid_session_duration"] : []),
    totalMiles: metric(sum(miles.map((row) => row.totalMiles!)), "miles", miles.length, total, miles.length < total ? ["missing_session_miles"] : []),
    payoutPerSessionHour: rate(hourly.map((row) => row.knownPayoutTotal!), hourly.map((row) => row.durationHours!), "USD/hour", total,
      hourly.length < total ? ["requires_complete_linked_payout_and_valid_session_duration"] : []),
    payoutPerSessionMile: rate(mileage.map((row) => row.knownPayoutTotal!), mileage.map((row) => row.totalMiles!), "USD/mile", total,
      mileage.length < total ? ["requires_complete_linked_payout_and_positive_session_miles"] : []),
    vehicleCost: {
      basis: "current_profile" as const,
      knownAndEstimatedCost: metric(sum(partialCost.map((row) => row.vehicleCost.knownAndEstimatedCost!)), "USD", partialCost.length, total,
        completeCost.length < total ? ["incomplete_vehicle_cost"] : []),
      fullEconomicCost: metric(sum(completeCost.map((row) => row.vehicleCost.fullEconomicCost!)), "USD", completeCost.length, total,
        completeCost.length < total ? ["incomplete_vehicle_cost"] : [])
    },
    estimatedEconomicProfit: metric(sum(profit.map((row) => row.estimatedEconomicProfit!)), "USD", profit.length, total, reasons),
    estimatedEconomicProfitPerHour: rate(profit.map((row) => row.estimatedEconomicProfit!), profit.map((row) => row.durationHours!), "USD/hour", total, reasons)
  };
}

export function selectPeriodSessions(rows: DeliverySessionDocument[], start: Date, endExclusive: Date) {
  const overlapping = rows.filter((row) => row.startedAt < endExclusive && row.endedAt > start);
  const included = overlapping.filter((row) => row.startedAt >= start && row.endedAt <= endExclusive && row.endedAt > row.startedAt);
  return { included, excludedBoundaryCrossingCount: overlapping.filter((row) => row.startedAt < start || row.endedAt > endExclusive).length };
}

export async function getEfficiencyAnalytics(db: Db, filters: DashboardFilters, now = new Date()) {
  const range = resolveDashboardFilters(filters, now);
  const merchants = await db.collection<MerchantDocument>("merchants").find(filters.category === "all" ? {} : { category: filters.category }, { projection: { _id: 1 } }).toArray();
  const projection = { _id: 0, sessionId: 1, payout: 1, distanceMiles: 1, deliveryDurationSeconds: 1 };
  const [deliveries, overlapping, profile] = await Promise.all([
    db.collection<DeliveryDocument>("deliveries").find({ pickedUpAt: { $gte: range.start, $lt: range.endExclusive }, merchantId: { $in: merchants.map((row) => row._id) } }, { projection }).toArray(),
    db.collection<DeliverySessionDocument>("deliverySessions").find({ startedAt: { $lt: range.endExclusive }, endedAt: { $gt: range.start } },
      { projection: { _id: 1, startedAt: 1, endedAt: 1, strategy: 1, totalDrivenMiles: 1 } }).toArray(),
    db.collection<VehicleProfileDocument>("vehicleEconomics").findOne({ _id: "primary" })
  ]);
  const { included, excludedBoundaryCrossingCount } = selectPeriodSessions(overlapping, range.start, range.endExclusive);
  const linked = await db.collection<DeliveryDocument>("deliveries").find({ sessionId: { $in: included.map((row) => row._id) } }, { projection }).toArray();
  const bySession = new Map<string, DeliveryDocument[]>();
  for (const row of linked) {
    const key = row.sessionId!.toHexString();
    const group = bySession.get(key) ?? []; group.push(row); bySession.set(key, group);
  }
  const sessions = included.map((row) => calculateSessionEfficiency(row, bySession.get(row._id.toHexString()) ?? [], profile));
  return {
    filters: { period: range.period, category: range.category, range: { start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString(), startDate: range.startDate, endDate: range.endDate, timeZone: range.timeZone } },
    deliveryEfficiency: calculateDeliveryEfficiency(deliveries),
    sessionEfficiency: aggregateSessionEfficiency(sessions),
    strategyComparison: [...strategySchema.options, "unclassified"].map((strategy) => ({ strategy,
      ...aggregateSessionEfficiency(sessions.filter((row) => row.strategy === strategy)) })),
    dataQuality: {
      deliveriesMissingPayout: deliveries.filter((row) => row.payout === undefined).length,
      deliveriesMissingRecordedDuration: deliveries.filter((row) => row.deliveryDurationSeconds === undefined).length,
      deliveriesMissingDistance: deliveries.filter((row) => row.distanceMiles === undefined).length,
      deliveriesWithoutSessionAssociation: deliveries.filter((row) => row.sessionId === undefined).length,
      sessionsMissingTotalMiles: sessions.filter((row) => row.totalMiles === null).length,
      sessionsWithoutLinkedDeliveries: sessions.filter((row) => row.linkedDeliveryCount === 0).length,
      sessionsWithIncompleteVehicleCost: sessions.filter((row) => row.vehicleCost.completeness !== "complete").length,
      sessionsWithMissingLinkedPayout: sessions.filter((row) => row.missingPayoutCount > 0).length,
      sessionsExcludedBoundaryCrossing: excludedBoundaryCrossingCount,
      unclassifiedSessions: sessions.filter((row) => row.strategy === "unclassified").length
    }
  };
}
