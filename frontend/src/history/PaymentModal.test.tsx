import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentModal } from "./PaymentModal";
import { getPayment, savePayment, type EarningsAdjustment, type Reconciliation } from "./earningsApi";

vi.mock("./earningsApi", async (original) => ({ ...await original<typeof import("./earningsApi")>(), getPayment: vi.fn(), savePayment: vi.fn() }));
const legacy: EarningsAdjustment = { id: "legacy-payment", type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17 };
const observed = { engagedSeconds: 30240, engagedMiles: 38.123456, eligibleEarningsExcludingTips: 100, reportedGuaranteedAmount: 124.17 };
const result: Reconciliation = { method: "reported_guarantee", status: "matched", receivedAdjustment: 24.17, expectedAdjustment: 24.17, difference: 0, tolerance: 0.01 };
function mount(payment: EarningsAdjustment | null, reconciliation = result) {
  vi.mocked(getPayment).mockResolvedValue({ data: payment ?? legacy, reconciliation });
  vi.mocked(savePayment).mockResolvedValue({ data: payment ?? legacy, reconciliation });
  const saved = vi.fn(); render(<PaymentModal payment={payment} onClose={vi.fn()} onSaved={saved} />);
  return saved;
}
afterEach(() => vi.resetAllMocks());

it("keeps details collapsed and optional, then captures engaged time without inferring delivery values", async () => {
  const user = userEvent.setup(); const saved = mount(null);
  const summary = screen.getByText("Settlement Details (Optional)"); const details = summary.closest("details")!;
  expect(details.open).toBe(false);
  await user.click(summary); expect(details.open).toBe(true);
  expect(screen.getByText("Insufficient data")).toBeInTheDocument();
  await user.click(summary); expect(details.open).toBe(false);
  await user.click(summary);
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-10-08" } });
  for (const [label, value] of [["Amount Received *", "24.17"], ["Hours", "8"], ["Minutes", "24"], ["Seconds", "0"], ["Engaged Miles", "38.123456"], ["Eligible Earnings (Excluding Tips)", "100"], ["Uber Reported Guaranteed Amount", "124.17"]]) {
    await user.type(screen.getByLabelText(label), value);
  }
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(savePayment).toHaveBeenCalledWith({ type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17, settlementDetails: observed }, undefined);
  expect(saved).toHaveBeenCalledOnce();
});

it("backfills a legacy payment with explicit zero observations using its original identity", async () => {
  const user = userEvent.setup(); mount(legacy, { ...result, status: "insufficient_data", expectedAdjustment: null, difference: null });
  await user.click(screen.getByText("Settlement Details (Optional)"));
  expect(screen.getByLabelText("Hours")).toHaveValue(null);
  expect(await screen.findByText("Insufficient data")).toBeInTheDocument();
  for (const label of ["Seconds", "Engaged Miles", "Eligible Earnings (Excluding Tips)"]) await user.type(screen.getByLabelText(label), "0");
  await user.type(screen.getByLabelText("Uber Reported Guaranteed Amount"), "24.17");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(savePayment).toHaveBeenCalledWith(expect.objectContaining({ amount: 24.17, settlementDetails: { engagedSeconds: 0, engagedMiles: 0, eligibleEarningsExcludingTips: 0, reportedGuaranteedAmount: 24.17 } }), "legacy-payment");
});

it("prepopulates time, shows saved reconciliation, edits one field, and intentionally clears another", async () => {
  const user = userEvent.setup(); mount({ ...legacy, settlementDetails: observed });
  await user.click(screen.getByText("Settlement Details (Optional)"));
  expect(screen.getByLabelText("Hours")).toHaveValue(8);
  expect(screen.getByLabelText("Minutes")).toHaveValue(24);
  expect(screen.getByLabelText("Seconds")).toHaveValue(0);
  expect(await screen.findByText("Matched")).toBeInTheDocument();
  const reconciliation = screen.getByRole("region", { name: "Saved settlement reconciliation" });
  expect(within(reconciliation).getAllByText("$24.17")).toHaveLength(2);
  expect(within(reconciliation).getByText("$0.00")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Engaged Miles"));
  await user.clear(screen.getByLabelText("Uber Reported Guaranteed Amount"));
  await user.type(screen.getByLabelText("Uber Reported Guaranteed Amount"), "130");
  expect(screen.queryByText("Matched")).not.toBeInTheDocument();
  expect(screen.getByText(/Save changes, then reopen/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(savePayment).toHaveBeenCalledWith(expect.objectContaining({ settlementDetails: { engagedMiles: null, reportedGuaranteedAmount: 130 } }), "legacy-payment");
});

it("shows Needs review without replacing received money and allows clearing every observation", async () => {
  const user = userEvent.setup(); mount({ ...legacy, settlementDetails: observed }, { ...result, status: "mismatch", expectedAdjustment: 30, difference: -5.83 });
  await user.click(screen.getByText("Settlement Details (Optional)"));
  expect(await screen.findByText("Needs review")).toBeInTheDocument();
  expect(screen.getByLabelText("Amount Received *")).toHaveValue(24.17);
  expect(screen.getByText("-$5.83")).toBeInTheDocument();
  for (const label of ["Hours", "Minutes", "Seconds", "Engaged Miles", "Eligible Earnings (Excluding Tips)", "Uber Reported Guaranteed Amount"]) await user.clear(screen.getByLabelText(label));
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(savePayment).toHaveBeenCalledWith(expect.objectContaining({ settlementDetails: null }), "legacy-payment");
});

it("rejects invalid engaged time and settlement money before saving", async () => {
  const user = userEvent.setup(); mount(legacy);
  await user.click(screen.getByText("Settlement Details (Optional)"));
  await user.type(screen.getByLabelText("Minutes"), "60");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("alert")).toHaveTextContent("0 to 59");
  await user.clear(screen.getByLabelText("Minutes"));
  await user.type(screen.getByLabelText("Hours"), "1.5");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("alert")).toHaveTextContent("whole hours");
  await user.clear(screen.getByLabelText("Hours"));
  await user.type(screen.getByLabelText("Eligible Earnings (Excluding Tips)"), "1.001");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("alert")).toHaveTextContent("currency allows up to two");
  expect(savePayment).not.toHaveBeenCalled();
});

it("reports reconciliation load failure safely and ignores a late response after close", async () => {
  vi.mocked(getPayment).mockRejectedValueOnce(new Error("private provider detail"));
  const { unmount } = render(<PaymentModal payment={legacy} onClose={vi.fn()} onSaved={vi.fn()} />);
  await userEvent.click(screen.getByText("Settlement Details (Optional)"));
  await waitFor(() => expect(screen.getByText(/Could not load saved reconciliation/)).toBeInTheDocument());
  expect(screen.getByRole("dialog")).not.toHaveTextContent("private provider detail");
  unmount();
  let finish!: (value: { data: EarningsAdjustment; reconciliation: Reconciliation }) => void;
  vi.mocked(getPayment).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const next = render(<PaymentModal payment={legacy} onClose={vi.fn()} onSaved={vi.fn()} />);
  next.unmount(); finish({ data: legacy, reconciliation: result });
});
