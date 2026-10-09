import { z } from "zod";
import { AnalystError } from "./types.js";

// Aggregate-only boundary, independent of MongoDB record DTOs. Unknown keys are
// stripped at every depth; textual values must be domain enums or ISO dates.
// Thus notes, IDs, map data and injected free text cannot enter provider context.
const keys = new Set(`scope period category range start endExclusive startDate endDate timeZone basis summary totalDeliveries uniqueMerchants totalEarnings value deliveryEarnings prop22Earnings sampleCount prop22PaymentCount units earnings counts revenueAndCost hourlyRates mileageRates time distance metrics deliveryCount knownPayoutTotal payoutPerRecordedHour payoutPerRecordedMile unit excludedCount reasons categoryScope selection profitBasis sessionCount linkedDeliveryCount missingPayoutCount incompleteSessionCount durationHours totalMiles payoutPerSessionHour payoutPerSessionMile vehicleCost knownAndEstimatedCost fullEconomicCost estimatedEconomicProfit estimatedEconomicProfitPerHour estimatedEconomicProfitPerMile dataQuality deliveriesMissingPayout deliveriesMissingRecordedDuration deliveriesMissingDistance deliveriesWithoutSessionAssociation sessionsMissingTotalMiles sessionsWithoutLinkedDeliveries sessionsWithIncompleteVehicleCost sessionsWithMissingLinkedPayout sessionsExcludedBoundaryCrossing unclassifiedSessions sessionsWithIncompleteAssociations strategies strategy status settlements paymentDate coverageStartDate coverageEndDate actualAdjustment deliveryRevenue knownTotal knownPayoutCount sessionCoverage includedSessionCount excludedBoundarySessionCount totalHours completenessConfirmed structurallyComplete issues knownAndEstimatedTotal fullTotal componentTotals energy tireWear depreciation completeSessionCount workPeriodRevenue adjustedEarningsPerHour adjustedEarningsPerMile recentResultLimit totalSettlements hasMore recentSettlements`.split(" "));
const strings = new Set(`week month year all restaurant grocery retail other America/Los_Angeles cash_basis all_categories_settlement_coverage settlement_coverage_period current_profile whole_interval pre_tax_excluding_unallocated_prop22 wide_area_marathon home_based_multi_order eastvale_local_only unclassified available ready partial unavailable USD USD/hour USD/mile hours miles records`.split(" "));
const reasons = new Set(`no_records numeric_result_unavailable missing_or_invalid_payout requires_known_payout_and_positive_recorded_duration requires_known_payout_and_positive_delivery_distance incomplete_session_associations no_linked_deliveries missing_linked_payout invalid_session_duration missing_session_miles incomplete_vehicle_cost requires_complete_linked_payout_and_valid_session_duration requires_complete_linked_payout_and_positive_session_miles missing_coverage_dates unconfirmed_session_coverage overlapping_settlements session_crosses_coverage_boundary missing_session_duration missing_delivery_payout unlinked_delivery missing_linked_session covered_delivery_session_outside_coverage session_without_linked_deliveries linked_delivery_outside_coverage linked_delivery_outside_session missing_linked_delivery_payout missing_session_mileage overlapping_sessions no_recorded_activity zero_session_mileage_denominator`.split(" "));

export function projectAggregate<T>(data: T): T {
  function project(value: unknown, key = "", depth = 0): unknown {
    if (depth === 1 && (key === "limitations" || key === "backfillWorkflows")) return value; // Server-authored constants only.
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const valid = key === "reasons" || key === "issues" ? reasons.has(value)
        : ["paymentDate", "coverageStartDate", "coverageEndDate", "startDate", "endDate"].includes(key) ? z.iso.date().safeParse(value).success
        : ["start", "endExclusive"].includes(key) ? z.iso.datetime().safeParse(value).success : strings.has(value);
      if (valid) return value;
      throw new AnalystError("invalid_tool_result", 503);
    }
    if (Array.isArray(value)) return value.map((item) => project(item, key, depth + 1));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
      .filter(([name]) => keys.has(name) || (depth === 0 && ["limitations", "backfillWorkflows"].includes(name)))
      .map(([name, item]) => [name, project(item, name, depth + 1)]));
    throw new AnalystError("invalid_tool_result", 503);
  }
  return project(data) as T;
}
