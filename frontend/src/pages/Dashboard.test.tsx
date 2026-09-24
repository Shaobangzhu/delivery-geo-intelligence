import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dashboard } from "./Dashboard";
import type { DashboardData } from "../dashboard/api";

vi.mock("../dashboard/PickupMap", () => ({ PickupMap: () => <div data-testid="pickup-map" /> }));

const merchant = { id: "synthetic-id", name: "Synthetic Pickup", category: "grocery" as const,
  city: "Test City", deliveries: 2, totalEarnings: 12, averageEarnings: 12, sampleCount: 1 };
const fixture: DashboardData = {
  filters: { period: "week", category: "all", range: { start: "2026-04-20T07:00:00.000Z", endExclusive: "2026-04-27T07:00:00.000Z", startDate: "2026-04-20", endDate: "2026-04-26", timeZone: "America/Los_Angeles" } },
  summary: { totalDeliveries: 2, uniqueMerchants: 1, observedDestinationAreas: 1,
    totalEarnings: { value: 12, sampleCount: 1 }, topMerchantByOrders: merchant,
    topMerchantByTotalEarnings: merchant, topMerchantByAverageEarnings: merchant },
  categoryDistribution: [
    { category: "restaurant", deliveries: 0 }, { category: "grocery", deliveries: 2 },
    { category: "retail", deliveries: 0 }, { category: "other", deliveries: 0 }
  ],
  pickupTimeline: [{ date: "2026-04-20", deliveries: 2 }], topMerchants: [merchant],
  map: { pickupVolume: [{ ...merchant, location: { type: "Point", coordinates: [0, 0] } }],
    merchantDiversity: [{ id: merchant.id, name: merchant.name, category: merchant.category, city: merchant.city, deliveries: 2,
      location: { type: "Point", coordinates: [0, 0] } }],
    destinationHeatmap: [{ location: { type: "Point", coordinates: [0.1, 0.2] }, count: 1 }] }
};

afterEach(() => vi.unstubAllGlobals());

it("loads one dashboard response for the cards, timeline, ranking, and map shell", async () => {
  const fetchMock = vi.fn(async (_url: string) => ({ ok: true, json: async () => fixture }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Dashboard />);
  expect(await screen.findByText("Apr 20, 2026 – Apr 26, 2026")).toBeInTheDocument();
  expect(screen.getAllByText("$12.00").length).toBeGreaterThan(0);
  expect(screen.getByText("1 known payouts")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Merchant Category Distribution" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Observed Pickups Over Time" })).toBeInTheDocument();
  expect(within(screen.getByRole("table")).getByText("Synthetic Pickup")).toBeInTheDocument();
  expect(screen.getByText("1 filtered merchant locations available")).toBeInTheDocument();
  expect(String(fetchMock.mock.calls[0][0])).toContain("period=week&category=all");
});

it("changes shared filters and hides local map mode for destination heatmap", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => ({ ...fixture,
    filters: { ...fixture.filters, period: url.includes("period=month") ? "month" : "week",
      category: url.includes("category=grocery") ? "grocery" : "all" }
  }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Dashboard />);
  await screen.findByText("Apr 20, 2026 – Apr 26, 2026");
  const mode = screen.getByRole("group", { name: "Map display mode" });
  await user.click(within(mode).getByRole("button", { name: "Points" }));
  expect(within(mode).getByRole("button", { name: "Points" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Destination Heatmap" }));
  expect(screen.queryByRole("group", { name: "Map display mode" })).not.toBeInTheDocument();
  expect(screen.getByText("1 filtered generalized destination areas available")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Month" }));
  await user.click(screen.getByRole("button", { name: "Grocery" }));
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes("period=month&category=grocery"))).toBe(true));
});

it("keeps the Pickup Volume map mounted while time and category filters load", async () => {
  const user = userEvent.setup();
  const fetchMock = vi.fn(async () => ({ ok: true, json: async () => fixture }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Dashboard />);
  const map = await screen.findByTestId("pickup-map");
  await user.click(screen.getByRole("button", { name: "Month" }));
  await user.click(screen.getByRole("button", { name: "Grocery" }));
  await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(screen.getByTestId("pickup-map")).toBe(map);
});
