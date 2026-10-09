import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UberSessions } from "./UberSessions";
import { SessionModal } from "./SessionModal";
import * as api from "./sessionApi";
import type { DeliverySession, EconomicsResponse, SessionPayload, VehicleCost } from "./sessionApi";
import { ApiError } from "./api";

vi.mock("./sessionApi", async (original) => ({ ...await original<typeof import("./sessionApi")>(),
  listSessions: vi.fn(), getEconomics: vi.fn(), initializeEconomics: vi.fn(), saveSession: vi.fn(), deleteSession: vi.fn(),
  saveVehicleProfile: vi.fn(), saveAnnualMileage: vi.fn(), listSessionCandidates: vi.fn()
}));
const cost: VehicleCost = { totalDrivenMiles: 8.4, rates: { energy: 0, tireWear: 0.04, depreciation: null },
  amounts: { energy: 0, tireWear: 0.34, depreciation: null }, missingComponents: ["depreciation"],
  knownAndEstimatedCost: 0.34, fullEconomicCost: null, completeness: "partial", basis: "current_profile" };
const base: DeliverySession = { id: "session-test-a", startedAt: "2026-03-08T07:30:00.000Z", endedAt: "2026-03-08T10:30:00.000Z", sessionDurationSeconds: 10800,
  strategy: "eastvale_local_only", totalDrivenMiles: 8.4, deliveryIds: [], linkedDeliveries: [], vehicleCost: cost };
const merchants = [{ id: "merchant-a", name: "Synthetic Pickup", category: "restaurant" as const, city: "Test City" }];
const annual = (year: number) => year === 2024
  ? { taxYear: 2024, totalVehicleMiles: 13350, uberEatsBusinessMiles: 5737, realtorBusinessMiles: 0, otherBusinessMiles: 0, taxMethod: "standard_mileage" as const, knownBusinessMiles: 5737, reportedBusinessMiles: 5737, businessMileageComplete: true, businessUsePercentage: 5737 / 13350 * 100, standardMileage: { rate: 0.67, estimatedDeduction: 3843.79 } }
  : { taxYear: 2025, totalVehicleMiles: 11549, uberEatsBusinessMiles: 2310, realtorBusinessMiles: 0, otherBusinessMiles: 0, taxMethod: "standard_mileage" as const, knownBusinessMiles: 2310, reportedBusinessMiles: 2310, businessMileageComplete: true, businessUsePercentage: 2310 / 11549 * 100, standardMileage: { rate: 0.7, estimatedDeduction: 1617 } };
const initialized: EconomicsResponse = { data: { vehicleName: "2022 Tesla Model Y Long Range", energyCashCostPerMile: 0, tireReplacementSetCost: 1600 }, historicalMileage: [annual(2025), annual(2024)] };
let rows: DeliverySession[];
beforeEach(() => {
  rows = [];
  vi.mocked(api.listSessions).mockImplementation(async () => rows);
  vi.mocked(api.getEconomics).mockResolvedValue(initialized);
  vi.mocked(api.listSessionCandidates).mockResolvedValue({ data: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 } });
  vi.mocked(api.saveSession).mockImplementation(async (payload: SessionPayload, id?: string) => {
    const next = { ...base, ...payload, id: id ?? base.id,
      sessionDurationSeconds: (Date.parse(payload.endedAt) - Date.parse(payload.startedAt)) / 1000,
      deliveryIds: payload.deliveryIds ?? [], linkedDeliveries: [] } as DeliverySession;
    for (const key of ["strategy", "totalDrivenMiles", "taxEligibleBusinessMiles", "notes"] as const) if (payload[key] === null) delete next[key];
    rows = [next]; return { data: next };
  });
  vi.mocked(api.deleteSession).mockImplementation(async () => { rows = []; });
});
afterEach(() => vi.resetAllMocks());

