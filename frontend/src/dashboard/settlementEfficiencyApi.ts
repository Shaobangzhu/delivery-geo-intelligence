export interface SettlementEfficiency {
  settlementId: string; paymentDate: string; coverageStartDate: string | null; coverageEndDate: string | null;
  actualAdjustment: number | null;
  deliveryRevenue: { knownTotal: number | null; deliveryCount: number; knownPayoutCount: number; missingPayoutCount: number };
  sessionCoverage: { includedSessionCount: number; excludedBoundarySessionCount: number; totalHours: number | null; totalMiles: number | null; completenessConfirmed: boolean; structurallyComplete: boolean; issues: string[] };
  vehicleCost: { basis: "current_profile"; knownAndEstimatedTotal: number | null; fullTotal: number | null;
    componentTotals: Record<"energy" | "tireWear" | "depreciation", { value: number | null; sampleCount: number; excludedCount: number }>;
    completeSessionCount: number; sessionCount: number };
  workPeriodRevenue: number | null; adjustedEarningsPerHour: number | null; adjustedEarningsPerMile: number | null;
  estimatedEconomicProfit: number | null; estimatedEconomicProfitPerHour: number | null; estimatedEconomicProfitPerMile: number | null;
  status: "ready" | "partial" | "unavailable"; reasons: string[];
}
export interface SettlementEfficiencyPage { data: SettlementEfficiency[]; limit: number; totalSettlements: number; hasMore: boolean }
export async function loadSettlementEfficiency(signal?: AbortSignal): Promise<SettlementEfficiencyPage> {
  const response = await fetch("/api/efficiency/settlements", { signal });
  if (!response.ok) throw new Error("Settlement efficiency is unavailable. Try again.");
  return response.json() as Promise<SettlementEfficiencyPage>;
}
