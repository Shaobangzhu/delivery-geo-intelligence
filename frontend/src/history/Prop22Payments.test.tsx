import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Prop22Payments } from "./Prop22Payments";
import { History } from "../pages/History";
import type { EarningsAdjustment } from "./earningsApi";

function install(initialRows: EarningsAdjustment[] = []) {
  let rows = [...initialRows];
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    let data: unknown;
    if (url === "/api/uber-annual-summaries") data = { data: [], limit: 20, hasMore: false };
    else if (url === "/api/merchants") data = { data: [] };
    else if (url === "/api/delivery-sessions") data = { data: [] };
    else if (url === "/api/vehicle-economics") data = { data: null, historicalMileage: [] };
    else if (url.startsWith("/api/deliveries")) data = { data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } };
    else if (method === "GET") data = url.startsWith("/api/earnings-adjustments/") ? { data: rows[0], reconciliation: { status: "insufficient_data", expectedAdjustment: null, difference: null } } : { data: rows.filter((row) => !url.includes("?platform=") || row.platform === new URL(url, "http://test").searchParams.get("platform")) };
    else if (method === "DELETE") { rows = rows.filter((row) => row.id !== url.split("/").at(-1)); return { ok: true, status: 204 } as Response; }
    else {
      const payload = JSON.parse(String(init?.body));
      const id = method === "PATCH" ? url.split("/").at(-1)! : "payment-a";
      const next = { ...payload, id };
      rows = method === "PATCH" ? rows.map((row) => row.id === id ? next : row) : [next, ...rows]; data = { data: next };
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
  await user.selectOptions(screen.getByLabelText("Payment Platform *"), "uber_eats");
  await user.type(screen.getByLabelText("Amount Received *"), "24.17");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const section = screen.getByRole("heading", { name: "Prop 22 Payments" }).closest("section")!;
  expect(within(section).getByText("$24.17")).toBeInTheDocument();
  expect(within(section).getByText("—")).toBeInTheDocument();
  const post = mock.mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(JSON.parse(String(post[1]?.body))).toEqual({ platform: "uber_eats", type: "prop22_guarantee", paymentDate: "2026-10-08", amount: 24.17 });
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
  const mock = vi.fn(async (url: string, init?: RequestInit) => init?.method === "POST" ? pending : ({ ok: true, status: 200, json: async () => url === "/api/uber-annual-summaries" ? { data: [], limit: 20, hasMore: false } : url === "/api/vehicle-economics" ? { data: null, historicalMileage: [] } : ({ data: [], pagination: { page: 1, total: 0, totalPages: 0 } }) } as Response));
  vi.stubGlobal("fetch", mock); render(<History />);
  await user.click(screen.getByRole("button", { name: /Add Prop 22 Payment/ }));
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-10-08" } });
  await user.selectOptions(screen.getByLabelText("Payment Platform *"), "uber_eats");
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

function paymentRows(count: number): EarningsAdjustment[] {
  return Array.from({ length: count }, (_, index) => ({ id: `payment-${index}`, platform: index < 11 ? "uber_eats" : "doordash", type: "prop22_guarantee", paymentDate: `2026-10-${String(31 - index).padStart(2, "0")}`, amount: index + 1 }));
}
const paymentPages = () => within(screen.getByRole("navigation", { name: "Prop 22 payment pages" }));

it.each([0, 1, 10, 11, 20, 21])("paginates %i payments without changing the source order", async (count) => {
  const rows = paymentRows(count); const mock = install(Object.freeze(rows) as unknown as EarningsAdjustment[]);
  const user = userEvent.setup(); render(<History />);
  await screen.findByText(`Showing ${count ? "1–" + Math.min(10, count) : "0"} of ${count} payments`);
  const table = screen.getByRole("heading", { name: "Prop 22 Payments" }).closest("section")!.querySelector("table")!;
  expect(within(table).getAllByRole("row")).toHaveLength(Math.max(1, Math.min(count, 10)) + 1);
  const requests = mock.mock.calls.length;
  if (count > 10) {
    await user.click(paymentPages().getByRole("button", { name: "Next page" }));
    expect(within(table).getAllByRole("row").slice(1)[0]).toHaveTextContent("$11.00");
    expect(screen.getByText(`Showing 11–${Math.min(20, count)} of ${count} payments`)).toBeInTheDocument();
  }
  expect(mock).toHaveBeenCalledTimes(requests);
  expect(rows.map((row) => row.amount)).toEqual(Array.from({ length: count }, (_, index) => index + 1));
  expect(screen.getByRole("navigation", { name: "Prop 22 payment pages" }).closest(".table-scroll")).toBeNull();
});

it("resets payment pages for the platform filter and leaves delivery pagination alone", async () => {
  install(paymentRows(21)); const user = userEvent.setup(); render(<History />);
  await screen.findByText("Showing 1–10 of 21 payments");
  await user.click(paymentPages().getByRole("button", { name: "Page 3" }));
  await user.selectOptions(screen.getByLabelText("Payment Platform"), "uber_eats");
  await screen.findByText("Showing 1–10 of 11 payments");
  expect(paymentPages().getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await user.click(paymentPages().getByRole("button", { name: "Page 2" }));
  await user.selectOptions(screen.getByLabelText("Payment Platform"), "doordash");
  await screen.findByText("Showing 1–10 of 10 payments");
  expect(screen.getByText("Showing 0 of 0 deliveries")).toBeInTheDocument();
});

it("preserves payment page after saving, clamps after last-page deletion, and resets after creation", async () => {
  install(paymentRows(21)); const user = userEvent.setup(); render(<History />);
  await screen.findByText("Showing 1–10 of 21 payments");
  await user.click(paymentPages().getByRole("button", { name: "Page 3" }));
  await user.click(screen.getByRole("button", { name: "Edit Prop 22 payment 2026-10-11" }));
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  await screen.findByText("Showing 21–21 of 21 payments");
  expect(paymentPages().getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: "Delete Prop 22 payment 2026-10-11" }));
  await user.click(screen.getByRole("button", { name: "Delete Payment" }));
  await screen.findByText("Showing 11–20 of 20 payments");
  expect(paymentPages().getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getByRole("button", { name: /Add Prop 22 Payment/ }));
  fireEvent.change(screen.getByLabelText("Payment Date *"), { target: { value: "2026-11-01" } });
  await user.selectOptions(screen.getByLabelText("Payment Platform *"), "uber_eats");
  await user.type(screen.getByLabelText("Amount Received *"), "50");
  await user.click(screen.getByRole("button", { name: "Save Payment" }));
  await screen.findByText("Showing 1–10 of 21 payments");
  expect(paymentPages().getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
});

it("hides payment pagination while loading or unavailable and resets safely on a new filter", async () => {
  const rows = paymentRows(21);
  const mock = vi.fn(async () => ({ ok: true, json: async () => ({ data: rows }) }));
  vi.stubGlobal("fetch", mock); const user = userEvent.setup();
  render(<Prop22Payments adding={false} onCloseAdd={vi.fn()} />);
  expect(screen.getByText("Loading payments…")).toBeInTheDocument();
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  await screen.findByText("Showing 1–10 of 21 payments");
  await user.click(paymentPages().getByRole("button", { name: "Page 3" }));
  mock.mockRejectedValueOnce(new Error("failed"));
  await user.selectOptions(screen.getByLabelText("Payment Platform"), "doordash");
  await screen.findByText("Payments unavailable.");
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Payment Platform"), "");
  await screen.findByText("Showing 1–10 of 21 payments");
});