it("clears stale vehicle assumptions after a failed refresh", async () => {
  const view = render(<UberSessions merchants={merchants} deliveryRevision={0} />);
  await screen.findByText("No Uber Eats sessions recorded.");
  const user = userEvent.setup(); await user.click(screen.getByText("Tesla Model Y — Vehicle Economics"));
  expect(screen.getByRole("button", { name: "Edit Vehicle Settings" })).toBeInTheDocument();
  vi.mocked(api.getEconomics).mockRejectedValue(new Error("Synthetic load failure"));
  view.rerender(<UberSessions merchants={merchants} deliveryRevision={1} />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Edit Vehicle Settings" })).not.toBeInTheDocument();
  expect(screen.queryByText("$1,600.00")).not.toBeInTheDocument();
});
it("shows an unfinished association warning and resubmits reviewed links even when unchanged", async () => {
  const user = userEvent.setup(), saved = vi.fn();
  render(<SessionModal session={{ ...base, associationIntegrity: "pending", deliveryIds: ["delivery-a"], linkedDeliveries: [{ id: "delivery-a", merchantId: "merchant-a", pickedUpAt: base.startedAt }] }} merchants={merchants} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Review all delivery links");
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(vi.mocked(api.saveSession).mock.calls[0][0].deliveryIds).toEqual(["delivery-a"]);
});
function mount() { render(<UberSessions merchants={merchants} deliveryRevision={0} />); }

it("creates an explicitly linked session across midnight/DST and validates independent business mileage", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("No Uber Eats sessions recorded.");
  await user.click(screen.getByRole("button", { name: /Add Session/ }));
  const dialog = screen.getByRole("dialog", { name: "Add Session" });
  expect(screen.getByLabelText("Session Start *")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "Save Session" })); expect(screen.getByRole("alert")).toHaveTextContent("end after start");
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: "2026-03-07T23:30" } });
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: "2026-03-08T03:30" } });
  await user.selectOptions(screen.getByLabelText("Operating Strategy"), "eastvale_local_only");
  await user.type(screen.getByLabelText("Total Driven Miles"), "8.4");
  await user.type(screen.getByLabelText("IRS Eligible Business Miles"), "9");
  await user.click(screen.getByRole("button", { name: "Save Session" })); expect(screen.getByRole("alert")).toHaveTextContent("cannot exceed");
  await user.clear(screen.getByLabelText("IRS Eligible Business Miles"));
  vi.mocked(api.listSessionCandidates).mockResolvedValue({ data: [
    { id: "delivery-a", merchantId: "merchant-a", pickedUpAt: "2026-03-08T08:00:00Z", hasDestinationLocation: true },
    { id: "delivery-b", merchantId: "merchant-a", pickedUpAt: "2026-03-08T09:00:00Z", sessionId: "other-session", hasDestinationLocation: false }
  ], pagination: { page: 1, pageSize: 20, total: 2, totalPages: 1 } });
  await user.click(within(dialog).getByText(/Link Deliveries/));
  const checkboxes = await within(dialog).findAllByRole("checkbox");
  expect(checkboxes[0]).not.toBeChecked(); expect(checkboxes[1]).toBeDisabled();
  await user.click(checkboxes[0]);
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.saveSession).toHaveBeenCalledWith({ startedAt: base.startedAt, endedAt: base.endedAt, totalDrivenMiles: 8.4, strategy: "eastvale_local_only", deliveryIds: ["delivery-a"] }, undefined);
  expect(screen.getByText("3 hrs")).toBeInTheDocument(); expect(screen.getByText("Eastvale Local-Only")).toBeInTheDocument();
});

it("edits a session with no automatic relinking, intentionally clears optional mileage, and confirms deletion", async () => {
  const user = userEvent.setup(); rows = [{ ...base, totalDrivenMiles: 0, taxEligibleBusinessMiles: 0 }]; mount();
  await screen.findByText("0 mi"); await user.click(screen.getByRole("button", { name: "Edit session test-a" }));
  expect(screen.getByLabelText("Total Driven Miles")).toHaveValue(0);
  await user.clear(screen.getByLabelText("Total Driven Miles")); await user.clear(screen.getByLabelText("IRS Eligible Business Miles"));
  await user.selectOptions(screen.getByLabelText("Operating Strategy"), "");
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.saveSession).toHaveBeenCalledWith({ startedAt: base.startedAt, endedAt: base.endedAt, totalDrivenMiles: null, taxEligibleBusinessMiles: null, strategy: null }, base.id);
  expect(screen.getByText("Unknown")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete session test-a" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("unlinked and retained"); expect(api.deleteSession).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Cancel" })); expect(api.deleteSession).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete session test-a" })); await user.click(screen.getByRole("button", { name: "Delete Session" }));
  await screen.findByText("No Uber Eats sessions recorded."); expect(api.deleteSession).toHaveBeenCalledExactlyOnceWith(base.id);
});

it("labels partial cost components without presenting unknown depreciation as zero", async () => {
  const user = userEvent.setup(); rows = [base]; mount(); await screen.findByText("3 hrs");
  await user.click(screen.getByText("$0.34 · Incomplete"));
  const preview = screen.getByLabelText("Session vehicle cost preview");
  expect(within(preview).getByText("$0.00")).toBeInTheDocument();
  expect(within(preview).getByText("Not configured")).toBeInTheDocument();
  expect(within(preview).getByText("Incomplete")).toBeInTheDocument();
  expect(within(preview).getAllByText("$0.34")).toHaveLength(2);
});

