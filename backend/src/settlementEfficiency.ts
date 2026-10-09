import type { Db } from "mongodb";
import { z } from "zod";
import { resolveCoverageDates } from "./dashboard.js";
import { calculateSessionEfficiency } from "./efficiency.js";
import type { DeliveryDocument, EarningsAdjustmentDocument } from "./model.js";
import type { DeliverySessionDocument, VehicleEconomicsProfile, VehicleProfileDocument } from "./sessionModel.js";

type DeliveryObservation = Pick<DeliveryDocument, "_id" | "pickedUpAt" | "sessionId" | "payout">;
const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n >= 0;
const safe = (n: number) => Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER / 100 ? n : null;
const sum = (values: number[]) => values.length ? safe(values.reduce((total, n) => total + n, 0)) : null;
function coverage(payment: EarningsAdjustmentDocument) {
  const start = payment.coverageStartDate, end = payment.coverageEndDate;
  if (!z.iso.date().safeParse(start).success || !z.iso.date().safeParse(end).success || start! > end!) return null;
  const range = resolveCoverageDates(start!, end!);
  return Number.isFinite(range.start.getTime()) && Number.isFinite(range.endExclusive.getTime()) && range.start < range.endExclusive ? range : null;
}

export function calculateSettlementEfficiency(payment: EarningsAdjustmentDocument, allPayments: EarningsAdjustmentDocument[],
  deliveries: DeliveryObservation[], sessions: DeliverySessionDocument[], profile: VehicleEconomicsProfile | null) {
  const range = coverage(payment);
  const issues = new Set<string>();
  const confirmed = payment.sessionCoverageConfirmed === true;
  if (!range) issues.add("missing_coverage_dates");
  if (!confirmed) issues.add("unconfirmed_session_coverage");
  if (range && allPayments.some((other) => {
    if (other._id.equals(payment._id)) return false;
    const interval = coverage(other);
    return interval && interval.start < range.endExclusive && interval.endExclusive > range.start;
  })) issues.add("overlapping_settlements");
  const inRange = (date: Date) => !!range && date >= range.start && date < range.endExclusive;
  const covered = deliveries.filter((row) => inRange(row.pickedUpAt));
  const included = sessions.filter((row) => range && row.startedAt >= range.start && row.endedAt <= range.endExclusive && row.endedAt > row.startedAt);
  const crossing = sessions.filter((row) => range && row.startedAt < range.endExclusive && row.endedAt > range.start &&
    (row.startedAt < range.start || row.endedAt > range.endExclusive));
  if (crossing.length) issues.add("session_crosses_coverage_boundary");
  const sessionById = new Map(sessions.map((row) => [row._id.toHexString(), row]));
  for (const row of sessions) {
    if ((inRange(row.startedAt) || inRange(row.endedAt)) && !(row.endedAt > row.startedAt)) issues.add("missing_session_duration");
  }
  const includedIds = new Set(included.map((row) => row._id.toHexString()));
  const links = new Map<string, DeliveryObservation[]>();
  for (const row of deliveries) if (row.sessionId) {
    const key = row.sessionId.toHexString(); const group = links.get(key) ?? [];
    group.push(row); links.set(key, group);
  }
  for (const row of covered) {
    if (!valid(row.payout)) issues.add("missing_delivery_payout");
    if (!row.sessionId) { issues.add("unlinked_delivery"); continue; }
    const target = sessionById.get(row.sessionId.toHexString());
    if (!target) issues.add("missing_linked_session");
    else {
      if (!includedIds.has(target._id.toHexString())) issues.add("covered_delivery_session_outside_coverage");
      if (!(target.endedAt > target.startedAt)) issues.add("missing_session_duration");
    }
  }
  for (const row of included) {
    if (row.associationIntegrity) issues.add("incomplete_session_associations");
    const linked = links.get(row._id.toHexString()) ?? [];
    if (!linked.length) issues.add("session_without_linked_deliveries");
    if (linked.some((delivery) => !inRange(delivery.pickedUpAt))) issues.add("linked_delivery_outside_coverage");
    if (linked.some((delivery) => delivery.pickedUpAt < row.startedAt || delivery.pickedUpAt >= row.endedAt)) issues.add("linked_delivery_outside_session");
    if (linked.some((delivery) => !valid(delivery.payout))) issues.add("missing_linked_delivery_payout");
    if (!valid(row.totalDrivenMiles)) issues.add("missing_session_mileage");
  }
  const ordered = [...included].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  let latestEnd = -Infinity;
  for (const row of ordered) {
    if (row.startedAt.getTime() < latestEnd) issues.add("overlapping_sessions");
    latestEnd = Math.max(latestEnd, row.endedAt.getTime());
  }
  if (!covered.length || !included.length) issues.add("no_recorded_activity");
  const known = covered.filter((row) => valid(row.payout));
  const knownTotal = sum(known.map((row) => row.payout!));
  const actualAdjustment = valid(payment.amount) ? safe(payment.amount) : null;
  const workPeriodRevenue = range && covered.length > 0 && known.length === covered.length && knownTotal !== null && actualAdjustment !== null && !issues.has("overlapping_settlements")
    ? safe(knownTotal + actualAdjustment) : null;
  if (known.length > 0 && knownTotal === null || actualAdjustment === null || knownTotal !== null && actualAdjustment !== null && safe(knownTotal + actualAdjustment) === null) issues.add("numeric_result_unavailable");
  const calculations = included.map((row) => calculateSessionEfficiency(row, links.get(row._id.toHexString()) ?? [], profile));
  const rawHours = sum(calculations.map((row) => row.durationHours!));
  const rawMiles = calculations.every((row) => row.totalMiles !== null) ? sum(calculations.map((row) => row.totalMiles!)) : null;
  if (included.length && (rawHours === null || calculations.every((row) => row.totalMiles !== null) && rawMiles === null)) issues.add("numeric_result_unavailable");
  const structurallyComplete = range !== null && [...issues].every((reason) => reason === "unconfirmed_session_coverage");
  const completeCoverage = confirmed && structurallyComplete;
  const totalHours = completeCoverage ? rawHours : null;
  const totalMiles = completeCoverage ? rawMiles : null;
  const ratio = (numerator: number | null, denominator: number | null) => numerator !== null && denominator !== null && denominator > 0 ? safe(numerator / denominator) : null;
  const adjustedEarningsPerHour = ratio(workPeriodRevenue, totalHours);
  const adjustedEarningsPerMile = ratio(workPeriodRevenue, totalMiles);
  const fullCost = calculations.length && calculations.every((row) => row.vehicleCost.fullEconomicCost !== null)
    ? sum(calculations.map((row) => row.vehicleCost.fullEconomicCost!)) : null;
  const partialCost = sum(calculations.flatMap((row) => row.vehicleCost.knownAndEstimatedCost === null ? [] : [row.vehicleCost.knownAndEstimatedCost]));
  const componentTotals = Object.fromEntries((["energy", "tireWear", "depreciation"] as const).map((key) => {
    const values = calculations.flatMap((row) => row.vehicleCost.amounts[key] === null ? [] : [row.vehicleCost.amounts[key]!]);
    return [key, { value: sum(values), sampleCount: values.length, excludedCount: calculations.length - values.length }];
  }));
  const estimatedEconomicProfit = completeCoverage && workPeriodRevenue !== null && fullCost !== null ? safe(workPeriodRevenue - fullCost) : null;
  const reasons = new Set(issues);
  if (calculations.some((row) => row.vehicleCost.completeness !== "complete")) reasons.add("incomplete_vehicle_cost");
  if (calculations.length && calculations.every((row) => row.vehicleCost.fullEconomicCost !== null) && fullCost === null) reasons.add("numeric_result_unavailable");
  const estimatedEconomicProfitPerHour = ratio(estimatedEconomicProfit, totalHours);
  const estimatedEconomicProfitPerMile = ratio(estimatedEconomicProfit, totalMiles);
  if (estimatedEconomicProfit !== null && (estimatedEconomicProfitPerHour === null || totalMiles! > 0 && estimatedEconomicProfitPerMile === null)) reasons.add("numeric_result_unavailable");
  if (totalMiles === 0) reasons.add("zero_session_mileage_denominator");
  if (completeCoverage && (adjustedEarningsPerHour === null || totalMiles! > 0 && adjustedEarningsPerMile === null || fullCost !== null && estimatedEconomicProfit === null)) reasons.add("numeric_result_unavailable");
  const status = !range || !covered.length || !included.length ? "unavailable" as const
    : completeCoverage && adjustedEarningsPerHour !== null && adjustedEarningsPerMile !== null ? "ready" as const : "partial" as const;
  return {
    settlementId: payment._id.toHexString(), paymentDate: payment.paymentDate,
    coverageStartDate: payment.coverageStartDate ?? null, coverageEndDate: payment.coverageEndDate ?? null,
    categoryScope: "all" as const, basis: "settlement_coverage_period" as const,
    range: range ? { start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString(), timeZone: range.timeZone } : null,
    actualAdjustment, deliveryRevenue: { knownTotal, deliveryCount: covered.length, knownPayoutCount: known.length, missingPayoutCount: covered.length - known.length },
    sessionCoverage: { includedSessionCount: included.length, excludedBoundarySessionCount: crossing.length,
      totalHours, totalMiles, completenessConfirmed: confirmed, structurallyComplete, issues: [...issues] },
    vehicleCost: { basis: "current_profile" as const, knownAndEstimatedTotal: partialCost, fullTotal: completeCoverage ? fullCost : null, componentTotals,
      completeSessionCount: calculations.filter((row) => row.vehicleCost.completeness === "complete").length, sessionCount: calculations.length },
    workPeriodRevenue, adjustedEarningsPerHour, adjustedEarningsPerMile, estimatedEconomicProfit,
    estimatedEconomicProfitPerHour, estimatedEconomicProfitPerMile,
    status, reasons: [...reasons]
  };
}

