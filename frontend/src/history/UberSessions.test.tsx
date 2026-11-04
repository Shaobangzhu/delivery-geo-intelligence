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
    const previous = rows.find((row) => row.id === id);
    const next = { ...(previous ?? base), ...payload, id: id ?? base.id,
      sessionDurationSeconds: (Date.parse(payload.endedAt) - Date.parse(payload.startedAt)) / 1000,
      deliveryIds: payload.deliveryIds ?? previous?.deliveryIds ?? [], linkedDeliveries: previous?.linkedDeliveries ?? [] } as DeliverySession;
    const counts = { ...previous?.tripsOfferedByPlatform, ...payload.tripsOfferedByPlatform };
    for (const platform of ["uber_eats", "doordash"] as const) if (counts[platform] === null) delete counts[platform];
    if (payload.tripsOfferedByPlatform === null || !Object.keys(counts).length) delete next.tripsOfferedByPlatform;
    else next.tripsOfferedByPlatform = counts as DeliverySession["tripsOfferedByPlatform"];
    for (const key of ["strategy", "totalDrivenMiles", "taxEligibleBusinessMiles"] as const) if (payload[key] === null) delete next[key];
    rows = [next]; return { data: next };
  });
  vi.mocked(api.deleteSession).mockImplementation(async () => { rows = []; });
});
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

it("clears stale vehicle assumptions after a failed refresh", async () => {
  const view = render(<UberSessions merchants={merchants} deliveryRevision={0} />);
  await screen.findByText("No delivery sessions recorded.");
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

it("displays minute-only Edit inputs without saving on open, rerender, or cancel", async () => {
  const close = vi.fn(), saved = vi.fn(), user = userEvent.setup();
  const view = render(<SessionModal session={base} merchants={merchants} onClose={close} onSaved={saved} />);
  for (const [label, value] of [["Session Start *", "2026-03-07T23:30"], ["Session End *", "2026-03-08T03:30"]]) {
    expect(screen.getByLabelText(label)).toHaveValue(value);
    expect(screen.getByLabelText(label)).toHaveAttribute("type", "datetime-local");
    expect(screen.getByLabelText(label)).toHaveAttribute("step", "60");
    expect(screen.getByLabelText(label)).toBeRequired();
  }
  view.rerender(<SessionModal session={base} merchants={[...merchants]} onClose={close} onSaved={saved} />);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce(); expect(saved).not.toHaveBeenCalled(); expect(api.saveSession).not.toHaveBeenCalled();
});

it("preserves untouched legacy precision and links, normalizing only explicitly edited timestamps", async () => {
  const user = userEvent.setup(), saved = vi.fn();
  const legacy = { ...base, startedAt: "2026-11-01T09:30:42.123Z", endedAt: "2026-11-01T10:30:59.456Z",
    deliveryIds: ["delivery-a"], linkedDeliveries: [{ id: "delivery-a", merchantId: "merchant-a", pickedUpAt: base.startedAt }] };
  render(<SessionModal session={legacy} merchants={merchants} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByLabelText("Session Start *")).toHaveValue("2026-11-01T01:30");
  expect(screen.getByLabelText("Session End *")).toHaveValue("2026-11-01T02:30");
  expect(screen.getByLabelText("Start clock occurrence")).toHaveValue("later");
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ startedAt: legacy.startedAt, endedAt: legacy.endedAt }), legacy.id);
  // Even a browser-emitted subminute value is reduced to the selected minute.
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: "2026-11-01T01:31:12.345" } });
  expect(screen.getByLabelText("Session Start *")).toHaveValue("2026-11-01T01:31");
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ startedAt: "2026-11-01T09:31:00.000Z", endedAt: legacy.endedAt }), legacy.id);
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: "2026-11-01T02:31:59.999" } });
  await user.selectOptions(screen.getByLabelText("Start clock occurrence"), "earlier");
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(3));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ startedAt: "2026-11-01T08:31:00.000Z", endedAt: "2026-11-01T10:31:00.000Z" }), legacy.id);
  for (const [payload] of vi.mocked(api.saveSession).mock.calls) expect(payload).not.toHaveProperty("deliveryIds");
});

