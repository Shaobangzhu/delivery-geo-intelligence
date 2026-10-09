import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "./Dashboard";
import type { DashboardData } from "../dashboard/api";

vi.mock("../dashboard/EfficiencySection", () => ({ EfficiencySection: () => <section aria-label="Efficiency Analytics" /> }));

vi.mock("../dashboard/DashboardMap", () => ({ DashboardMap: ({ metric, destinationCells }: { metric: string; destinationCells: unknown[] }) =>
  <div data-testid="dashboard-map" data-metric={metric} data-destination-count={destinationCells.length} /> }));

const merchant = { id: "synthetic-id", name: "Synthetic Pickup", category: "grocery" as const,
  city: "Test City", deliveries: 2, totalEarnings: 12, averageEarnings: 12, sampleCount: 1 };
const fixture: DashboardData = {
  filters: { period: "week", category: "all", range: { start: "2026-04-20T07:00:00.000Z", endExclusive: "2026-04-27T07:00:00.000Z", startDate: "2026-04-20", endDate: "2026-04-26", timeZone: "America/Los_Angeles" } },
  summary: { totalDeliveries: 2, uniqueMerchants: 1, observedDestinationAreas: 1,
    totalEarnings: { value: 12, sampleCount: 1, deliveryEarnings: 12, prop22Earnings: 0, deliveryPayoutSampleCount: 1, prop22PaymentCount: 0 }, topMerchantByOrders: merchant,
    topMerchantByTotalEarnings: merchant, topMerchantByAverageEarnings: merchant },
  categoryDistribution: [
    { category: "restaurant", deliveries: 0 }, { category: "grocery", deliveries: 2 },
    { category: "retail", deliveries: 0 }, { category: "other", deliveries: 0 }
  ],
  pickupTimeline: [{ date: "2026-04-20", deliveries: 2 }], topMerchants: [merchant],
  map: { pickupVolume: [{ ...merchant, location: { type: "Point", coordinates: [0, 0] } }],
    merchantDiversity: [{ id: merchant.id, name: merchant.name, category: merchant.category, city: merchant.city, distinctMerchantCount: 1,
      location: { type: "Point", coordinates: [0, 0] } }] }
};

afterEach(() => vi.unstubAllGlobals());

it("loads one dashboard response for the cards, timeline, ranking, and map shell", async () => {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => fixture }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Dashboard />);
  expect(await screen.findByText("Apr 20, 2026 – Apr 26, 2026")).toBeInTheDocument();
  expect(screen.getAllByText("$12.00").length).toBeGreaterThan(0);
  expect(screen.getByText("1 known delivery payouts · 0 Prop 22 payments")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Merchant Category Distribution" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Observed Pickups Over Time" })).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getByText("Synthetic Pickup")).toBeInTheDocument();
  expect(screen.getByText("1 filtered merchant locations available")).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain("period=week&category=all");
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/api/ai/ask"))).toBe(true);
});

