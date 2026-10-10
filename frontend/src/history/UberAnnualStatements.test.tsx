import { afterEach, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UberAnnualStatements } from "./UberAnnualStatements";
const reply = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 503, json: async () => body } as Response);
const fixture = () => ({ year: 2022, sources: { uberTaxSummary: true, form1099K: true, form1099NEC: false },
  annual: { completedTrips: 12, onlineMiles: 120, grossPayment: 150, netPayout: 126 },
  metrics: { netPayoutPerTrip: { value: 10.5 }, netPayoutPerOnlineMile: { value: 1.05 } },
  monthlyActivity: [{ month: 1, completedTrips: 0, onlineMiles: 3, form1099KGrossTransactions: 0 }],
  reconciliation: { status: "warning", warnings: [{ check: "monthly_online_miles", expected: 119, reported: 120, difference: 1, unit: "miles" }] } });
const page = (data: unknown[]) => ({ data, limit: 20, hasMore: false });
afterEach(() => vi.unstubAllGlobals());
it("loads only the read API, shows empty state and explains coverage without claiming completeness", async () => {
  const fetcher = vi.fn(async (_path: string, _init?: RequestInit) => reply(page([]))); vi.stubGlobal("fetch", fetcher);
  render(<UberAnnualStatements />);
  expect(screen.getByRole("status")).toHaveTextContent("Loading annual statements");
  await screen.findByText(/No Uber annual statements imported/);
  expect(fetcher).toHaveBeenCalledTimes(1); expect(fetcher.mock.calls[0][0]).toBe("/api/uber-annual-summaries");
  expect(screen.getByText(/does not prove complete coverage/)).toBeInTheDocument();
});
it("renders source values, rates and warnings; focusable monthly detail preserves zero versus missing", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply(page([fixture()]))));
  render(<UberAnnualStatements />); const user = userEvent.setup();
  const region = await screen.findByRole("region", { name: "Uber annual comparison" });
  expect(within(region).getByText("$150.00")).toBeInTheDocument(); expect(within(region).getByText("$126.00")).toBeInTheDocument();
  expect(within(region).getByText("$1.05")).toBeInTheDocument(); expect(within(region).getByText("$10.50")).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent("reported 120, expected 119, difference 1 miles");
  const toggle = screen.getByText("2022 Monthly Activity"); toggle.focus(); expect(toggle).toHaveFocus(); await user.click(toggle);
  expect(toggle.closest("details")).toHaveAttribute("open");
  const monthly = screen.getByRole("region", { name: "2022 monthly activity" });
  expect(within(monthly).getByRole("columnheader", { name: "1099-K Gross Transactions (USD)" })).toBeInTheDocument();
  expect(within(monthly).getByRole("row", { name: /January/ })).toHaveTextContent("January03$0.00");
  expect(within(monthly).getByRole("row", { name: /February/ })).toHaveTextContent("FebruaryUnknownUnknownUnknown");
  expect(screen.getByText(/not monthly Net Payout. Missing monthly/)).toBeInTheDocument();
});
it("renders any completed year and unknown values without hardcoded annual data", async () => {
  const source = fixture(); const missing = { ...source, year: 2021, annual: {}, metrics: { netPayoutPerTrip: { value: null }, netPayoutPerOnlineMile: { value: null } }, reconciliation: { status: "partial", warnings: [] } };
  vi.stubGlobal("fetch", vi.fn(async () => reply(page([missing])))); render(<UberAnnualStatements />);
  const region = await screen.findByRole("region", { name: "Uber annual comparison" });
  expect(within(region).getByRole("row", { name: /2021/ })).toHaveTextContent("Unknown"); expect(within(region).getByText(/Partial/)).toBeInTheDocument();
  expect(within(region).queryByText("$0.00")).not.toBeInTheDocument();
});
it("handles API failure and explicit retry without triggering AI", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(reply({}, false)).mockResolvedValueOnce(reply(page([]))); vi.stubGlobal("fetch", fetcher);
  render(<UberAnnualStatements />); const user = userEvent.setup();
  await screen.findByRole("alert"); await user.click(screen.getByRole("button", { name: "Retry Annual Statements" }));
  await screen.findByText(/No Uber annual statements imported/); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([path]) => path === "/api/uber-annual-summaries")).toBe(true);
});
it("aborts on unmount and ignores an older response after StrictMode-style remount", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((_path: string, _init?: RequestInit) => new Promise<Response>((resolve) => { finish = resolve; })); vi.stubGlobal("fetch", fetcher);
  const view = render(<UberAnnualStatements />);
  const signal = (fetcher.mock.calls[0][1] as RequestInit).signal as AbortSignal;
  view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => { finish(reply(page([fixture()]))); });
  expect(screen.queryByRole("region", { name: "Uber annual comparison" })).not.toBeInTheDocument();
});

it("fails safely on a malformed successful API response", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply({ data: undefined }))); render(<UberAnnualStatements />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Annual statements could not be loaded");
});