export class SettlementEfficiencyLimitError extends Error {}
const MAX_RECORDS = 10000;
function bounded<T>(rows: T[], maximum = MAX_RECORDS) {
  if (rows.length > maximum) throw new SettlementEfficiencyLimitError("Local settlement analysis limit exceeded");
  return rows;
}
export async function getSettlementEfficiency(db: Db) {
  // Check overlaps against every stored period, including payments outside the recent response.
  const payments = bounded(await db.collection<EarningsAdjustmentDocument>("earningsAdjustments").find({ type: "prop22_guarantee" },
    { projection: { _id: 1, paymentDate: 1, amount: 1, coverageStartDate: 1, coverageEndDate: 1, sessionCoverageConfirmed: 1 } })
    .sort({ paymentDate: -1, _id: -1 }).limit(1001).toArray(), 1000);
  const recent = payments.slice(0, 20);
  const ranges = recent.flatMap((row) => { const range = coverage(row); return range ? [range] : []; });
  const profile = await db.collection<VehicleProfileDocument>("vehicleEconomics").findOne({ _id: "primary" });
  let deliveries: DeliveryObservation[] = [], sessions: DeliverySessionDocument[] = [];
  if (ranges.length) {
    const start = new Date(Math.min(...ranges.map((row) => row.start.getTime())));
    const end = new Date(Math.max(...ranges.map((row) => row.endExclusive.getTime())));
    const projection = { _id: 1, pickedUpAt: 1, sessionId: 1, payout: 1 };
    deliveries = bounded(await db.collection<DeliveryDocument>("deliveries").find({ pickedUpAt: { $gte: start, $lt: end } }, { projection }).limit(MAX_RECORDS + 1).toArray());
    const sessionIds = deliveries.flatMap((row) => row.sessionId ? [row.sessionId] : []);
    sessions = bounded(await db.collection<DeliverySessionDocument>("deliverySessions").find({ $or: [
      { startedAt: { $lt: end }, endedAt: { $gt: start } },
      { startedAt: { $gte: start, $lt: end } }, { endedAt: { $gt: start, $lte: end } }, { _id: { $in: sessionIds } }
    ] }, { projection: { _id: 1, startedAt: 1, endedAt: 1, totalDrivenMiles: 1, associationIntegrity: 1 } }).limit(MAX_RECORDS + 1).toArray());
    const linked = bounded(await db.collection<DeliveryDocument>("deliveries").find({ sessionId: { $in: sessions.map((row) => row._id) } }, { projection }).limit(MAX_RECORDS + 1).toArray());
    deliveries = bounded([...new Map([...deliveries, ...linked].map((row) => [row._id.toHexString(), row])).values()]);
  }
  return { data: recent.map((row) => calculateSettlementEfficiency(row, payments, deliveries, sessions, profile)),
    limit: 20, totalSettlements: payments.length, hasMore: payments.length > 20 };
}