it.each([
  ["", ""], ["2026-01-15T12:00", "2026-01-15T11:59"],
  ["2026-01-15T12:00", "2026-01-15T12:00"], ["2026-03-08T02:30", "2026-03-08T03:30"]
])("rejects missing, unordered, equal, or skipped-DST minute inputs (%s, %s)", async (start, end) => {
  render(<SessionModal session={null} merchants={merchants} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: start } });
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: end } });
  await userEvent.click(screen.getByRole("button", { name: "Save Session" }));
  expect(screen.getByRole("alert")).toHaveTextContent("end after start");
  expect(api.saveSession).not.toHaveBeenCalled();
});

it("creates an explicitly linked session across midnight/DST and validates independent business mileage", async () => {
  const user = userEvent.setup(); mount(); await screen.findByText("No delivery sessions recorded.");
  await user.click(screen.getByRole("button", { name: /Add Session/ }));
  const dialog = screen.getByRole("dialog", { name: "Add Session" });
  expect(screen.getByLabelText("Session Start *")).toHaveAttribute("step", "60");
  expect(screen.getByLabelText("Session End *")).toHaveAttribute("step", "60");
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
  await screen.findByText("No delivery sessions recorded."); expect(api.deleteSession).toHaveBeenCalledExactlyOnceWith(base.id);
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
  mount(); await screen.findByText("No delivery sessions recorded.");
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
  const user = userEvent.setup(); mount(); await screen.findByText("No delivery sessions recorded.");
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
  expect(screen.getByLabelText("Uber Eats — Trips Offered")).toBeDisabled();
  expect(screen.getByLabelText("DoorDash — Trips Offered")).toBeDisabled();
  fireEvent.submit(screen.getByRole("button", { name: "Saving…" }).closest("form")!);
  await user.keyboard("{Escape}"); expect(close).not.toHaveBeenCalled(); expect(api.saveSession).toHaveBeenCalledOnce();
  fail(new ApiError(409)); expect(await screen.findByRole("alert")).toHaveTextContent("another session");
  expect(screen.getByRole("button", { name: "Save Session" })).toBeEnabled();
});

it.each([
  ["unknown", "", "", undefined],
  ["Uber Eats", "3", "", { uber_eats: 3 }],
  ["DoorDash", "", "5", { doordash: 5 }],
  ["both platforms", "3", "5", { uber_eats: 3, doordash: 5 }],
  ["explicit zero", "0", "", { uber_eats: 0 }],
  ["largest safe integer", String(Number.MAX_SAFE_INTEGER), "0", { uber_eats: Number.MAX_SAFE_INTEGER, doordash: 0 }]
])("creates a zero-linked-delivery Session with %s offers and no notes", async (_name, uber, door, expected) => {
  const user = userEvent.setup(), saved = vi.fn();
  render(<SessionModal session={null} merchants={merchants} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.queryByLabelText("Session Notes")).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Uber Eats — Trips Offered")).toHaveValue(null);
  expect(screen.getByLabelText("DoorDash — Trips Offered")).toHaveValue(null);
  expect(screen.getByLabelText("Uber Eats — Trips Offered")).toHaveAccessibleDescription("Enter offers reported by each delivery platform during this session. Leave blank if unknown or not monitored. Zero means no offers were received while online.");
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: "2026-03-07T23:30" } });
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: "2026-03-08T03:30" } });
  fireEvent.change(screen.getByLabelText("Uber Eats — Trips Offered"), { target: { value: uber } });
  fireEvent.change(screen.getByLabelText("DoorDash — Trips Offered"), { target: { value: door } });
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(api.saveSession).toHaveBeenCalledExactlyOnceWith({ startedAt: base.startedAt, endedAt: base.endedAt,
    ...(expected ? { tripsOfferedByPlatform: expected } : {}) }, undefined);
  expect(api.listSessionCandidates).not.toHaveBeenCalled();
});

it.each(["Uber Eats", "DoorDash"].flatMap((platform) => ["-1", "1.5", "9007199254740992", "1e3", "1.0000000000000001"].map((value) => [platform, value])))("rejects invalid %s offers: %s", async (platform, value) => {
  const user = userEvent.setup();
  render(<SessionModal session={base} merchants={merchants} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(`${platform} — Trips Offered`), { target: { value } });
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(screen.getByRole("alert")).toHaveTextContent("nonnegative whole numbers");
  expect(api.saveSession).not.toHaveBeenCalled();
});