it("initializes confirmed history, displays correct attribution, and saves optional vehicle estimates", async () => {
  const user = userEvent.setup(); vi.mocked(api.getEconomics).mockResolvedValue({ data: null, historicalMileage: [] });
  vi.mocked(api.initializeEconomics).mockImplementation(async () => { vi.mocked(api.getEconomics).mockResolvedValue(initialized); return initialized; });
  mount(); await screen.findByText("No Uber Eats sessions recorded.");
  await user.click(screen.getByText("Tesla Model Y — Vehicle Economics", { exact: true }));
  await user.click(screen.getByRole("button", { name: "Initialize Missing Confirmed Records" }));
  expect(await screen.findByText("42.97%")).toBeInTheDocument(); expect(screen.getByText("20.00%")).toBeInTheDocument();
  expect(screen.getByText("$0.00/mi")).toBeInTheDocument(); expect(screen.getByText("$1,600.00")).toBeInTheDocument();
  expect(screen.getAllByText("Realtor: 0", { exact: false })).toHaveLength(2);
  await user.click(screen.getByRole("button", { name: "Edit Vehicle Settings" }));
  expect(screen.getByLabelText("Expected Tire Set Life (mi)")).toHaveValue(null);
  expect(screen.getByLabelText("Marginal Mileage Depreciation ($/mi)")).toHaveValue(null);
  await user.type(screen.getByLabelText("Expected Tire Set Life (mi)"), "0");
  await user.click(screen.getByRole("button", { name: "Save Vehicle Settings" })); expect(screen.getByRole("alert")).toHaveTextContent("positive tire lifespan");
  await user.clear(screen.getByLabelText("Expected Tire Set Life (mi)")); await user.type(screen.getByLabelText("Expected Tire Set Life (mi)"), "32000");
  await user.type(screen.getByLabelText("Marginal Mileage Depreciation ($/mi)"), "0");
  vi.mocked(api.saveVehicleProfile).mockResolvedValue(initialized);
  await user.click(screen.getByRole("button", { name: "Save Vehicle Settings" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.saveVehicleProfile).toHaveBeenCalledWith({ energyCashCostPerMile: 0, tireReplacementSetCost: 1600, expectedTireSetLifeMiles: 32000, marginalDepreciationCostPerMile: 0 });
});

it("creates annual mileage with unknown non-Uber categories and edits known history", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("No Uber Eats sessions recorded.");
  await user.click(screen.getByText("Tesla Model Y — Vehicle Economics", { exact: true }));
  await user.click(screen.getByRole("button", { name: /Add Annual Mileage/ }));
  for (const [label, value] of [["Tax Year *", "2026"], ["Total Vehicle Miles *", "1000"], ["Uber Eats Business Miles *", "400"]]) await user.type(screen.getByLabelText(label), value);
  vi.mocked(api.saveAnnualMileage).mockResolvedValue({ data: annual(2024) });
  await user.click(screen.getByRole("button", { name: "Save Annual Mileage" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(api.saveAnnualMileage).toHaveBeenCalledWith(2026, { totalVehicleMiles: 1000, uberEatsBusinessMiles: 400, taxMethod: "standard_mileage" });
  await user.click(screen.getByRole("button", { name: "Edit annual mileage 2024" }));
  expect(screen.getByLabelText("Realtor Business Miles")).toHaveValue(0);
  await user.clear(screen.getByLabelText("Uber Eats Business Miles *")); await user.type(screen.getByLabelText("Uber Eats Business Miles *"), "6000");
  await user.click(screen.getByRole("button", { name: "Save Annual Mileage" }));
  expect(api.saveAnnualMileage).toHaveBeenLastCalledWith(2024, { totalVehicleMiles: 13350, uberEatsBusinessMiles: 6000, realtorBusinessMiles: 0, otherBusinessMiles: 0, taxMethod: "standard_mileage" });
});

it("keeps pending session saves inside the modal and sanitizes association errors", async () => {
  const user = userEvent.setup(); let fail!: (cause: unknown) => void;
  vi.mocked(api.saveSession).mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  const close = vi.fn(); render(<SessionModal session={base} merchants={merchants} onClose={close} onSaved={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByLabelText("Total Driven Miles")).toBeDisabled();
  await user.keyboard("{Escape}"); expect(close).not.toHaveBeenCalled(); expect(api.saveSession).toHaveBeenCalledOnce();
  fail(new ApiError(409)); expect(await screen.findByRole("alert")).toHaveTextContent("another session");
  expect(screen.getByRole("button", { name: "Save Session" })).toBeEnabled();
});

it("handles unavailable lists with retry", async () => {
  const user = userEvent.setup(); vi.mocked(api.listSessions).mockRejectedValueOnce(new Error("private database detail"));
  mount(); expect(await screen.findByRole("alert")).not.toHaveTextContent("private database detail");
  await user.click(screen.getByRole("button", { name: "Retry session data" }));
  await screen.findByText("No Uber Eats sessions recorded.");
});

it("preserves explicit links outside edited time bounds until they are intentionally unchecked", async () => {
  const user = userEvent.setup();
  const linked = { id: "delivery-existing", merchantId: "merchant-a", pickedUpAt: "2026-03-08T08:00:00.000Z" };
  render(<SessionModal session={{ ...base, deliveryIds: [linked.id], linkedDeliveries: [linked] }} merchants={merchants} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: "2026-03-09T09:00" } });
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: "2026-03-09T10:00" } });
  await user.click(screen.getByText(/Link Deliveries/));
  const checkbox = await screen.findByRole("checkbox"); expect(checkbox).toBeChecked();
  expect(screen.getByText(/\(existing link\)/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.not.objectContaining({ deliveryIds: expect.anything() }), base.id);
  await user.click(checkbox); await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ deliveryIds: [] }), base.id);
});
