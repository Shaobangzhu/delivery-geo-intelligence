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
  payments?: unknown[];
  sessions?: unknown[];
  get?: (url: URL) => Promise<Response> | Response;
  post?: (payload: DeliveryPayload) => Promise<Response> | Response;
  patch?: (payload: DeliveryPayload) => Promise<Response> | Response;
} = {}) {
  let rows = [...(options.rows ?? initialRows)];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit): Promise<Response> => {
    const url = new URL(input, "http://localhost");
    const method = init?.method ?? "GET";
    if (url.pathname === "/api/delivery-sessions") return reply({ data: options.sessions ?? [] });
    if (url.pathname === "/api/vehicle-economics") return reply({ data: null, historicalMileage: [] });
    if (url.pathname === "/api/earnings-adjustments") return reply({ data: options.payments ?? [] });
    if (url.pathname === "/api/uber-annual-summaries") return reply({ data: [], limit: 20, hasMore: false });
    if (url.pathname === "/api/merchants") return reply({ data: merchants });
    if (url.pathname === "/api/deliveries" && method === "GET") {
      if (options.get) return options.get(url);
      const search = url.searchParams.get("search")?.toLowerCase() ?? "";
      const category = url.searchParams.get("category") ?? "";
      const platform = url.searchParams.get("platform");
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const sort = url.searchParams.get("sort");
      let selected = rows.filter((row) => {
        const merchant = merchants.find((item) => item.id === row.merchantId);
        return (!platform || (platform === "unknown" ? !row.platform : row.platform === platform)) && (!search || merchant?.name.toLowerCase().includes(search)) &&
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
        ...(typeof payload.payout === "number" ? { payout: payload.payout } : {}),
        ...(typeof payload.deliveryDurationSeconds === "number" ? { deliveryDurationSeconds: payload.deliveryDurationSeconds } : {}), hasDestinationLocation: true };
      rows = [created, ...rows];
      return reply({ data: created }, 201);
    }
    if (url.pathname.startsWith("/api/deliveries/") && method === "PATCH") {
      const payload = JSON.parse(String(init?.body)) as DeliveryPayload;
      if (options.patch) return options.patch(payload);
      const id = url.pathname.split("/").at(-1);
      rows = rows.map((row) => row.id === id ? { ...row, merchantId: payload.merchantId,
        pickedUpAt: payload.pickedUpAt, ...(payload.platform ? { platform: payload.platform } : {}),
        hasDestinationLocation: row.hasDestinationLocation || Boolean(payload.destinationAddress) } : row);
      rows = rows.map((row) => {
        if (row.id !== id || payload.deliveryDurationSeconds === undefined) return row;
        const { deliveryDurationSeconds: previous, ...rest } = row;
        return payload.deliveryDurationSeconds === null ? rest : { ...rest, deliveryDurationSeconds: payload.deliveryDurationSeconds };
      });
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

function syntheticRows(count: number): Delivery[] {
  return Array.from({ length: count }, (_, index) => ({
    ...initialRows[0], id: `delivery-${index}`, pickedUpAt: new Date(Date.UTC(2026, 3, 20, 14, index)).toISOString()
  }));
}

async function navigateToPage(user: ReturnType<typeof userEvent.setup>, page: number) {
  for (let current = 1; current < page; current += 1) {
    const next = within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Next page" });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: `Page ${current + 1}` })).toHaveAttribute("aria-current", "page"));
  }
  await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: `Page ${page}` })).toBeEnabled());
}

