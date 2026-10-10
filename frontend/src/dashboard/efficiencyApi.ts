import { dashboardQuery, type Category, type DashboardData, type Period } from "./api";

export interface EfficiencyMetric {
  value: number | null;
  unit: "USD" | "USD/hour" | "USD/mile" | "hours" | "miles";
  sampleCount: number;
  excludedCount: number;
  reasons: string[];
}
export interface SessionEfficiency {
  categoryScope: "all";
  sessionCount: number;
  linkedDeliveryCount: number;
  missingPayoutCount: number;
  incompleteSessionCount: number;
  knownPayoutTotal: EfficiencyMetric;
  durationHours: EfficiencyMetric;
  totalMiles: EfficiencyMetric;
  payoutPerSessionHour: EfficiencyMetric;
  payoutPerSessionMile: EfficiencyMetric;
  vehicleCost: { basis: "current_profile"; knownAndEstimatedCost: EfficiencyMetric; fullEconomicCost: EfficiencyMetric };
  estimatedEconomicProfit: EfficiencyMetric;
  estimatedEconomicProfitPerHour: EfficiencyMetric;
}
export interface EfficiencyData {
  filters: DashboardData["filters"];
  deliveryEfficiency: { deliveryCount: number; knownPayoutTotal: EfficiencyMetric; payoutPerRecordedHour: EfficiencyMetric; payoutPerRecordedMile: EfficiencyMetric };
  sessionEfficiency: SessionEfficiency;
  strategyComparison: (SessionEfficiency & { strategy: string })[];
  dataQuality: Record<string, number>;
}
export async function loadEfficiency(period: Period, category: Category, signal?: AbortSignal, year?: number): Promise<EfficiencyData> {
  const response = await fetch(`/api/efficiency?${dashboardQuery(period, category, year)}`, { signal });
  if (!response.ok) throw new Error("Efficiency analytics are unavailable. Try again.");
  return response.json() as Promise<EfficiencyData>;
}
