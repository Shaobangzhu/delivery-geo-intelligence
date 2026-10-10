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

it.each([2026, 2027, 2028])("offers LA calendar years dynamically in %s without official-report years", async (year) => {
  vi.setSystemTime(new Date(`${year}-06-01T12:00:00Z`));
  try {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixture })));
    const user = userEvent.setup(); render(<Dashboard />);
    await screen.findByText("Apr 20, 2026 – Apr 26, 2026");
    const select = screen.getByRole("combobox", { name: "Dashboard calendar year" });
    const choices = within(select).getAllByRole("option").filter((option) => !option.hasAttribute("disabled"));
    expect(choices.map((option) => option.getAttribute("value"))).toEqual(["current", ...Array.from({ length: year - 2026 }, (_, index) => String(year - index - 1))]);
    expect(within(select).getByRole("option", { name: `Year · Current (${year})` })).toBeInTheDocument();
    await user.selectOptions(select, "current");
    expect(select).toHaveAttribute("data-active", "true"); expect(select).toHaveFocus();
  } finally { vi.useRealTimers(); }
});

it("keeps year/category selections independent, sends one request per change and reuses the map", async () => {
  vi.setSystemTime(new Date("2028-06-01T12:00:00Z"));
  try {
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes("destination-heatmap") ? { cells: [] } : fixture }));
    vi.stubGlobal("fetch", fetchMock); const user = userEvent.setup(); render(<Dashboard />);
    await screen.findByText("Apr 20, 2026 – Apr 26, 2026");
    const map = screen.getByTestId("dashboard-map");
    const select = screen.getByRole("combobox", { name: "Dashboard calendar year" });
    const time = within(screen.getByRole("group", { name: "Time period" }));
    const category = within(screen.getByRole("group", { name: "Category" }));
    const query = () => new URL(String(fetchMock.mock.calls.at(-1)![0]), "http://test").searchParams;
    await user.selectOptions(select, "2027"); expect(query().get("year")).toBe("2027");
    await user.selectOptions(select, "2026"); expect(query().get("year")).toBe("2026");
    await user.click(time.getByRole("button", { name: "All" })); expect(query().get("period")).toBe("all"); expect(query().has("year")).toBe(false);
    await user.click(time.getByRole("button", { name: "Month" })); expect(query().get("period")).toBe("month");
    await user.selectOptions(select, "2026"); expect(query().get("year")).toBe("2026");
    await user.click(category.getByRole("button", { name: "Grocery" })); expect(query().get("category")).toBe("grocery"); expect(query().get("year")).toBe("2026");
    await user.click(time.getByRole("button", { name: "All" })); expect(query().get("category")).toBe("grocery");
    await user.selectOptions(select, "2026"); expect(query().get("year")).toBe("2026");
    expect(fetchMock).toHaveBeenCalledTimes(9); expect(screen.getByTestId("dashboard-map")).toBe(map);
    await user.click(screen.getByRole("button", { name: "Destination Heatmap" }));
    expect(query().get("year")).toBe("2026"); expect(String(fetchMock.mock.calls.at(-1)![0])).toContain("destination-heatmap");
    expect(screen.queryByRole("button", { name: "Points" })).not.toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it("ignores out-of-order Year/All and destination responses without exposing stale widgets", async () => {
  vi.setSystemTime(new Date("2028-06-01T12:00:00Z"));
  try {
    const pending: { url: string; signal?: AbortSignal; finish: (value: unknown) => void }[] = [];
    vi.stubGlobal("fetch", vi.fn((url: string, options?: RequestInit) => new Promise((finish) => pending.push({ url, signal: options?.signal ?? undefined, finish }))));
    const user = userEvent.setup(); render(<Dashboard />);
    pending[0].finish({ ok: true, json: async () => fixture });
    await screen.findByText("Apr 20, 2026 – Apr 26, 2026");
    const map = screen.getByTestId("dashboard-map");
    await user.click(screen.getByRole("button", { name: "Destination Heatmap" }));
    await user.selectOptions(screen.getByRole("combobox"), "2027");
    await user.selectOptions(screen.getByRole("combobox"), "2026");
    await user.click(within(screen.getByRole("group", { name: "Time period" })).getByRole("button", { name: "All" }));
    const grid = document.querySelector(".dashboard-grid")!;
    expect(grid).toHaveClass("is-updating"); expect(grid).toHaveAttribute("aria-hidden", "true");
    expect(pending.slice(1, -2).every((row) => row.signal?.aborted)).toBe(true);
    const allFixture = { ...fixture, filters: { ...fixture.filters, period: "all", range: { ...fixture.filters.range, startDate: "2026-01-01", endDate: "2028-06-01" } },
      pickupTimeline: [{ date: "2026", deliveries: 2 }, { date: "2027", deliveries: 0 }, { date: "2028", deliveries: 0 }] };
    pending.at(-2)!.finish({ ok: true, json: async () => allFixture });
    pending.at(-1)!.finish({ ok: true, json: async () => ({ cells: [] }) });
    await screen.findByText("Jan 1, 2026 – Jun 1, 2028");
    for (const row of pending.slice(1, -2)) row.finish({ ok: true, json: async () => row.url.includes("destination-heatmap") ? { cells: [{ location: { type: "Point", coordinates: [0.1, 0.2] }, count: 99 }] } : fixture });
    await waitFor(() => expect(grid).not.toHaveClass("is-updating"));
    expect(screen.getByTestId("dashboard-map")).toBe(map); expect(map).toHaveAttribute("data-destination-count", "0");
    expect(screen.getByText("Jan 1, 2026 – Jun 1, 2028")).toBeInTheDocument();
    const chart = screen.getByRole("img", { name: /Pickup counts/ });
    for (const year of ["2026", "2027", "2028"]) expect(within(chart).getByText(year)).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

it("shows an empty historical year without substituting annual data", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ...fixture, filters: { ...fixture.filters, period: "year" },
    topMerchants: [], summary: { ...fixture.summary, totalDeliveries: 0 }, pickupTimeline: Array.from({ length: 12 }, (_, index) => ({ date: `2026-${String(index + 1).padStart(2, "0")}`, deliveries: 0 })) }) })));
  const user = userEvent.setup(); render(<Dashboard />);
  await screen.findByText("No deliveries in this period.");
  await user.selectOptions(screen.getByRole("combobox"), "current");
  expect(await screen.findByText("No deliveries in this period.")).toBeInTheDocument();
});