function deliveryQueries(fetchMock: ReturnType<typeof vi.fn>) {
  return requests(fetchMock, "GET", "/api/deliveries")
    .map(([input]) => new URL(String(input), "http://localhost").searchParams);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Delivery History", () => {
  it("refreshes an edited platform on page 8 without resetting pagination", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: syntheticRows(88) });
    render(<History />);
    await screen.findByText("Showing 1–10 of 88 deliveries");
    await navigateToPage(user, 8);
    await screen.findByText("Showing 71–80 of 88 deliveries");
    const before = deliveryQueries(fetchMock).length;
    await user.click(screen.getAllByRole("button", { name: "Edit delivery for Test Merchant A" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Edit Delivery" });
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "uber_eats");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await within(screen.getAllByRole("table")[0]).findByText("Uber Eats")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Page 8" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Showing 71–80 of 88 deliveries")).toBeInTheDocument();
    expect(deliveryQueries(fetchMock).slice(before).map((query) => query.get("page"))).toEqual(["8"]);
  });

  it("returns to page 1 after creating a delivery from page 2", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: syntheticRows(12) });
    render(<History />);
    await screen.findByText("Showing 1–10 of 12 deliveries");
    await navigateToPage(user, 2);
    const before = deliveryQueries(fetchMock).length;
    await user.click(screen.getByRole("button", { name: /Add Delivery/ }));
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "doordash");
    await user.selectOptions(within(dialog).getByLabelText(/Merchant/), "merchant-a");
    fireEvent.change(within(dialog).getByLabelText(/Pickup Date & Time/), { target: { value: "2026-04-21T12:30" } });
    await user.type(within(dialog).getByLabelText(/Destination Address/), "synthetic-destination-token");
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await screen.findByText("Showing 1–10 of 13 deliveries");
    expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(deliveryQueries(fetchMock).slice(before).map((query) => query.get("page"))).toEqual(["1"]);
  });

  it.each([
    { count: 22, page: 2, expectedPage: 2, expectedRequests: ["2"], showing: "Showing 11–20 of 21 deliveries" },
    { count: 21, page: 3, expectedPage: 2, expectedRequests: ["3", "2"], showing: "Showing 11–20 of 20 deliveries" },
    { count: 1, page: 1, expectedPage: 1, expectedRequests: ["1"], showing: "Showing 0 of 0 deliveries" }
  ])("keeps filtered pagination valid after an edit ($count records)", async ({ count, page, expectedPage, expectedRequests, showing }) => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: syntheticRows(count) });
    render(<History />);
    await screen.findByText(`Showing 1–${Math.min(count, 10)} of ${count} deliveries`);
    await user.type(screen.getByLabelText("Merchant search"), "Merchant A");
    await user.selectOptions(screen.getByLabelText("Delivery Platform"), "unknown");
    await user.selectOptions(screen.getByLabelText("Category"), "restaurant");
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-04-30" } });
    await user.selectOptions(screen.getByLabelText("Sort"), "oldest");
    await navigateToPage(user, page);
    const before = deliveryQueries(fetchMock).length;
    const originalQuery = Object.fromEntries(deliveryQueries(fetchMock).at(-1)!);
    await user.click(screen.getAllByRole("button", { name: "Edit delivery for Test Merchant A" })[0]);
    const dialog = screen.getByRole("dialog");
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "doordash");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await screen.findByText(showing);
    const refreshed = deliveryQueries(fetchMock).slice(before);
    expect(refreshed.map((query) => query.get("page"))).toEqual(expectedRequests);
    for (const query of refreshed) {
      expect(Object.fromEntries(query)).toEqual({ ...originalQuery, page: query.get("page") });
    }
    expect(within(screen.getAllByRole("table")[0]).queryByText("DoorDash")).not.toBeInTheDocument();
    if (count > 1) {
      expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: `Page ${expectedPage}` })).toHaveAttribute("aria-current", "page");
    } else {
      expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Previous page" })).toBeDisabled();
      expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Next page" })).toBeDisabled();
    }
  });

  it("preserves page 2 when editing is canceled or fails", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: syntheticRows(12), patch: () => reply({ error: "Save failed" }, 500) });
    render(<History />);
    await screen.findByText("Showing 1–10 of 12 deliveries");
    await navigateToPage(user, 2);
    const before = deliveryQueries(fetchMock).length;
    await user.click(screen.getAllByRole("button", { name: "Edit delivery for Test Merchant A" })[0]);
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getAllByRole("button", { name: "Edit delivery for Test Merchant A" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Edit Delivery" });
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "uber_eats");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("The server could not complete the request.");
    expect(dialog).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    expect(deliveryQueries(fetchMock)).toHaveLength(before);
  });

  it.each(["Merchant search", "Delivery Platform", "Category", "From date", "To date", "Sort"])(
    "still resets page 2 to page 1 when %s changes", async (label) => {
      const user = userEvent.setup();
      const fetchMock = installApi({ rows: syntheticRows(12) });
      render(<History />);
      await screen.findByText("Showing 1–10 of 12 deliveries");
      await navigateToPage(user, 2);
      if (label === "Merchant search") await user.type(screen.getByLabelText(label), "Test");
      else if (label === "From date" || label === "To date") {
        fireEvent.change(screen.getByLabelText(label), { target: { value: label === "From date" ? "2026-04-01" : "2026-04-30" } });
      } else {
        await user.selectOptions(screen.getByLabelText(label), label === "Sort" ? "oldest" : label === "Category" ? "restaurant" : "unknown");
      }
      await waitFor(() => expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page"));
      expect(deliveryQueries(fetchMock).at(-1)?.get("page")).toBe("1");
    }
  );

  it("returns to the previous page when deleting the last delivery on a page", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: syntheticRows(11) });
    render(<History />);
    await screen.findByText("Showing 1–10 of 11 deliveries");
    await navigateToPage(user, 2);
    const before = deliveryQueries(fetchMock).length;
    await user.click(screen.getByRole("button", { name: "Delete delivery for Test Merchant A" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete Delivery" }));
    await screen.findByText("Showing 1–10 of 10 deliveries");
    expect(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    expect(deliveryQueries(fetchMock).slice(before).map((query) => query.get("page"))).toEqual(["1"]);
  });

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
    await user.click(within(screen.getByRole("navigation", { name: "Delivery pages" })).getByRole("button", { name: "Next page" }));
    await screen.findByText("Showing 11–12 of 12 deliveries");
    expect(new URL(String(requests(fetchMock, "GET", "/api/deliveries").at(-1)?.[0]), "http://localhost").searchParams.get("page")).toBe("2");

    await user.selectOptions(screen.getByLabelText("Delivery Platform"), "unknown");
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
      expect(query.get("platform")).toBe("unknown");
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
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "doordash");
    await user.selectOptions(within(dialog).getByLabelText(/Merchant/), "merchant-a");
    fireEvent.change(within(dialog).getByLabelText(/Pickup Date & Time/), { target: { value: "2026-04-21T12:30" } });
    await user.type(within(dialog).getByLabelText(/Destination Address/), "synthetic-destination-token");
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("Showing 1–3 of 3 deliveries")).toBeInTheDocument();
    const post = requests(fetchMock, "POST", "/api/deliveries");
    expect(post).toHaveLength(1);
    const payload = JSON.parse(String(post[0][1]?.body)) as DeliveryPayload;
    expect(payload).not.toHaveProperty("deliveryDurationSeconds");
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
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "doordash");
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
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "doordash");
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
    expect(normalPayload).not.toHaveProperty("deliveryDurationSeconds");

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

  it("captures normalized duration for a new delivery", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi();
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: /Add Delivery/ }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("group", { name: /Delivery Duration/ })).toBeInTheDocument();
    await user.selectOptions(within(dialog).getByLabelText(/Delivery Platform/), "doordash");
    await user.selectOptions(within(dialog).getByLabelText(/Merchant/), "merchant-a");
    fireEvent.change(within(dialog).getByLabelText(/Pickup Date & Time/), { target: { value: "2026-04-21T12:30" } });
    await user.type(within(dialog).getByLabelText(/Destination Address/), "synthetic-destination-token");
    for (const [label, value] of [["Hours", "1"], ["Minutes", "2"], ["Seconds", "3"]]) {
      await user.type(within(dialog).getByLabelText(label), value);
    }
    await user.click(within(dialog).getByRole("button", { name: "Save Delivery" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const payload = JSON.parse(String(requests(fetchMock, "POST", "/api/deliveries")[0][1]?.body));
    expect(payload.deliveryDurationSeconds).toBe(3723);
    expect(await screen.findByText("1 hr 2 mins 3 secs")).toBeInTheDocument();
    expect(payload).not.toHaveProperty("durationHours");
    expect(payload).not.toHaveProperty("durationMinutes");
    expect(payload).not.toHaveProperty("durationSeconds");
  });

  it("prepopulates an existing duration and sends null when all components are cleared", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: [{ ...initialRows[0], deliveryDurationSeconds: 5025 }, initialRows[1]] });
    render(<History />);
    await screen.findByText("1 hr 23 mins 45 secs");
    const unknownRow = screen.getByText("Test Grocery B").closest("tr")!;
    expect(within(unknownRow).getAllByRole("cell")[6]).toHaveTextContent("—");
    await user.click(screen.getByRole("button", { name: "Edit delivery for Test Merchant A" }));
    expect(screen.getByLabelText("Hours")).toHaveValue(1);
    expect(screen.getByLabelText("Minutes")).toHaveValue(23);
    expect(screen.getByLabelText("Seconds")).toHaveValue(45);
    for (const label of ["Hours", "Minutes", "Seconds"]) await user.clear(screen.getByLabelText(label));
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const payload = JSON.parse(String(requests(fetchMock, "PATCH", "/api/deliveries/delivery-a")[0][1]?.body));
    expect(payload.deliveryDurationSeconds).toBeNull();
    expect(screen.queryByText("1 hr 23 mins 45 secs")).not.toBeInTheDocument();
    expect(payload).not.toHaveProperty("destinationAddress");
  });

  it("backfills an old delivery through Edit and corrects an existing duration", async () => {
    const user = userEvent.setup();
    const fetchMock = installApi({ rows: [initialRows[0], { ...initialRows[1], deliveryDurationSeconds: 125 }] });
    render(<History />);
    await screen.findByText("Test Merchant A");
    await user.click(screen.getByRole("button", { name: "Edit delivery for Test Merchant A" }));
    for (const label of ["Hours", "Minutes", "Seconds"]) expect(screen.getByLabelText(label)).toHaveValue(null);
    await user.type(screen.getByLabelText("Minutes"), "28");
    await user.type(screen.getByLabelText("Seconds"), "41");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(String(requests(fetchMock, "PATCH", "/api/deliveries/delivery-a")[0][1]?.body)).deliveryDurationSeconds).toBe(1721);
    expect(await screen.findByText("28 mins 41 secs")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit delivery for Test Grocery B" }));
    await user.clear(screen.getByLabelText("Seconds"));
    await user.type(screen.getByLabelText("Seconds"), "12");
    await user.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(JSON.parse(String(requests(fetchMock, "PATCH", "/api/deliveries/delivery-b")[0][1]?.body)).deliveryDurationSeconds).toBe(132);
  });

  it.each([["Minutes", "60"], ["Seconds", "60"], ["Hours", "-1"], ["Minutes", "1.5"], ["Seconds", "0"]])(
    "rejects invalid duration %s=%s", async (label, value) => {
      const user = userEvent.setup();
      const fetchMock = installApi();
      render(<History />);
      await screen.findByText("Test Merchant A");
      await user.click(screen.getByRole("button", { name: "Edit delivery for Test Merchant A" }));
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
      await user.click(screen.getByRole("button", { name: "Save Changes" }));
      expect(screen.getByRole("alert")).toHaveTextContent("Enter a positive duration");
      expect(requests(fetchMock, "PATCH", "/api/deliveries/delivery-a")).toHaveLength(0);
    }
  );

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

