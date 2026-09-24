import { ApiError, requestJson, type Category, type Merchant } from "../history/api";

export interface MerchantRecord extends Merchant {
  location: { type: "Point"; coordinates: [number, number] };
  deliveryCount: number;
}

export interface MerchantInput {
  name: string;
  category: Category;
  publicAddress: string;
  city: string;
}

export async function listMerchantRecords(signal?: AbortSignal): Promise<MerchantRecord[]> {
  const result = await requestJson<{ data: MerchantRecord[] }>("/api/merchants", { signal });
  return result.data;
}

export async function createMerchant(payload: MerchantInput): Promise<MerchantRecord> {
  const result = await requestJson<{ data: MerchantRecord }>("/api/merchants", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  return result.data;
}

export async function updateMerchant(id: string, payload: Partial<MerchantInput>): Promise<MerchantRecord> {
  const result = await requestJson<{ data: MerchantRecord }>(`/api/merchants/${id}`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  return result.data;
}

export async function deleteMerchant(id: string): Promise<void> {
  await requestJson<void>(`/api/merchants/${id}`, { method: "DELETE" });
}

export function merchantError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "no_match") return "No business address match was found. Check the address and try again.";
    if (error.code === "low_confidence") return "The business address match is too uncertain. Enter a more complete address.";
    if (error.code === "network_error") return "Geocoding is temporarily unavailable. Try again shortly.";
    if (error.code === "provider_error" || error.code === "unusable_result") return "The geocoding service could not process this business address. Try again later.";
    if (error.status === 409) return "This merchant has delivery history and cannot be deleted.";
    if (error.status === 400) return "Some fields were rejected. Review the form and try again.";
    if (error.status === 404) return "This merchant no longer exists. Refresh the list.";
    return "The server could not complete the request. Try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}
