import { requestJson } from "./api";

export interface SettlementDetails {
  engagedSeconds?: number;
  engagedMiles?: number;
  eligibleEarningsExcludingTips?: number;
  reportedGuaranteedAmount?: number;
}
export interface Reconciliation {
  method: "reported_guarantee";
  status: "insufficient_data" | "matched" | "mismatch";
  receivedAdjustment: number;
  expectedAdjustment: number | null;
  difference: number | null;
  tolerance: number;
}
export interface EarningsAdjustment {
  id: string;
  type: "prop22_guarantee";
  paymentDate: string;
  amount: number;
  coverageStartDate?: string;
  coverageEndDate?: string;
  sessionCoverageConfirmed?: boolean;
  notes?: string;
  settlementDetails?: SettlementDetails;
}
export type PaymentPayload = Omit<EarningsAdjustment, "id" | "coverageStartDate" | "coverageEndDate" | "notes" | "settlementDetails"> & {
  settlementDetails?: { [K in keyof SettlementDetails]?: number | null } | null;
  coverageStartDate?: string | null; coverageEndDate?: string | null; notes?: string | null;
};
export async function listPayments(signal?: AbortSignal) {
  return (await requestJson<{ data: EarningsAdjustment[] }>("/api/earnings-adjustments", { signal })).data;
}
export function getPayment(id: string, signal?: AbortSignal) {
  return requestJson<{ data: EarningsAdjustment; reconciliation: Reconciliation }>(`/api/earnings-adjustments/${id}`, { signal });
}
export async function savePayment(payload: PaymentPayload, id?: string) {
  return requestJson<{ data: EarningsAdjustment; reconciliation: Reconciliation }>(`/api/earnings-adjustments${id ? `/${id}` : ""}`, {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}
export function deletePayment(id: string) {
  return requestJson<void>(`/api/earnings-adjustments/${id}`, { method: "DELETE" });
}
export function paymentError() { return "Could not save or load the payment. Review the fields and try again."; }
