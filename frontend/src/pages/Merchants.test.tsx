import { afterEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Merchants } from "./Merchants";
import type { MerchantInput, MerchantRecord } from "../merchants/api";

const initial: MerchantRecord[] = [
  { id: "merchant-a", name: "Starbucks", category: "restaurant", city: "Test City", publicAddress: "Public Business A", location: { type: "Point", coordinates: [1, 2] }, deliveryCount: 3 },
  { id: "merchant-b", name: "Starbucks", category: "restaurant", city: "Test City", publicAddress: "Public Business B", location: { type: "Point", coordinates: [3, 4] }, deliveryCount: 0 },
  { id: "merchant-c", name: "CVS", category: "retail", city: "Other City", publicAddress: "Public Business C", location: { type: "Point", coordinates: [5, 6] }, deliveryCount: 0 }
];

function reply(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function installApi(options: {
  records?: MerchantRecord[];
  post?: (payload: MerchantInput) => Promise<Response> | Response;
  patch?: (payload: Partial<MerchantInput>) => Promise<Response> | Response;
  delete?: (id: string) => Promise<Response> | Response;
} = {}) {
  let records = [...(options.records ?? initial)];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/merchants" && method === "GET") return reply({ data: records });
    if (url.pathname === "/api/merchants" && method === "POST") {
      const payload = JSON.parse(String(init?.body)) as MerchantInput;
      if (options.post) return options.post(payload);
      const created: MerchantRecord = { ...payload, id: "merchant-new", location: { type: "Point", coordinates: [7, 8] }, deliveryCount: 0 };
      records = [...records, created];
      return reply({ data: created }, 201);
    }
    const id = url.pathname.split("/").at(-1)!;
    if (url.pathname.startsWith("/api/merchants/") && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as Partial<MerchantInput>;
      if (options.patch) return options.patch(payload);
      records = records.map((item) => item.id === id ? { ...item, ...payload } : item);
      return reply({ data: records.find((item) => item.id === id) });
    }
    if (url.pathname.startsWith("/api/merchants/") && method === "DELETE") {
      if (options.delete) return options.delete(id);
      const target = records.find((item) => item.id === id);
      if (target?.deliveryCount) return reply({ error: "Merchant has delivery history and cannot be deleted" }, 409);
      records = records.filter((item) => item.id !== id);
      return reply(null, 204);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function calls(fetchMock: ReturnType<typeof vi.fn>, method: string) {
  return fetchMock.mock.calls.filter(([, init]) => (init?.method ?? "GET") === method);
}

afterEach(() => vi.unstubAllGlobals());

it("loads separate same-name physical locations and filters by search and category", async () => {
  const user = userEvent.setup();
  installApi();
  render(<Merchants />);
  expect(await screen.findByText("Showing 3 of 3 physical merchants")).toBeInTheDocument();
  expect(screen.getAllByText("Starbucks")).toHaveLength(2);
  expect(screen.getByText("Public Business A")).toBeInTheDocument();
  expect(screen.getByText("Public Business B")).toBeInTheDocument();
  await user.type(screen.getByLabelText("Search merchant"), "Business B");
  expect(screen.getByText("Showing 1 of 3 physical merchants")).toBeInTheDocument();
  expect(screen.getByText("Public Business B")).toBeInTheDocument();
  await user.clear(screen.getByLabelText("Search merchant"));
  await user.selectOptions(screen.getByLabelText("Category"), "retail");
  expect(screen.getByText("CVS")).toBeInTheDocument();
  expect(screen.queryByText("Starbucks")).not.toBeInTheDocument();
});

it("opens an accessible centered modal, validates required fields, and closes on Escape", async () => {
  const user = userEvent.setup();
  const fetchMock = installApi();
  render(<Merchants />);
  await screen.findByText("Public Business A");
  const trigger = screen.getByRole("button", { name: /Add Merchant/ });
  await user.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Add Merchant" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(within(dialog).getByLabelText(/Merchant Name/)).toHaveFocus();
  expect(within(dialog).queryByLabelText(/latitude|longitude/i)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Save Merchant" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Complete the required fields");
  expect(calls(fetchMock, "POST")).toHaveLength(0);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
});

it("creates a merchant from a public address and refreshes the list", async () => {
  const user = userEvent.setup();
  const fetchMock = installApi();
  render(<Merchants />);
  await screen.findByText("Public Business A");
  await user.click(screen.getByRole("button", { name: /Add Merchant/ }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/Merchant Name/), "Albertsons");
  await user.selectOptions(within(dialog).getByLabelText(/Category/), "grocery");
  await user.type(within(dialog).getByLabelText(/City/), "Test City");
  await user.type(within(dialog).getByLabelText(/Public Business Address/), "Public Business D");
  await user.click(within(dialog).getByRole("button", { name: "Save Merchant" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("Albertsons")).toBeInTheDocument();
  const payload = JSON.parse(String(calls(fetchMock, "POST")[0][1]?.body));
  expect(payload).toEqual({ name: "Albertsons", category: "grocery", city: "Test City", publicAddress: "Public Business D" });
  expect(payload).not.toHaveProperty("location");
});

it("prevents duplicate saves and shows a safe geocoding failure", async () => {
  const user = userEvent.setup();
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const fetchMock = installApi({ post: () => pending });
  render(<Merchants />);
  await screen.findByText("Public Business A");
  await user.click(screen.getByRole("button", { name: /Add Merchant/ }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/Merchant Name/), "Albertsons");
  await user.selectOptions(within(dialog).getByLabelText(/Category/), "grocery");
  await user.type(within(dialog).getByLabelText(/City/), "Test City");
  await user.type(within(dialog).getByLabelText(/Public Business Address/), "Public Business D");
  await user.click(within(dialog).getByRole("button", { name: "Save Merchant" }));
  expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled();
  expect(calls(fetchMock, "POST")).toHaveLength(1);
  finish(reply({ error: "Merchant geocoding failed", code: "no_match" }, 422));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("No business address match was found");
  expect(within(dialog).getByLabelText(/Public Business Address/)).toHaveValue("Public Business D");
});

it("shows a generic server error without provider details", async () => {
  const user = userEvent.setup();
  installApi({ post: () => reply({ error: "private provider detail" }, 500) });
  render(<Merchants />);
  await screen.findByText("Public Business A");
  await user.click(screen.getByRole("button", { name: /Add Merchant/ }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText(/Merchant Name/), "CVS");
  await user.selectOptions(within(dialog).getByLabelText(/Category/), "retail");
  await user.type(within(dialog).getByLabelText(/City/), "Test City");
  await user.type(within(dialog).getByLabelText(/Public Business Address/), "Public Business D");
  await user.click(within(dialog).getByRole("button", { name: "Save Merchant" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("The server could not complete the request.");
  expect(dialog).not.toHaveTextContent("private provider detail");
});

it("preserves location when editing metadata and warns before changing an address with history", async () => {
  const user = userEvent.setup();
  const fetchMock = installApi();
  render(<Merchants />);
  await screen.findByText("Public Business A");
  await user.click(screen.getByRole("button", { name: "Edit Starbucks at Public Business A" }));
  const dialog = screen.getByRole("dialog", { name: "Edit Merchant" });
  await user.clear(within(dialog).getByLabelText(/Merchant Name/));
  await user.type(within(dialog).getByLabelText(/Merchant Name/), "Starbucks Updated");
  expect(within(dialog).queryByText(/Changing this address/)).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(JSON.parse(String(calls(fetchMock, "PATCH")[0][1]?.body))).not.toHaveProperty("publicAddress");
  await user.click(screen.getByRole("button", { name: "Edit Starbucks Updated at Public Business A" }));
  const edit = screen.getByRole("dialog");
  fireEvent.change(within(edit).getByLabelText(/Public Business Address/), { target: { value: "Corrected Public Address" } });
  expect(within(edit).getByText(/Changing this address updates the pickup location associated with existing delivery history/)).toBeInTheDocument();
  await user.click(within(edit).getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(JSON.parse(String(calls(fetchMock, "PATCH").at(-1)?.[1]?.body)).publicAddress).toBe("Corrected Public Address");
});

it("confirms deletion for unused merchants and explains why referenced merchants stay", async () => {
  const user = userEvent.setup();
  const fetchMock = installApi();
  render(<Merchants />);
  await screen.findByText("Public Business A");
  await user.click(screen.getByRole("button", { name: "Delete Starbucks at Public Business A" }));
  const blocked = screen.getByRole("dialog", { name: "Delete merchant?" });
  expect(within(blocked).getByText(/has delivery history and cannot be deleted/)).toBeInTheDocument();
  expect(within(blocked).queryByRole("button", { name: "Delete Merchant" })).not.toBeInTheDocument();
  await user.click(within(blocked).getByRole("button", { name: "Close" }));
  expect(calls(fetchMock, "DELETE")).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "Delete Starbucks at Public Business B" }));
  const confirm = screen.getByRole("dialog", { name: "Delete merchant?" });
  expect(within(confirm).getByText(/cannot be undone/)).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Delete Merchant" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(await screen.findByText("Showing 2 of 2 physical merchants")).toBeInTheDocument();
  expect(calls(fetchMock, "DELETE")).toHaveLength(1);
});

it("honors a backend 409 if history appears after the list loaded", async () => {
  const user = userEvent.setup();
  installApi({ delete: () => reply({ error: "Merchant has delivery history and cannot be deleted" }, 409) });
  render(<Merchants />);
  await screen.findByText("Public Business B");
  await user.click(screen.getByRole("button", { name: "Delete Starbucks at Public Business B" }));
  await user.click(screen.getByRole("button", { name: "Delete Merchant" }));
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("has delivery history and cannot be deleted");
  expect(within(dialog).queryByRole("button", { name: "Delete Merchant" })).not.toBeInTheDocument();
});

it("shows older records without inventing a public address and preserves their point on metadata edits", async () => {
  const user = userEvent.setup();
  const legacy: MerchantRecord = { id: "legacy-id", name: "Legacy Pickup", category: "other", city: "Test City",
    location: { type: "Point", coordinates: [1, 2] }, deliveryCount: 1 };
  const fetchMock = installApi({ records: [legacy] });
  render(<Merchants />);
  expect(await screen.findByText("Address not recorded")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Edit Legacy Pickup at Test City" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText(/no saved public address/)).toBeInTheDocument();
  await user.clear(within(dialog).getByLabelText(/City/));
  await user.type(within(dialog).getByLabelText(/City/), "Corrected City");
  await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(JSON.parse(String(calls(fetchMock, "PATCH")[0][1]?.body))).not.toHaveProperty("publicAddress");
});
