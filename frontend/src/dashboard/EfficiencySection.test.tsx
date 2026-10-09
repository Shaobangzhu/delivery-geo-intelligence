import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EfficiencySection } from "./EfficiencySection";
import type { EfficiencyData, EfficiencyMetric, SessionEfficiency } from "./efficiencyApi";

const metric = (value: number | null, unit: EfficiencyMetric["unit"] = "USD", sampleCount = 1, excludedCount = 0): EfficiencyMetric =>
  ({ value, unit, sampleCount, excludedCount, reasons: value === null ? ["incomplete_vehicle_cost"] : [] });
const sessions: SessionEfficiency = {
  categoryScope: "all", sessionCount: 2, linkedDeliveryCount: 3, missingPayoutCount: 1, incompleteSessionCount: 1,
  knownPayoutTotal: metric(40, "USD", 2), durationHours: metric(4, "hours", 2), totalMiles: metric(20, "miles", 2),
  payoutPerSessionHour: metric(20, "USD/hour", 1, 1), payoutPerSessionMile: metric(4, "USD/mile", 1, 1),
  vehicleCost: { basis: "current_profile", knownAndEstimatedCost: metric(0.8, "USD", 2), fullEconomicCost: metric(null, "USD", 0, 2) },
  estimatedEconomicProfit: metric(null, "USD", 0, 2), estimatedEconomicProfitPerHour: metric(null, "USD/hour", 0, 2)
};
const fixture: EfficiencyData = {
  filters: { period: "week", category: "all", range: { start: "2026-03-02T08:00:00Z", endExclusive: "2026-03-09T07:00:00Z", startDate: "2026-03-02", endDate: "2026-03-08", timeZone: "America/Los_Angeles" } },
  deliveryEfficiency: { deliveryCount: 3, knownPayoutTotal: metric(40, "USD", 2, 1), payoutPerRecordedHour: metric(25, "USD/hour", 2, 1), payoutPerRecordedMile: metric(5, "USD/mile", 2, 1) },
  sessionEfficiency: sessions,
  strategyComparison: [{ strategy: "eastvale_local_only", ...sessions }, { strategy: "unclassified", ...sessions }],
  dataQuality: { deliveriesMissingPayout: 1, sessionsWithIncompleteVehicleCost: 2, sessionsExcludedBoundaryCrossing: 1 }
};
afterEach(() => vi.unstubAllGlobals());

it("renders weighted rates, strategy cohorts, partial costs, unknown profit and privacy/tax boundaries", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => fixture })));
  const user = userEvent.setup(); render(<EfficiencySection period="week" category="all" />);
  expect(await screen.findByText("$25.00/hr")).toBeInTheDocument(); expect(screen.getByText("$5.00/mi")).toBeInTheDocument();
  expect(screen.getByText("$0.80")).toBeInTheDocument(); expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  expect(screen.getAllByText("2 eligible deliveries · 1 excluded")).toHaveLength(2);
  const table = screen.getByRole("table", { name: "Strategy efficiency comparison" });
  expect(within(table).getByText("Eastvale Local-Only")).toBeInTheDocument(); expect(within(table).getByText("Unclassified")).toBeInTheDocument();
  expect(screen.getByText(/Pre-tax, excluding unallocated Prop 22 adjustments/)).toBeInTheDocument();
  expect(screen.getByText(/IRS deductions are separate/)).toBeInTheDocument();
  await user.click(screen.getByText("Data completeness")); expect(screen.getByText("Sessions excluded at period boundaries")).toBeVisible();
});

it("shows loading/error states and allows retry", async () => {
  let finish!: (value: { ok: boolean }) => void;
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => fixture });
  vi.stubGlobal("fetch", fetchMock); const user = userEvent.setup(); render(<EfficiencySection period="week" category="all" />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading efficiency analytics");
  finish({ ok: false }); expect(await screen.findByRole("alert")).toHaveTextContent("Efficiency analytics are unavailable");
  await user.click(screen.getByRole("button", { name: "Retry efficiency" })); expect(await screen.findByText("$25.00/hr")).toBeInTheDocument();
});

it("filter changes clear stale values and ignore superseded responses while sessions stay explicitly All-category", async () => {
  const pending: ((value: unknown) => void)[] = [];
  const fetchMock = vi.fn((_url: string) => new Promise((resolve) => { pending.push(resolve); }));
  vi.stubGlobal("fetch", fetchMock);
  const view = render(<EfficiencySection period="week" category="all" />);
  view.rerender(<EfficiencySection period="month" category="grocery" />);
  expect(String(fetchMock.mock.calls[1][0])).toContain("period=month&category=grocery");
  pending[1]({ ok: true, json: async () => ({ ...fixture, deliveryEfficiency: { ...fixture.deliveryEfficiency, payoutPerRecordedHour: metric(7, "USD/hour") } }) });
  expect(await screen.findByText("$7.00/hr")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Session Efficiency · All Categories" })).toBeInTheDocument();
  pending[0]({ ok: true, json: async () => fixture });
  expect(screen.queryByText("$25.00/hr")).not.toBeInTheDocument();
  view.rerender(<EfficiencySection period="year" category="all" />);
  expect(screen.queryByText("$7.00/hr")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toBeInTheDocument();
});
