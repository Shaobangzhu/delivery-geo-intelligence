import { requestJson } from "./api";

export interface EarningsAdjustment {
  id: string;
  type: "prop22_guarantee";
  paymentDate: string;
  amount: number;
  coverageStartDate?: string;
  coverageEndDate?: string;
  notes?: string;
}
export type PaymentPayload = Omit<EarningsAdjustment, "id" | "coverageStartDate" | "coverageEndDate" | "notes"> & {
  coverageStartDate?: string | null; coverageEndDate?: string | null; notes?: string | null;
};
export async function listPayments(signal?: AbortSignal) {
  return (await requestJson<{ data: EarningsAdjustment[] }>("/api/earnings-adjustments", { signal })).data;
}
export async function savePayment(payload: PaymentPayload, id?: string) {
  return requestJson<{ data: EarningsAdjustment }>(`/api/earnings-adjustments${id ? `/${id}` : ""}`, {
    method: id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
}
export function deletePayment(id: string) {
  return requestJson<void>(`/api/earnings-adjustments/${id}`, { method: "DELETE" });
}
export function paymentError() { return "Could not save or load the payment. Review the fields and try again."; }
