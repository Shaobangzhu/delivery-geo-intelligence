import { afterEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettlementEfficiencySection } from "./SettlementEfficiencySection";
import type { SettlementEfficiency, SettlementEfficiencyPage } from "./settlementEfficiencyApi";

const ready: SettlementEfficiency = {
  settlementId: "synthetic-settlement-one", paymentDate: "2026-03-20", coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14",
  actualAdjustment: 24.17, deliveryRevenue: { knownTotal: 60, deliveryCount: 3, knownPayoutCount: 3, missingPayoutCount: 0 },
  sessionCoverage: { includedSessionCount: 2, excludedBoundarySessionCount: 0, totalHours: 3, totalMiles: 30, completenessConfirmed: true, structurallyComplete: true, issues: [] },
  vehicleCost: { basis: "current_profile", knownAndEstimatedTotal: 2.7, fullTotal: 2.7, completeSessionCount: 2, sessionCount: 2,
    componentTotals: { energy: { value: 0, sampleCount: 2, excludedCount: 0 }, tireWear: { value: 1.2, sampleCount: 2, excludedCount: 0 }, depreciation: { value: 1.5, sampleCount: 2, excludedCount: 0 } } },
  workPeriodRevenue: 84.17, adjustedEarningsPerHour: 84.17 / 3, adjustedEarningsPerMile: 84.17 / 30, estimatedEconomicProfit: 81.47,
  estimatedEconomicProfitPerHour: 81.47 / 3, estimatedEconomicProfitPerMile: 81.47 / 30, status: "ready", reasons: []
};
const partial: SettlementEfficiency = { ...ready, settlementId: "synthetic-settlement-two", paymentDate: "2026-03-10", coverageStartDate: null, coverageEndDate: null,
  status: "unavailable", workPeriodRevenue: null, adjustedEarningsPerHour: null, adjustedEarningsPerMile: null, estimatedEconomicProfit: null, estimatedEconomicProfitPerHour: null, estimatedEconomicProfitPerMile: null,
  sessionCoverage: { ...ready.sessionCoverage, completenessConfirmed: false, structurallyComplete: false, totalHours: null, totalMiles: null },
  reasons: ["missing_coverage_dates", "unconfirmed_session_coverage", "incomplete_vehicle_cost"] };
const page: SettlementEfficiencyPage = { data: [ready, partial], limit: 20, totalSettlements: 2, hasMore: false };
afterEach(() => vi.unstubAllGlobals());

it("shows work-period revenue/rates and a separate scope, and selects incomplete recent settlements", async () => {
  const mock = vi.fn(async () => ({ ok: true, json: async () => page })); vi.stubGlobal("fetch", mock);
  const user = userEvent.setup(); render(<SettlementEfficiencySection />);
  expect(await screen.findByText("ready")).toBeInTheDocument(); expect(screen.getByText("All Categories · Settlement Coverage Period")).toBeInTheDocument();
  expect(screen.getByText("Dashboard earnings use payment dates. This section attributes actual adjustments to their reported work periods.")).toBeInTheDocument();
  expect(screen.getByText("$84.17")).toBeInTheDocument(); expect(screen.getByText("$28.06")).toBeInTheDocument(); expect(screen.getByText("$81.47")).toBeInTheDocument();
  await user.click(screen.getByText("Vehicle cost breakdown · current assumptions")); expect(screen.getByText(/\$0\.00 · 2 known/)).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Settlement"), partial.settlementId);
  expect(screen.getByText("unavailable")).toBeInTheDocument(); expect(screen.getAllByText("—").length).toBeGreaterThan(3);
  expect(screen.getByText("Enter both settlement coverage dates in History.")).toBeInTheDocument();
  expect(screen.getByText(/Review the period and confirm/)).toBeInTheDocument(); expect(screen.getByText(/Configure tire lifespan/)).toBeInTheDocument();
  expect(mock).toHaveBeenCalledTimes(1);
});
it("handles loading, safe errors, retry and empty settlements", async () => {
  let finish!: (response: unknown) => void;
  const mock = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], limit: 20, totalSettlements: 0, hasMore: false }) });
  vi.stubGlobal("fetch", mock); const user = userEvent.setup(); render(<SettlementEfficiencySection />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading settlement efficiency"); finish({ ok: false });
  expect(await screen.findByRole("alert")).toHaveTextContent("Settlement efficiency is unavailable");
  await user.click(screen.getByRole("button", { name: "Retry settlements" })); expect(await screen.findByText("No Prop 22 settlements recorded.")).toBeInTheDocument();
});
it("preserves selection on refresh and announces the bounded recent list", async () => {
  const mock = vi.fn(async () => ({ ok: true, json: async () => ({ ...page, hasMore: true, totalSettlements: 24 }) }));
  vi.stubGlobal("fetch", mock); const user = userEvent.setup(); render(<SettlementEfficiencySection />);
  await screen.findByText("ready"); await user.selectOptions(screen.getByLabelText("Settlement"), partial.settlementId);
  await user.click(screen.getByRole("button", { name: "Refresh settlements" }));
  expect(await screen.findByText("unavailable")).toBeInTheDocument(); expect(screen.getByLabelText("Settlement")).toHaveValue(partial.settlementId);
  expect(screen.getByText("Showing the 20 most recent payments of 24.")).toBeInTheDocument();
  expect(within(screen.getByLabelText("Settlement")).getAllByRole("option")).toHaveLength(2);
});
