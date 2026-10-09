import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PaymentModal } from "./PaymentModal";
import type { EarningsAdjustment } from "./earningsApi";

const label = "I have recorded all Uber Eats deliveries and sessions for this settlement period.";
const payment: EarningsAdjustment = { id: "synthetic-payment", type: "prop22_guarantee", paymentDate: "2026-03-20", amount: 24.17,
  coverageStartDate: "2026-03-01", coverageEndDate: "2026-03-14" };
afterEach(() => vi.unstubAllGlobals());
function requests() {
  const mock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 200,
    json: async () => ({ data: payment, reconciliation: { status: "matched", expectedAdjustment: 24.17, receivedAdjustment: 24.17, difference: 0 } }) }));
  vi.stubGlobal("fetch", mock); return mock;
}
it("legacy metadata is unchecked and manual confirmation is sent without changing received amount", async () => {
  const mock = requests(), saved = vi.fn(), user = userEvent.setup();
  render(<PaymentModal payment={payment} onClose={vi.fn()} onSaved={saved} />);
  const checkbox = screen.getByRole("checkbox", { name: label }); expect(checkbox).not.toBeChecked();
  await user.click(checkbox); expect(checkbox).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Save Payment" })); await waitFor(() => expect(saved).toHaveBeenCalled());
  const payload = JSON.parse(String(mock.mock.calls.find(([, init]) => init?.method === "PATCH")![1]?.body));
  expect(payload.sessionCoverageConfirmed).toBe(true); expect(payload.amount).toBe(24.17); expect(payload).not.toHaveProperty("settlementDetails");
});
it("existing confirmation can be cleared explicitly and does not require changed reconciliation observations", async () => {
  const mock = requests(), saved = vi.fn(), user = userEvent.setup();
  render(<PaymentModal payment={{ ...payment, sessionCoverageConfirmed: true }} onClose={vi.fn()} onSaved={saved} />);
  expect(screen.getByRole("checkbox", { name: label })).toBeChecked(); await user.click(screen.getByRole("checkbox", { name: label }));
  await user.click(screen.getByRole("button", { name: "Save Payment" })); await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(String(mock.mock.calls.find(([, init]) => init?.method === "PATCH")![1]?.body)).sessionCoverageConfirmed).toBe(false);
});
