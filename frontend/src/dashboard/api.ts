export type Period = "week" | "month" | "year";
export type Category = "all" | "restaurant" | "grocery" | "retail" | "other";
export type Metric = "pickupVolume" | "merchantDiversity" | "destinationHeatmap";

export interface MerchantRanking {
  id: string;
  name: string;
  category: Exclude<Category, "all">;
  city: string;
  deliveries: number;
  totalEarnings: number | null;
  averageEarnings: number | null;
  sampleCount: number;
}

interface GeoPoint { type: "Point"; coordinates: [number, number] }

export interface DashboardData {
  filters: { period: Period; category: Category; range: {
    start: string; endExclusive: string; startDate: string; endDate: string; timeZone: string;
  } };
  summary: {
    totalDeliveries: number;
    uniqueMerchants: number;
    observedDestinationAreas: number;
    totalEarnings: { value: number | null; sampleCount: number };
    topMerchantByOrders: MerchantRanking | null;
    topMerchantByTotalEarnings: MerchantRanking | null;
    topMerchantByAverageEarnings: MerchantRanking | null;
  };
  categoryDistribution: { category: Exclude<Category, "all">; deliveries: number }[];
  pickupTimeline: { date: string; deliveries: number }[];
  topMerchants: MerchantRanking[];
  map: {
    pickupVolume: (MerchantRanking & { location: GeoPoint })[];
    merchantDiversity: { id: string; name: string; category: Exclude<Category, "all">; city: string; deliveries: number; location: GeoPoint }[];
    destinationHeatmap: { location: GeoPoint; count: number }[];
  };
}

export async function loadDashboard(period: Period, category: Category, signal?: AbortSignal): Promise<DashboardData> {
  const query = new URLSearchParams({ period, category });
  const response = await fetch(`/api/dashboard?${query}`, { signal });
  if (!response.ok) throw new Error("Dashboard analytics are unavailable. Try again.");
  return response.json() as Promise<DashboardData>;
}
