import type { Db } from "mongodb";
import type { VehicleEconomicsProfile, VehicleProfileDocument, VehicleTaxYearDocument, VehicleTaxYearRecord } from "./sessionModel.js";

export const initialVehicleProfile: VehicleEconomicsProfile = {
  vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 1600
};
// User-confirmed annual observations; no inferred delivery/session history.
export const initialAnnualMileage: VehicleTaxYearRecord[] = [
  { taxYear: 2024, totalVehicleMiles: 13350, uberEatsBusinessMiles: 5737, realtorBusinessMiles: 0, otherBusinessMiles: 0, taxMethod: "standard_mileage" },
  { taxYear: 2025, totalVehicleMiles: 11549, uberEatsBusinessMiles: 2310, realtorBusinessMiles: 0, otherBusinessMiles: 0, taxMethod: "standard_mileage" }
];
export async function initializeVehicleEconomics(db: Db): Promise<void> {
  await db.collection<VehicleProfileDocument>("vehicleEconomics").updateOne({ _id: "primary" },
    { $setOnInsert: { ...initialVehicleProfile } }, { upsert: true });
  for (const record of initialAnnualMileage) {
    await db.collection<VehicleTaxYearDocument>("vehicleTaxYears").updateOne({ _id: record.taxYear },
      { $setOnInsert: record }, { upsert: true });
  }
}
const money = (value: number) => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER / 100
  ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
const finite = (value: number) => Number.isFinite(value) && value >= 0 ? value : null;
export function calculateVehicleCost(profile: VehicleEconomicsProfile | null, totalDrivenMiles?: number) {
  const rates = {
    energy: profile ? finite(profile.energyCashCostPerMile) : null,
    tireWear: profile?.expectedTireSetLifeMiles === undefined || profile.expectedTireSetLifeMiles <= 0 ? null
      : finite(profile.tireReplacementSetCost / profile.expectedTireSetLifeMiles),
    depreciation: profile?.marginalDepreciationCostPerMile === undefined ? null : finite(profile.marginalDepreciationCostPerMile)
  };
  const hasMiles = totalDrivenMiles !== undefined && Number.isFinite(totalDrivenMiles) && totalDrivenMiles >= 0;
  const amounts = { energy: null as number | null, tireWear: null as number | null, depreciation: null as number | null };
  const raw: number[] = [];
  for (const key of ["energy", "tireWear", "depreciation"] as const) {
    if (hasMiles && rates[key] !== null) {
      const value = finite(totalDrivenMiles! * rates[key]);
      if (value !== null && Number.isFinite(value * 100)) { amounts[key] = money(value); raw.push(value); }
    }
  }
  const missingComponents = (Object.keys(amounts) as (keyof typeof amounts)[]).filter((key) => amounts[key] === null);
  const subtotal = raw.length ? finite(raw.reduce((sum, value) => sum + value, 0)) : null;
  const knownAndEstimatedCost = subtotal === null || !Number.isFinite(subtotal * 100) ? null : money(subtotal);
  const fullEconomicCost = !missingComponents.length ? knownAndEstimatedCost : null;
  const completeness = fullEconomicCost !== null ? "complete" : knownAndEstimatedCost !== null ? "partial" : "unavailable";
  return { totalDrivenMiles: hasMiles ? totalDrivenMiles! : null, rates, amounts, missingComponents,
    knownAndEstimatedCost, fullEconomicCost, completeness,
    basis: "current_profile" as const };
}

// Effective-year-specific historical rates only. No carry-forward to later years.
// IRS Notice 2024-08: https://www.irs.gov/irb/2024-02_IRB
// IRS Notice 2025-05: https://www.irs.gov/pub/irs-drop/n-25-05.pdf
const historicalRates: Record<number, number> = { 2024: 0.67, 2025: 0.70 };
export function annualMileageResponse({ _id: _unused, ...record }: VehicleTaxYearDocument) {
  const knownBusinessMiles = record.uberEatsBusinessMiles + (record.realtorBusinessMiles ?? 0) + (record.otherBusinessMiles ?? 0);
  const businessMileageComplete = record.realtorBusinessMiles !== undefined && record.otherBusinessMiles !== undefined;
  const reportedBusinessMiles = businessMileageComplete ? knownBusinessMiles : null;
  const businessUsePercentage = reportedBusinessMiles === null || record.totalVehicleMiles === 0 ? null : reportedBusinessMiles / record.totalVehicleMiles * 100;
  const rate = historicalRates[record.taxYear] ?? null;
  return { ...record, knownBusinessMiles, reportedBusinessMiles, businessMileageComplete, businessUsePercentage,
    standardMileage: { rate, estimatedDeduction: rate === null || reportedBusinessMiles === null ? null : money(reportedBusinessMiles * rate) } };
}
export async function vehicleEconomicsResponse(db: Db) {
  const profile = await db.collection<VehicleProfileDocument>("vehicleEconomics").findOne({ _id: "primary" });
  const records = await db.collection<VehicleTaxYearDocument>("vehicleTaxYears").find().sort({ taxYear: -1 }).toArray();
  return { data: profile ? {
    vehicleName: profile.vehicleName, energyCashCostPerMile: profile.energyCashCostPerMile,
    tireReplacementSetCost: profile.tireReplacementSetCost,
    ...(profile.expectedTireSetLifeMiles === undefined ? {} : { expectedTireSetLifeMiles: profile.expectedTireSetLifeMiles }),
    ...(profile.marginalDepreciationCostPerMile === undefined ? {} : { marginalDepreciationCostPerMile: profile.marginalDepreciationCostPerMile })
  } : null, historicalMileage: records.map(annualMileageResponse) };
}
