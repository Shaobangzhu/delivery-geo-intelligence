import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { History } from "../pages/History";
import type { EarningsAdjustment } from "./earningsApi";

function install() {
  let rows: EarningsAdjustment[] = [];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let data: unknown;
    if (url === "/api/merchants") data = { data: [] };
    else if (url.startsWith("/api/deliveries")) data = { data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } };
    else if (method === "GET") data = url === "/api/earnings-adjustments" ? { data: rows } : { data: rows[0], reconciliation: { status: "insufficient_data", expectedAdjustment: null, difference: null } };
    else if (method === "DELETE") { rows = []; return { ok: true, status: 204 } as Response; }
    else {
      const payload = JSON.parse(String(init?.body));
      rows = [{ ...payload, id: "payment-a" }]; data = { data: rows[0] };
    }
    return { ok: true, status: 200, json: async () => data } as Response;
  });
  vi.stubGlobal("fetch", mock); return mock;
}
afterEach(() => vi.unstubAllGlobals());

it("captures, displays, edits, and confirms deletion of independent Prop 22 payments", async () => {
  const user = userEvent.setup(); const mock = install(); render(<History />);
  await screen.findByText("No Prop 22 payments recorded.");
  expect(screen.getByRole("button", { name: /Add Delivery/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Add Prop 22 Payment/ }));
  const dialog = screen.getByRole("dialog", { name: "Add Prop 22 Payment" });
  expect(screen.getByLabelText("Payment Date *")).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a payment date");
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-10-08" } });
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(mock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  await user.type(screen.getByLabelText("Amount Received *"), "24.17");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const section = screen.getByRole("heading", { name: "Prop 22 Payments" }).closest("section")!;
  expect(within(section).getByText("$24.17")).toBeInTheDocument();
  expect(within(section).getByText("—")).toBeInTheDocument();
  const post = mock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(post[1]?.body))).toEqual({ type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17 });
  await user.click(screen.getByRole("button", { name: "Edit Prop 22 payment 2026-10-08" }));
  expect(screen.getByLabelText("Amount Received *")).toHaveValue(24.17);
  await user.clear(screen.getByLabelText("Amount Received *")); await user.type(screen.getByLabelText("Amount Received *"), "25");
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-10-09" } });
  fireEvent.change(screen.getByLabelText("Coverage Start Date"), { target: { value: "2026-09-21" } });
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Supply both coverage dates");
  fireEvent.change(screen.getByLabelText("Coverage End Date"), { target: { value: "2026-09-20" } });
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Supply both coverage dates");
  fireEvent.change(screen.getByLabelText("Coverage End Date"), { target: { value: "2026-10-04" } });
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(within(section).getByText("Sep 21, 2026 – Oct 4, 2026")).toBeInTheDocument();
  expect(within(section).getByText("$25.00")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete Prop 22 payment 2026-10-09" }));
  expect(screen.getByRole("dialog", { name: "Delete Prop 22 payment?" })).toBeInTheDocument();
  expect(mock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Delete Prop 22 payment 2026-10-09" }));
  await user.click(screen.getByRole("button", { name: "Delete Payment" }));
  await screen.findByText("No Prop 22 payments recorded.");
  expect(mock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
});

it("keeps a payment modal pending, prevents duplicate saves, and shows a safe failure", async () => {
  const user = userEvent.setup(); let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const mock = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST" ? pending : ({ ok: true, status: 200, json: async () => ({ data: [], pagination: { page: 1, total: 0, totalPages: 0 } }) } as Response));
  vi.stubGlobal("fetch", mock); render(<History />);
  await user.click(screen.getByRole("button", { name: /Add Prop 22 Payment/ }));
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-10-08" } });
  await user.type(screen.getByLabelText("Amount Received *"), "10");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(screen.getByLabelText("Payment Date *")).toBeDisabled();
  await user.keyboard("{Escape}"); expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(mock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  finish({ ok: false, status: 500, json: async () => ({ error: "Private server detail" }) } as Response);
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save or load");
  expect(screen.getByRole("dialog")).not.toHaveTextContent("Private server detail");
});
