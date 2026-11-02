import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeliveryModal } from "./DeliveryModal";
import { PaymentModal } from "./PaymentModal";
import { Prop22Payments } from "./Prop22Payments";
import type { DeliveryPlatform } from "./platform";

const merchant = { id: "merchant", name: "Synthetic Pickup", category: "restaurant" as const, city: "Test" };
const delivery = { id: "legacy", merchantId: merchant.id, pickedUpAt: "2026-03-08T17:00:00Z", payout: 0, distanceMiles: 2, deliveryDurationSeconds: 60, notes: "preserved note", hasDestinationLocation: true };
const payment = { id: "legacy", type: "prop22_guarantee" as const, paymentDate: "2026-03-20", amount: 24.17, notes: "payment note", sessionCoverageConfirmed: true,
  settlementDetails: { engagedMiles: 0, eligibleEarningsExcludingTips: 100, reportedGuaranteedAmount: 124.17 } };
function api() {
  const mock = vi.fn(async (_path: string, _init?: RequestInit) => ({ ok: true, status: 200, json: async () => ({ data: payment, reconciliation: { status: "matched" } }) }));
  vi.stubGlobal("fetch", mock); return mock;
}
function payload(mock: ReturnType<typeof api>) { return JSON.parse(String(mock.mock.calls.find(([, init]) => init?.body)?.[1]?.body)); }
afterEach(() => vi.unstubAllGlobals());

it.each<DeliveryPlatform>(["uber_eats", "doordash"])("requires explicit new Delivery platform and serializes %s without notes", async (platform) => {
  const mock = api(), user = userEvent.setup();
  render(<DeliveryModal delivery={null} merchants={[merchant]} onClose={vi.fn()} onSaved={vi.fn()} />);
  const select = screen.getByLabelText("Delivery Platform *"); expect(select).toHaveValue("");
  expect(screen.queryByLabelText("Optional Notes")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText(/Merchant/), merchant.id);
  fireEvent.change(screen.getByLabelText(/Pickup Date/), { target: { value: "2026-03-08T11:00" } });
  await user.type(screen.getByLabelText(/Destination Address/), "Synthetic destination zone A");
  await user.click(screen.getByRole("button", { name: "Save Delivery" }));
  expect(mock).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toBeInTheDocument();
  await user.selectOptions(select, platform); await user.click(screen.getByRole("button", { name: "Save Delivery" }));
  expect(payload(mock)).toMatchObject({ platform, merchantId: merchant.id }); expect(payload(mock)).not.toHaveProperty("notes");
});
it("edits legacy Delivery without backfill, then allows platform correction with fields preserved", async () => {
  const mock = api(), user = userEvent.setup();
  const view = render(<DeliveryModal delivery={delivery} merchants={[merchant]} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole("option", { name: "Unknown" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(payload(mock)).not.toHaveProperty("platform"); expect(payload(mock)).not.toHaveProperty("notes");
  mock.mockClear(); await user.selectOptions(screen.getByLabelText("Delivery Platform"), "doordash");
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  expect(payload(mock)).toMatchObject({ platform: "doordash", payout: 0, distanceMiles: 2, deliveryDurationSeconds: 60 });
  view.unmount(); render(<DeliveryModal delivery={{ ...delivery, platform: "uber_eats" }} merchants={[merchant]} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByLabelText("Delivery Platform")).toHaveValue("uber_eats");
});
it.each<DeliveryPlatform>(["uber_eats", "doordash"])("requires explicit new Payment platform and supports %s", async (platform) => {
  const mock = api(), user = userEvent.setup(); render(<PaymentModal payment={null} onClose={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-03-20" } });
  await user.type(screen.getByLabelText("Amount Received *"), "24.17");
  await user.click(screen.getByRole("button", { name: "Save Payment" })); expect(mock).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Select a platform");
  await user.selectOptions(screen.getByLabelText("Payment Platform *"), platform);
  await user.type(screen.getByLabelText("Optional Notes"), "payment note");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(payload(mock)).toMatchObject({ platform, notes: "payment note", amount: 24.17 });
});
it("clears confirmation on Payment reassignment while preserving official observations and notes", async () => {
  const mock = api(), user = userEvent.setup(); render(<PaymentModal payment={{ ...payment, platform: "uber_eats" }} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole("checkbox")).toBeChecked();
  await user.selectOptions(screen.getByLabelText("Payment Platform"), "doordash");
  expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByRole("status")).toHaveTextContent("statement values are preserved");
  await user.click(screen.getByText("Settlement Details (Optional)"));
  expect(screen.getByLabelText("DoorDash Reported Guaranteed Amount")).toHaveValue(124.17);
  expect(screen.getByLabelText("Engaged Miles")).toHaveValue(0);
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(payload(mock)).toMatchObject({ platform: "doordash", sessionCoverageConfirmed: false, notes: "payment note", amount: 24.17 });
  expect(payload(mock)).not.toHaveProperty("settlementDetails");
});
it("legacy Payment confirmation is unavailable and unrelated edits omit platform", async () => {
  const mock = api(), user = userEvent.setup(); render(<PaymentModal payment={payment} onClose={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(screen.getByRole("checkbox")).toBeDisabled();
  expect(screen.getByText(/Previous confirmation does not verify/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(payload(mock)).not.toHaveProperty("platform"); expect(payload(mock)).not.toHaveProperty("sessionCoverageConfirmed");
});
it("Payment platform filter cancels stale requests independently and displays all platform labels", async () => {
  let resolve!: (value: unknown) => void;
  const mock = vi.fn().mockImplementationOnce(() => new Promise((r) => { resolve = r; })).mockResolvedValue({ ok: true, json: async () => ({ data: [
    { ...payment, id: "u", platform: "uber_eats" }, { ...payment, id: "d", platform: "doordash" }, payment
  ] }) });
  vi.stubGlobal("fetch", mock); const user = userEvent.setup(); render(<Prop22Payments adding={false} onCloseAdd={vi.fn()} />);
  await user.selectOptions(screen.getByLabelText("Payment Platform"), "unknown");
  await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
  const table = screen.getByRole("table"); for (const label of ["Uber Eats", "DoorDash", "Unknown"]) expect(within(table).getByText(label)).toBeInTheDocument();
  expect(mock.mock.calls[1][0]).toBe("/api/earnings-adjustments?platform=unknown");
  expect(mock.mock.calls[0][1].signal.aborted).toBe(true);
  resolve({ ok: true, json: async () => ({ data: [] }) });
  await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(4));
});