it("shows platform labels and rejects a stale Delivery response after platform changes", async () => {
  let finish!: (value: Response) => void;
  const pending = new Promise<Response>((resolve) => { finish = resolve; });
  const mock = installApi({ get: (url) => url.searchParams.get("platform") ? reply({ data: [
    { ...initialRows[0], platform: "uber_eats" }, { ...initialRows[1], platform: "doordash" }, { ...initialRows[0], id: "unknown" }
  ], pagination: { page: 1, pageSize: 10, total: 3, totalPages: 1 } }) : pending });
  const user = userEvent.setup(); render(<History />);
  await user.selectOptions(screen.getByLabelText("Delivery Platform"), "doordash");
  await screen.findByText("Showing 1–3 of 3 deliveries");
  const table = screen.getAllByRole("table")[0];
  for (const label of ["Platform", "Uber Eats", "DoorDash", "Unknown"]) expect(within(table).getByText(label)).toBeInTheDocument();
  const gets = requests(mock, "GET", "/api/deliveries"); expect(gets[0][1].signal.aborted).toBe(true);
  finish(reply({ data: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 } }));
  await waitFor(() => expect(screen.getByText("Showing 1–3 of 3 deliveries")).toBeInTheDocument());
});

it("keeps all three History pagers independent, including after editing a page-eight delivery", async () => {
  const payments = Array.from({ length: 21 }, (_, index) => ({ id: `payment-${index}`, type: "prop22_guarantee", platform: "uber_eats", paymentDate: "2026-10-01", amount: index + 1 }));
  const sessions = Array.from({ length: 21 }, (_, index) => ({ id: `session-${index}`, startedAt: "2026-10-01T12:00:00Z", endedAt: "2026-10-01T13:00:00Z", sessionDurationSeconds: 3600, deliveryIds: [], linkedDeliveries: [],
    vehicleCost: { knownAndEstimatedCost: null, fullEconomicCost: null, completeness: "partial", amounts: { energy: null, tireWear: null, depreciation: null }, rates: { energy: null, tireWear: null, depreciation: null }, missingComponents: ["energy", "tireWear", "depreciation"] } }));
  const mock = installApi({ rows: syntheticRows(88), payments, sessions });
  const user = userEvent.setup(); render(<History />);
  await screen.findByText("Showing 1–10 of 88 deliveries");
  await screen.findByText("Showing 1–10 of 21 payments");
  await screen.findByText("Showing 1–10 of 21 sessions");
  const pager = (name: string) => within(screen.getByRole("navigation", { name }));
  const calls = mock.mock.calls.length;
  await user.click(pager("Prop 22 payment pages").getByRole("button", { name: "Page 2" }));
  await user.click(pager("Delivery session pages").getByRole("button", { name: "Page 3" }));
  expect(mock).toHaveBeenCalledTimes(calls);
  expect(pager("Delivery pages").getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
  await navigateToPage(user, 8);
  expect(pager("Prop 22 payment pages").getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  expect(pager("Delivery session pages").getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
  await user.click(screen.getAllByRole("button", { name: "Edit delivery for Test Merchant A" })[0]);
  await user.click(screen.getByRole("button", { name: "Save Changes" }));
  await screen.findByText("Showing 71–80 of 88 deliveries");
  await screen.findByText("Showing 21–21 of 21 sessions");
  expect(pager("Prop 22 payment pages").getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
  expect(pager("Delivery session pages").getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
});
