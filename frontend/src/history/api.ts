export type Category = "restaurant" | "grocery" | "retail" | "other";
export type SortOrder = "newest" | "oldest" | "payoutDesc" | "payoutAsc" | "distanceDesc" | "distanceAsc";

export interface Merchant {
  id: string;
  name: string;
  category: Category;
  city: string;
  publicAddress?: string;
}

export interface Delivery {
  id: string;
  merchantId: string;
  pickedUpAt: string;
  payout?: number;
  distanceMiles?: number;
  notes?: string;
  hasDestinationLocation: boolean;
}

export interface DeliveryPage {
  data: Delivery[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface DeliveryFilters {
  search: string;
  category: Category | "";
  fromDate: string;
  toDate: string;
  sort: SortOrder;
  page: number;
  pageSize: number;
}

export interface DeliveryPayload {
  merchantId: string;
  pickedUpAt: string;
  payout?: number | null;
  distanceMiles?: number | null;
  notes?: string | null;
  destinationAddress?: string;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code?: string) {
    super("Request failed");
  }
}

export async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let code: string | undefined;
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "code" in body && typeof body.code === "string") {
        code = body.code;
      }
    } catch {
      // Error responses are intentionally not echoed into the interface.
    }
    throw new ApiError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function dateAtLocalMidnight(date: string, nextDay: boolean): string {
  const value = new Date(`${date}T00:00:00`);
  if (nextDay) value.setDate(value.getDate() + 1);
  return value.toISOString();
}

export function listDeliveries(filters: DeliveryFilters, signal?: AbortSignal): Promise<DeliveryPage> {
  const query = new URLSearchParams({
    sort: filters.sort,
    page: String(filters.page),
    pageSize: String(filters.pageSize)
  });
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (filters.category) query.set("category", filters.category);
  if (filters.fromDate) query.set("from", dateAtLocalMidnight(filters.fromDate, false));
  if (filters.toDate) query.set("to", dateAtLocalMidnight(filters.toDate, true));
  return requestJson<DeliveryPage>(`/api/deliveries?${query}`, { signal });
}

export async function listMerchants(signal?: AbortSignal): Promise<Merchant[]> {
  const result = await requestJson<{ data: Merchant[] }>("/api/merchants", { signal });
  return result.data;
}

export async function createDelivery(payload: DeliveryPayload): Promise<Delivery> {
  const result = await requestJson<{ data: Delivery }>("/api/deliveries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return result.data;
}

export async function updateDelivery(id: string, payload: DeliveryPayload): Promise<Delivery> {
  const result = await requestJson<{ data: Delivery }>(`/api/deliveries/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return result.data;
}

export async function deleteDelivery(id: string): Promise<void> {
  await requestJson<void>(`/api/deliveries/${id}`, { method: "DELETE" });
}

export function userFacingError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "no_match") return "No destination match was found. Check the address and try again.";
    if (error.code === "low_confidence") return "The destination match is too uncertain. Enter a more complete address.";
    if (error.code === "network_error") return "Geocoding is temporarily unavailable. Try again shortly.";
    if (error.code === "provider_error" || error.code === "unusable_result") return "The geocoding service could not process this destination. Try again later.";
    if (error.status === 400) return "Some fields were rejected. Review the form and try again.";
    if (error.status === 422) return "The selected merchant is unavailable. Refresh and try again.";
    if (error.status === 404) return "This delivery no longer exists. Refresh the list.";
    return "The server could not complete the request. Try again.";
  }
  return "Could not reach the server. Check your connection and try again.";
}