it("uses only the metric selector for canonical representations and filters destination cells", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (url: string) => url.includes("destination-heatmap")
    ? { ok: true, json: async () => ({ cells: [{ location: { type: "Point", coordinates: [0.1, 0.2] }, count: 1 }] }) }
    : { ok: true, json: async () => fixture });
  vi.stubGlobal("fetch", fetchMock);
  render(<Dashboard />);
  await screen.findByText("Apr 20, 2026 – Apr 26, 2026");
  const assertNoMode = () => {
    expect(screen.queryByRole("group", { name: "Map display mode" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Points" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Heatmap" })).not.toBeInTheDocument();
  };
  expect(within(screen.getByRole("group", { name: "Map metric" })).getAllByRole("button").map((button) => button.textContent))
    .toEqual(["Pickup Volume", "Merchant Diversity", "Destination Heatmap"]);
  const map = screen.getByTestId("dashboard-map");
  assertNoMode();
  expect(map).toHaveAttribute("data-metric", "pickupVolume");
  expect(screen.getByText("Heat intensity represents observed pickup activity.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Merchant Diversity" }));
  assertNoMode();
  expect(map).toHaveAttribute("data-metric", "merchantDiversity");
  expect(screen.getByText("Each point represents one observed physical merchant location; color and icon indicate merchant category.")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Destination Heatmap" }));
  assertNoMode();
  expect(screen.getByTestId("dashboard-map")).toBe(map);
  expect(screen.getByText("Destination heatmap only — individual destination points are not shown.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId("dashboard-map")).toHaveAttribute("data-destination-count", "1"));
  expect(screen.getByTestId("dashboard-map")).toHaveAttribute("data-metric", "destinationHeatmap");
  expect(screen.queryByText(/0\.1|0\.2|latitude|longitude/i)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Month" }));
  await user.click(screen.getByRole("button", { name: "Grocery" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("destination-heatmap?period=month&category=grocery"))).toBe(true));
  expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/api/ai/ask"))).toBe(true);
  expect(screen.getByText("Observed destination activity associated with grocery deliveries.")).toBeInTheDocument();
});

it("keeps the map mounted while time and category filters load", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fixture }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Dashboard />);
  const map = await screen.findByTestId("dashboard-map");
  await user.click(screen.getByRole("button", { name: "Month" }));
  await user.click(screen.getByRole("button", { name: "Grocery" }));
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(screen.getByTestId("dashboard-map")).toBe(map);
});

it("hides stale analytics while a new filter response is pending without unmounting the map", async () => {
  const user = userEvent.setup();
  let finishNext!: (value: { ok: boolean; json: () => Promise<DashboardData> }) => void;
  let requests = 0;
  vi.stubGlobal("fetch", vi.fn(() => {
    requests += 1;
    return requests === 1
      ? Promise.resolve({ ok: true, json: async () => fixture })
      : new Promise((resolve) => { finishNext = resolve; });
  }));
  render(<Dashboard />);
  const map = await screen.findByTestId("dashboard-map");
  await user.click(screen.getByRole("button", { name: "Month" }));
  const grid = map.closest(".dashboard-grid");
  expect(grid).toHaveAttribute("aria-busy", "true");
  expect(grid).toHaveAttribute("inert");
  expect(grid).toHaveClass("is-updating");
  expect(screen.getByTestId("dashboard-map")).toBe(map);
  finishNext({ ok: true, json: async () => fixture });
  await waitFor(() => expect(grid).toHaveAttribute("aria-busy", "false"));
});

it("shows cash-basis combined earnings only for All and delivery earnings for categories", async () => {
  const user = userEvent.setup();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const category = new URL(url, "http://localhost").searchParams.get("category") ?? "all";
    return { ok: true, json: async () => ({ ...fixture, summary: { ...fixture.summary,
      totalEarnings: { value: category === "all" ? 125 : 100, deliveryEarnings: 100,
        prop22Earnings: category === "all" ? 25 : 0, sampleCount: 7, deliveryPayoutSampleCount: 7, prop22PaymentCount: category === "all" ? 1 : 0 }
    } }) };
  }));
  render(<Dashboard />);
  expect(await screen.findByText("$125.00")).toBeInTheDocument();
  expect(screen.getByText("Delivery $100.00 + Prop 22 $25.00")).toBeInTheDocument();
  expect(screen.getByText("7 known delivery payouts · 1 Prop 22 payment")).toBeInTheDocument();
  for (const category of ["Restaurant", "Grocery", "Retail", "Other"]) {
    await user.click(screen.getByRole("button", { name: category }));
    await waitFor(() => expect(screen.queryByText("$125.00")).not.toBeInTheDocument());
    expect(screen.getByText("$100.00")).toBeInTheDocument();
    expect(screen.getByText("Delivery payouts only; Prop 22 not allocated")).toBeInTheDocument();
    expect(screen.queryByText("Delivery $100.00 + Prop 22 $25.00")).not.toBeInTheDocument();
  }
});