it.each([
  ["unchanged", "3", "5", undefined, { uber_eats: 3, doordash: 5 }],
  ["Uber Eats zero", "0", "5", { uber_eats: 0 }, { uber_eats: 0, doordash: 5 }],
  ["DoorDash update", "3", "7", { doordash: 7 }, { uber_eats: 3, doordash: 7 }],
  ["Uber Eats cleared", "", "5", { uber_eats: null }, { doordash: 5 }],
  ["DoorDash cleared", "3", "", { doordash: null }, { uber_eats: 3 }],
  ["both cleared", "", "", { uber_eats: null, doordash: null }, undefined]
])("edits %s offers with nested PATCH semantics and preserves historical notes", async (_name, uber, door, changes, expected) => {
  const user = userEvent.setup();
  rows = [{ ...base, notes: "Synthetic historical Session notes", tripsOfferedByPlatform: { uber_eats: 3, doordash: 5 } }];
  mount(); await user.click(await screen.findByRole("button", { name: "Edit session test-a" }));
  expect(screen.queryByLabelText("Session Notes")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Uber Eats — Trips Offered")).toHaveValue(3);
  expect(screen.getByLabelText("DoorDash — Trips Offered")).toHaveValue(5);
  fireEvent.change(screen.getByLabelText("Uber Eats — Trips Offered"), { target: { value: uber } });
  fireEvent.change(screen.getByLabelText("DoorDash — Trips Offered"), { target: { value: door } });
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const payload = vi.mocked(api.saveSession).mock.calls[0][0];
  expect(payload).not.toHaveProperty("notes");
  if (changes) expect(payload.tripsOfferedByPlatform).toEqual(changes);
  else expect(payload).not.toHaveProperty("tripsOfferedByPlatform");
  expect(rows[0].notes).toBe("Synthetic historical Session notes");
  expect(rows[0].tripsOfferedByPlatform).toEqual(expected);
  const expectedCounts: DeliverySession["tripsOfferedByPlatform"] = expected;
  expect(screen.getByText(`Uber Eats: ${expectedCounts?.uber_eats ?? "—"} · DoorDash: ${expectedCounts?.doordash ?? "—"}`)).toBeInTheDocument();
});

it("rejects native bad numeric input rather than treating it as a request to clear", async () => {
  const user = userEvent.setup();
  render(<SessionModal session={{ ...base, tripsOfferedByPlatform: { uber_eats: 3 } }} merchants={merchants} onClose={vi.fn()} onSaved={vi.fn()} />);
  const input = screen.getByLabelText("Uber Eats — Trips Offered");
  fireEvent.change(input, { target: { value: "" } });
  // Browsers expose incomplete/nonfinite number entry as empty with badInput;
  // jsdom does not implement that interactive validity state.
  Object.defineProperty(input, "validity", { value: { badInput: true } });
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(screen.getByRole("alert")).toHaveTextContent("nonnegative whole numbers");
  expect(api.saveSession).not.toHaveBeenCalled();
});

it("prepopulates zero without supplying an unknown platform or resending unchanged counts", async () => {
  const user = userEvent.setup();
  render(<SessionModal session={{ ...base, notes: "Synthetic legacy note", tripsOfferedByPlatform: { uber_eats: 0 } }} merchants={merchants} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByLabelText("Uber Eats — Trips Offered")).toHaveValue(0);
  expect(screen.getByLabelText("DoorDash — Trips Offered")).toHaveValue(null);
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(vi.mocked(api.saveSession).mock.calls[0][0]).not.toHaveProperty("tripsOfferedByPlatform");
  expect(vi.mocked(api.saveSession).mock.calls[0][0]).not.toHaveProperty("notes");
});

it("displays missing offer counts as unknown and keeps all Session table columns aligned", async () => {
  rows = [base, { ...base, id: "session-b", tripsOfferedByPlatform: { uber_eats: 0, doordash: 9 } },
    { ...base, id: "session-c", tripsOfferedByPlatform: { uber_eats: 3 } }];
  mount();
  expect(screen.getByText("Loading sessions…")).toHaveAttribute("colspan", "8");
  await screen.findByText("Uber Eats: — · DoorDash: —");
  expect(screen.getByText("Uber Eats: 0 · DoorDash: 9")).toBeInTheDocument();
  expect(screen.getByText("Uber Eats: 3 · DoorDash: —")).toBeInTheDocument();
  const table = screen.getByRole("columnheader", { name: "Trips Offered" }).closest("table")!;
  expect(within(table).getAllByRole("columnheader")).toHaveLength(8);
  for (const row of within(table).getAllByRole("row").slice(1)) expect(within(row).getAllByRole("cell")).toHaveLength(8);
});

it("spans the empty and unavailable Session table rows across all columns", async () => {
  const view = render(<UberSessions merchants={merchants} deliveryRevision={0} />);
  expect(await screen.findByText("No delivery sessions recorded.")).toHaveAttribute("colspan", "8");
  vi.mocked(api.listSessions).mockRejectedValue(new Error("Synthetic failure"));
  view.rerender(<UberSessions merchants={merchants} deliveryRevision={1} />);
  expect(await screen.findByText("Sessions unavailable.")).toHaveAttribute("colspan", "8");
});

it("handles unavailable lists with retry", async () => {
  const user = userEvent.setup(); vi.mocked(api.listSessions).mockRejectedValueOnce(new Error("private database detail"));
  mount(); expect(await screen.findByRole("alert")).not.toHaveTextContent("private database detail");
  await user.click(screen.getByRole("button", { name: "Retry session data" }));
  await screen.findByText("No delivery sessions recorded.");
});

it("preserves explicit links outside edited time bounds until they are intentionally unchecked", async () => {
  const user = userEvent.setup();
  const linked = { id: "delivery-existing", merchantId: "merchant-a", pickedUpAt: "2026-03-08T08:00:00.000Z" };
  render(<SessionModal session={{ ...base, notes: "Synthetic historical note", deliveryIds: [linked.id], linkedDeliveries: [linked] }} merchants={merchants} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: "2026-03-09T09:00" } });
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: "2026-03-09T10:00" } });
  await user.click(screen.getByText(/Link Deliveries/));
  const checkbox = await screen.findByRole("checkbox"); expect(checkbox).toBeChecked();
  expect(screen.getByText(/\(existing link\)/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.not.objectContaining({ deliveryIds: expect.anything() }), base.id);
  await user.click(checkbox); await user.click(screen.getByRole("button", { name: "Save Session" }));
  expect(api.saveSession).toHaveBeenLastCalledWith(expect.objectContaining({ deliveryIds: [] }), base.id);
  for (const [payload] of vi.mocked(api.saveSession).mock.calls) expect(payload).not.toHaveProperty("notes");
});

