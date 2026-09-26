import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { History } from "./History";
import type { Delivery, DeliveryPayload, Merchant } from "../history/api";

const merchants: Merchant[] = [
  { id: "merchant-a", name: "Test Merchant A", category: "restaurant", city: "Test City" },
  { id: "merchant-b", name: "Test Grocery B", category: "grocery", city: "Test City" }
];
const initialRows: Delivery[] = [
  { id: "delivery-a", merchantId: "merchant-a", pickedUpAt: "2026-04-20T14:00:00Z", payout: 8.5, distanceMiles: 2.1, hasDestinationLocation: true },
  { id: "delivery-b", merchantId: "merchant-b", pickedUpAt: "2026-03-18T15:00:00Z", hasDestinationLocation: false }
];

function reply(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

function installApi(options: {
  rows?: Delivery[];
  get?: (url: URL) => Promise<Response> | Response;
  post?: (payload: DeliveryPayload) => Promise<Response> | Response;
  patch?: (payload: DeliveryPayload) => Promise<Response> | Response;
} = {}) {
  let rows = [...(options.rows ?? initialRows)];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/merchants") return reply({ data: merchants });
    if (url.pathname === "/api/deliveries" && method === "GET") {
      if (options.get) return options.get(url);
      const search = url.searchParams.get("search")?.toLowerCase() ?? "";
      const category = url.searchParams.get("category") ?? "";
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const sort = url.searchParams.get("sort");
      let selected = rows.filter((row) => {
        const merchant = merchants.find((item) => item.id === row.merchantId);
        return (!search || merchant?.name.toLowerCase().includes(search)) &&
          (!category || merchant?.category === category) &&
          (!from || row.pickedUpAt >= from) && (!to || row.pickedUpAt < to);
      });
      if (sort === "newest") selected = selected.sort((a, b) => b.pickedUpAt.localeCompare(a.pickedUpAt));
      if (sort === "oldest") selected = selected.sort((a, b) => a.pickedUpAt.localeCompare(b.pickedUpAt));
      const page = Number(url.searchParams.get("page") ?? 1);
      const pageSize = Number(url.searchParams.get("pageSize") ?? 10);
      return reply({ data: selected.slice((page - 1) * pageSize, page * pageSize), pagination: {
        page, pageSize, total: selected.length, totalPages: Math.ceil(selected.length / pageSize)
      } });
    }
    if (url.pathname === "/api/deliveries" && method === "POST") {
      const payload = JSON.parse(String(init?.body)) as DeliveryPayload;
      if (options.post) return options.post(payload);
      const created: Delivery = { id: "delivery-new", merchantId: payload.merchantId, pickedUpAt: payload.pickedUpAt,
        ...(typeof payload.payout === "number" ? { payout: payload.payout } : {}), hasDestinationLocation: true };
      rows = [created, ...rows];
      return reply({ data: created }, 201);
    }
    if (url.pathname.startsWith("/api/deliveries/") && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as DeliveryPayload;
      if (options.patch) return options.patch(payload);
      const id = url.pathname.split("/").at(-1);
      rows = rows.map((row) => row.id === id ? { ...row, merchantId: payload.merchantId,
        pickedUpAt: payload.pickedUpAt, hasDestinationLocation: row.hasDestinationLocation || Boolean(payload.destinationAddress) } : row);
      return reply({ data: rows.find((row) => row.id === id) });
    }
    if (url.pathname.startsWith("/api/deliveries/") && method === "DELETE") {
      rows = rows.filter((row) => row.id !== url.pathname.split("/").at(-1));
      return reply(null, 204);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function requests(fetchMock: ReturnType<typeof vi.fn>, method: string, path: string) {
  return fetchMock.mock.calls.filter(([input, init]) => new URL(String(input), "http://localhost").pathname === path && (init?.method ?? "GET") === method);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Delivery History", () => {
  it("ignores an older list response after filters change", async () => {
    const user = userEvent.setup();
    let finishOld!: (response: Response) => void;
    const oldRequest = new Promise<Response>((resolve) => { finishOld = resolve; });
    installApi({ get: (url) => url.searchParams.get("search")
      ? reply({ data: [initialRows[1]], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } })
      : oldRequest });
    render(<History />);
    await user.type(screen.getByLabelText("Merchant search"), "Grocery");
    expect(await screen.findByText("Test Grocery B")).toBeInTheDocument();
    finishOld(reply({ data: [initialRows[0]], pagination: { page: 1, pageSize: 10, total: 1, totalPages: 1 } }));
    await waitFor(() => expect(screen.getByText("Test Grocery B")).toBeInTheDocument());
    expect(screen.queryByText("Test Merchant A")).not.toBeInTheDocument();
  });

  it("loads real API data and displays only a safe destination state", async () => {
    installApi();
    render(<History />);
    expect(await screen.findByText("Test Merchant A")).toBeInTheDocument();
    expect(screen.getByText("Location Ready")).toBeInTheDocument();
    expect(screen.getByText("$8.50")).toBeInTheDocument();
    expect(screen.getByText("No Location")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText(/latitude|longitude/i)).not.toBeInTheDocument();
  });

  it("sends merchant, category, date, sort, and pagination filters", async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 12 }, (_, index): Delivery => ({
      id: `delivery-${index}`, merchantId: index === 11 ? "merchant-b" : "merchant-a",
      pickedUpAt: `2026-04-${String(index + 1).padStart(2, "0")}T14:00:00Z`, hasDestinationLocation: true
    }));
    const fetchMock = installApi({ rows });
    render(<History />);
    await screen.findByText("Showing 1–10 of 12 deliveries");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Showing 11–12 of 12 deliveries");
    expect(new URL(String(requests(fetchMock, "GET", "/api/deliveries").at(-1)?.[0]), "http://localhost").searchParams.get("page")).toBe("2");

    await user.type(screen.getByLabelText("Merchant search"), "Grocery");
    await user.selectOptions(screen.getByLabelText("Category"), "grocery");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-04-30" } });
    await user.selectOptions(screen.getByLabelText("Sort"), "oldest");
    await waitFor(() => {
      const last = requests(fetchMock, "GET", "/api/deliveries").at(-1);
      const query = new URL(String(last?.[0]), "http://localhost").searchParams;
      expect(query.get("search")).toBe("Grocery");
      expect(query.get("category")).toBe("grocery");
      expect(query.get("from")).toBeTruthy();
      expect(query.get("to")).toBeTruthy();
      expect(query.get("sort")).toBe("oldest");
      expect(query.get("page")).toBe("1");
    });
    expect(await screen.findByText("Test Grocery B")).toBeInTheDocument();
  });

  it("opens a centered dialog, validates required fields, traps focus, and closes on Escape", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi();
    render(<History />);
    await screen.findByText("Test Merchant A");
    const trigger = screen.getByRole("button", { name: /Add Delivery/ });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "Add Delivery" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByLabelText(/Merchant/)).toHaveFocus();
    expect(within(dialog).getByText("Destination address is used for geocoding and is not stored.")).toBeInTheDocument();
    within(dialog).getByRole("button", { name: "Close dialog" }).focus();
    await user.tab({ shift: true });
    expect(within(dialog).getByRole("button", { name: "Save Delivery" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Complete the required fields");
    expect(requests(fetchMock, "POST", "/api/deliveries")).toHaveLength(0);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("saves once, refreshes, and clears the transient address before reopening", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi();
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: /Add Delivery/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Merchant/), "merchant-a");
    fireEvent.change(within(dialog).getByLabelText(/Pickup Date & Time/), { target: { value: "2026-04-21T12:30" } });
    await user.type(within(dialog).getByLabelText(/Destination Address/), "synthetic-destination-token");
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Showing 1–3 of 3 deliveries")).toBeInTheDocument();
    const post = requests(fetchMock, "POST", "/api/deliveries");
    expect(post).toHaveLength(1);
    const payload = JSON.parse(String(post[0][1]?.body)) as DeliveryPayload;
    expect(payload.destinationAddress).toBe("synthetic-destination-token");
    expect(payload).not.toHaveProperty("destinationLocation");
    await user.click(screen.getByRole("button", { name: /Add Delivery/ }));
    expect(screen.getByLabelText(/Destination Address/)).toHaveValue("");
  });

  it("shows pending state, prevents duplicate submit, and handles geocoding errors", async () => {
    const user = userEvent.setup();
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { finish = resolve; });
    const fetchMock = installApi({ post: () => pending });
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: /Add Delivery/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Merchant/), "merchant-a");
    fireEvent.change(within(dialog).getByLabelText(/Pickup Date & Time/), { target: { value: "2026-04-21T12:30" } });
    await user.type(within(dialog).getByLabelText(/Destination Address/), "synthetic-destination-token");
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    expect(within(dialog).getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(requests(fetchMock, "POST", "/api/deliveries")).toHaveLength(1);
    finish(reply({ error: "Destination geocoding failed", code: "no_match" }, 422));
    expect(await screen.findByRole("alert")).toHaveTextContent("No destination match was found");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText(/Destination Address/)).toHaveValue("synthetic-destination-token");
  });

  it("shows a safe server error without echoing provider details", async () => {
    const user = userEvent.setup();
    installApi({ post: () => reply({ error: "Provider details should stay private" }, 500) });
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: /Add Delivery/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Merchant/), "merchant-a");
    fireEvent.change(within(dialog).getByLabelText(/Pickup Date & Time/), { target: { value: "2026-04-21T12:30" } });
    await user.type(within(dialog).getByLabelText(/Destination Address/), "synthetic-destination-token");
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The server could not complete the request.");
    expect(dialog).not.toHaveTextContent("Provider details should stay private");
  });

  it("edits without revealing or replacing the old destination unless requested", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi();
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: "Edit delivery for Test Merchant A" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Delivery" });
    expect(within(dialog).getByText("Location stored")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Destination Address/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const normalPayload = JSON.parse(String(requests(fetchMock, "PATCH", "/api/deliveries/delivery-a")[0][1]?.body));
    expect(normalPayload).not.toHaveProperty("destinationAddress");

    await user.click(screen.getByRole("button", { name: "Edit delivery for Test Merchant A" }));
    await user.click(screen.getByRole("button", { name: "Replace Destination" }));
    const address = screen.getByLabelText(/New Destination Address/);
    expect(address).toHaveValue("");
    await user.type(address, "synthetic-replacement-token");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const patches = requests(fetchMock, "PATCH", "/api/deliveries/delivery-a");
    expect(JSON.parse(String(patches.at(-1)?.[1]?.body)).destinationAddress).toBe("synthetic-replacement-token");
  });

  it("requires explicit confirmation before deletion and refreshes afterward", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi();
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: "Delete delivery for Test Merchant A" }));
    const dialog = screen.getByRole("dialog", { name: "Delete delivery?" });
    expect(within(dialog).getByText(/cannot be undone/)).toBeInTheDocument();
    expect(requests(fetchMock, "DELETE", "/api/deliveries/delivery-a")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Delete delivery for Test Merchant A" }));
    await user.click(screen.getByRole("button", { name: "Delete Delivery" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Showing 1–1 of 1 deliveries")).toBeInTheDocument();
    expect(requests(fetchMock, "DELETE", "/api/deliveries/delivery-a")).toHaveLength(1);
  });
});