it("advances an open page at Los Angeles year rollover and refreshes All without losing category", async () => {
  vi.setSystemTime(new Date("2028-01-01T07:59:59Z"));
  try {
    const mock = vi.fn(async (_url: string) => ({ ok: true, json: async () => fixture }));
    vi.stubGlobal("fetch", mock); const user = userEvent.setup(); render(<Dashboard />);
    await screen.findByText("Apr 20, 2026 – Apr 26, 2026");
    const select = screen.getByRole("combobox", { name: "Dashboard calendar year" });
    expect(within(select).getByText("Year · Current (2027)")).toBeInTheDocument();
    await user.click(within(screen.getByRole("group", { name: "Category" })).getByRole("button", { name: "Grocery" }));
    await user.click(within(screen.getByRole("group", { name: "Time period" })).getByRole("button", { name: "All" }));
    const before = mock.mock.calls.length;
    vi.setSystemTime(new Date("2028-01-01T08:00:00Z"));
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(within(select).getByText("Year · Current (2028)")).toBeInTheDocument());
    expect(within(select).getByText("Year · 2027")).toBeInTheDocument();
    expect(mock).toHaveBeenCalledTimes(before + 1);
    expect(mock.mock.calls.at(-1)![0]).toBe("/api/dashboard?period=all&category=grocery");
  } finally { vi.useRealTimers(); }
});
