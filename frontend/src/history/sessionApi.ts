import { ApiError, requestJson, type DeliveryPage } from "./api";

export type DeliveryStrategy = "wide_area_marathon" | "home_based_multi_order" | "eastvale_local_only" | "other";
export const strategies: { value: DeliveryStrategy; label: string }[] = [
  { value: "wide_area_marathon", label: "Wide-Area Marathon" },
  { value: "home_based_multi_order", label: "Home-Based Multi-Order" },
  { value: "eastvale_local_only", label: "Eastvale Local-Only" },
  { value: "other", label: "Other" }
];
export interface VehicleCost {
  totalDrivenMiles: number | null;
  rates: { energy: number | null; tireWear: number | null; depreciation: number | null };
  amounts: { energy: number | null; tireWear: number | null; depreciation: number | null };
  missingComponents: string[];
  knownAndEstimatedCost: number | null;
  fullEconomicCost: number | null;
  completeness: "complete" | "partial" | "unavailable";
  basis: "current_profile";
}
export interface LinkedDelivery { id: string; merchantId: string; pickedUpAt: string }
export interface DeliverySession {
  id: string; startedAt: string; endedAt: string; sessionDurationSeconds: number;
  strategy?: DeliveryStrategy; totalDrivenMiles?: number; taxEligibleBusinessMiles?: number; notes?: string;
  deliveryIds: string[]; linkedDeliveries: LinkedDelivery[]; vehicleCost: VehicleCost;
}
export interface SessionPayload {
  startedAt: string; endedAt: string; strategy?: DeliveryStrategy | null;
  totalDrivenMiles?: number | null; taxEligibleBusinessMiles?: number | null; notes?: string | null;
  deliveryIds?: string[];
}
export interface VehicleProfile {
  vehicleName: string; energyCashCostPerMile: number; tireReplacementSetCost: number;
  expectedTireSetLifeMiles?: number; marginalDepreciationCostPerMile?: number;
}
export interface AnnualMileageInput {
  totalVehicleMiles: number; uberEatsBusinessMiles: number; realtorBusinessMiles?: number; otherBusinessMiles?: number;
  taxMethod: "standard_mileage";
}
export interface AnnualMileage extends AnnualMileageInput {
  taxYear: number; knownBusinessMiles: number; reportedBusinessMiles: number | null; businessMileageComplete: boolean;
  businessUsePercentage: number | null; standardMileage: { rate: number | null; estimatedDeduction: number | null };
}
export interface EconomicsResponse { data: VehicleProfile | null; historicalMileage: AnnualMileage[] }
export async function listSessions(signal?: AbortSignal) {
  return (await requestJson<{ data: DeliverySession[] }>("/api/delivery-sessions", { signal })).data;
}
export function saveSession(payload: SessionPayload, id?: string) {
  return requestJson<{ data: DeliverySession }>(`/api/delivery-sessions${id ? `/${id}` : ""}`, {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}
export function deleteSession(id: string) { return requestJson<void>(`/api/delivery-sessions/${id}`, { method: "DELETE" }); }
export function getEconomics(signal?: AbortSignal) { return requestJson<EconomicsResponse>("/api/vehicle-economics", { signal }); }
export function initializeEconomics() { return requestJson<EconomicsResponse>("/api/vehicle-economics/initialize", { method: "POST" }); }
export function saveVehicleProfile(payload: {
  energyCashCostPerMile: number; tireReplacementSetCost: number;
  expectedTireSetLifeMiles?: number | null; marginalDepreciationCostPerMile?: number | null;
}) {
  return requestJson<EconomicsResponse>("/api/vehicle-economics", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
export function saveAnnualMileage(year: number, payload: AnnualMileageInput) {
  return requestJson<{ data: AnnualMileage }>(`/api/vehicle-mileage/${year}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
export function listSessionCandidates(start: string, end: string, page: number, signal?: AbortSignal) {
  const query = new URLSearchParams({ from: start, to: end, page: String(page), pageSize: "20", sort: "newest" });
  return requestJson<DeliveryPage>(`/api/deliveries?${query}`, { signal });
}
export function sessionError(error: unknown) {
  if (error instanceof ApiError && error.status === 409) return "A selected delivery already belongs to another session. Refresh the available deliveries and try again.";
  if (error instanceof ApiError && error.status === 422) return "A selected delivery is unavailable. Review the links and try again.";
  if (error instanceof ApiError && error.status === 400) return "Some session or vehicle fields were rejected. Review the values and try again.";
  if (error instanceof ApiError && error.status === 404) return "This record is unavailable. Refresh History and try again.";
  return "Could not save or load sessions and vehicle data. Try again.";
}
export function usd(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