it("uses saveSession to serialize only changed platform removals without legacy notes", async () => {
  const user = userEvent.setup(), saved = vi.fn();
  const realApi = await vi.importActual<typeof import("./sessionApi")>("./sessionApi");
  vi.mocked(api.saveSession).mockImplementation(realApi.saveSession);
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: base }), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  render(<SessionModal session={{ ...base, notes: "Synthetic historical note", tripsOfferedByPlatform: { uber_eats: 3, doordash: 5 } }} merchants={merchants} onClose={vi.fn()} onSaved={saved} />);
  await user.clear(screen.getByLabelText("Uber Eats — Trips Offered"));
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe(`/api/delivery-sessions/${base.id}`);
  expect(options.method).toBe("PATCH");
  const body = JSON.parse(options.body);
  expect(body.tripsOfferedByPlatform).toEqual({ uber_eats: null });
  expect(body).not.toHaveProperty("notes");
});

const sessionPages = () => within(screen.getByRole("navigation", { name: "Delivery session pages" }));
function sessionRows(count: number): DeliverySession[] {
  return Array.from({ length: count }, (_, index) => ({ ...base, id: `session-${String(index).padStart(6, "0")}`, totalDrivenMiles: index + 1 }));
}
it.each([0, 1, 10, 11, 20, 21])("paginates %i sessions in the returned chronological order", async (count) => {
  rows = sessionRows(count); Object.freeze(rows);
  const user = userEvent.setup(); mount();
  await screen.findByText(`Showing ${count ? "1–" + Math.min(10, count) : "0"} of ${count} sessions`);
  const table = screen.getAllByRole("table")[0];
  expect(within(table).getAllByRole("row")).toHaveLength(Math.max(1, Math.min(count, 10)) + 1);
  if (count > 10) {
    await user.click(sessionPages().getByRole("button", { name: "Next page" }));
    expect(within(table).getAllByRole("row").slice(1)[0]).toHaveTextContent("11 mi");
    expect(screen.getByText(`Showing 11–${Math.min(20, count)} of ${count} sessions`)).toBeInTheDocument();
  }
  expect(api.listSessions).toHaveBeenCalledTimes(1); expect(api.getEconomics).toHaveBeenCalledTimes(1);
  expect(rows.map((row) => row.totalDrivenMiles)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
  expect(screen.getByRole("navigation", { name: "Delivery session pages" }).closest(".table-scroll")).toBeNull();
});

it("preserves session page through edits and economics refresh, clamps deletion, and resets creation", async () => {
  rows = sessionRows(21);
  vi.mocked(api.saveSession).mockImplementation(async (payload, id) => {
    const next = { ...base, ...payload, id: id ?? "session-new", sessionDurationSeconds: 10800 } as DeliverySession;
    rows = id ? rows.map((row) => row.id === id ? next : row) : [next, ...rows];
    return { data: next };
  });
  vi.mocked(api.deleteSession).mockImplementation(async (id) => { rows = rows.filter((row) => row.id !== id); });
  const user = userEvent.setup(); const view = render(<UberSessions merchants={merchants} deliveryRevision={0} />);
  await screen.findByText("Showing 1–10 of 21 sessions");
  await user.click(sessionPages().getByRole("button", { name: "Page 3" }));
  await user.click(screen.getByRole("button", { name: "Edit session 000020" }));
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await screen.findByText("Showing 21–21 of 21 sessions");
  expect(sessionPages().getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByText("Tesla Model Y — Vehicle Economics"));
  await user.click(screen.getByRole("button", { name: "Initialize Missing Confirmed Records" }));
  await screen.findByText("Showing 21–21 of 21 sessions");
  expect(api.initializeEconomics).toHaveBeenCalledTimes(1);
  view.rerender(<UberSessions merchants={merchants} deliveryRevision={1} />);
  await screen.findByText("Showing 21–21 of 21 sessions");
  await user.click(screen.getByRole("button", { name: "Delete session 000020" }));
  await user.click(screen.getByRole("button", { name: "Delete Session" }));
  await screen.findByText("Showing 11–20 of 20 sessions");
  expect(sessionPages().getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: /Add Session/ }));
  fireEvent.change(screen.getByLabelText("Session Start *"), { target: { value: "2026-11-01T12:00" } });
  fireEvent.change(screen.getByLabelText("Session End *"), { target: { value: "2026-11-01T13:00" } });
  await user.click(screen.getByRole("button", { name: "Save Session" }));
  await screen.findByText("Showing 1–10 of 21 sessions");
  expect(sessionPages().getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
});

it("hides session pagination on pending and failed refreshes, preserving a valid page for retry", async () => {
  rows = sessionRows(21); const user = userEvent.setup();
  const view = render(<UberSessions merchants={merchants} deliveryRevision={0} />);
  expect(screen.getByText("Loading sessions…")).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Delivery session pages" })).not.toBeInTheDocument();
  await screen.findByText("Showing 1–10 of 21 sessions");
  await user.click(sessionPages().getByRole("button", { name: "Page 3" }));
  vi.mocked(api.listSessions).mockRejectedValueOnce(new Error("failed"));
  view.rerender(<UberSessions merchants={merchants} deliveryRevision={1} />);
  await screen.findByText("Sessions unavailable.");
  expect(screen.queryByRole("navigation", { name: "Delivery session pages" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retry session data" }));
  await screen.findByText("Showing 21–21 of 21 sessions");
});
