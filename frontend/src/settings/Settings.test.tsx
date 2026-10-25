import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Settings } from "../pages/Settings";
import { categories, parseSnapshot } from "./api";
import { observeBrowserMap, resetBrowserMapStatus } from "./browserStatus";
const timestamp = "2026-10-23T10:00:00.000Z";
function fixture(window = "24h", samples = 2) {
  return { schemaVersion: 1, window, generatedAt: timestamp, startedAt: timestamp, incomplete: false,
    providers: (["mongodb", "arcgis_geocoding", "openai"] as const).map((provider) => ({ provider, configured: true, status: samples ? "operational" : "not_yet_verified",
      lastSuccessAt: samples ? timestamp : null, lastUpdatedAt: samples ? timestamp : null, lastErrorCategory: null as string | null,
      sampleCount: samples, requestCount: samples, successCount: samples, failureCount: 0, noMatchCount: 0, lowConfidenceCount: 0,
      latency: { sampleCount: samples, meanMs: samples ? 10 : null, p50Ms: samples ? 10 : null, p95Ms: samples ? 20 : null },
      operations: { database_read: samples, database_write: 0, database_other: 0, health_ping: 0, geocode: 0, analyst_request: 0 },
      errorCounts: Object.fromEntries(categories.map((c) => [c, 0])), model: provider === "openai" ? "synthetic-model" : null,
      healthCheck: provider === "mongodb" && samples ? { timestamp, durationMs: 3, outcome: "success" } : null,
      ai: provider === "openai" ? { analystRequests: samples, providerCalls: samples, providerErrors: 0, usageSamples: samples, inputTokens: samples ? 123 : null, outputTokens: samples ? 45 : null } : null })) };
}
const reply = (body: unknown) => ({ ok: true, json: async () => body });
function install(samples = 2) {
  const fetcher = vi.fn(async (url: string) => reply(fixture(url.includes("window=1h") ? "1h" : "24h", samples)));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
beforeEach(resetBrowserMapStatus);
afterEach(() => { vi.unstubAllGlobals(); resetBrowserMapStatus(); });
it("renders actual backend and unverified browser observations without paid calls", async () => {
  const fetcher = install(); render(<Settings />);
  expect(await screen.findByText("synthetic-model")).toBeInTheDocument();
  expect(screen.getByText("123")).toBeInTheDocument(); expect(screen.getByText("3.0 ms")).toBeInTheDocument();
  expect(screen.getByText("Not Yet Verified")).toBeInTheDocument();
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/system/status", "/api/system/metrics?window=1h"]);
  expect(screen.getByRole("region", { name: "Provider request metrics" })).toHaveAttribute("tabindex", "0");
});
it("renders empty metrics with unavailable latency and missing tokens", async () => {
  install(0); render(<Settings />);
  expect(await screen.findByText("No operations observed in this window.")).toBeInTheDocument();
  expect(screen.queryByText("0.0%")).not.toBeInTheDocument(); expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
});
it("handles unavailable API without displaying raw error details", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("SECRET private error"); })); render(<Settings />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Backend data is unavailable or partial");
  expect(screen.queryByText(/SECRET/)).not.toBeInTheDocument(); expect(screen.queryByText(/3 \/ 3 operational/)).not.toBeInTheDocument();
});
it("shows partial data and independent provider failure classifications", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.includes("metrics")) throw new Error("offline");
    const data = fixture(); data.providers[1].status = "unavailable"; return reply(data);
  })); render(<Settings />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Request metrics unavailable");
  expect(screen.getByText("synthetic-model")).toBeInTheDocument(); expect(screen.queryByRole("table")).not.toBeInTheDocument();
});
it("refreshes both endpoints and switches metric windows", async () => {
  const fetcher = install(), user = userEvent.setup(); render(<Settings />);
  await screen.findByText("synthetic-model"); await user.click(screen.getByRole("button", { name: "Refresh status" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
  await user.selectOptions(screen.getByLabelText("Observation window"), "24h");
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe("/api/system/metrics?window=24h");
});
it("cancels old requests on window change and ignores late completions", async () => {
  let resolveOld!: (value: unknown) => void;
  const fetcher = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce(reply(fixture())).mockResolvedValueOnce(reply(fixture("24h", 0)));
  vi.stubGlobal("fetch", fetcher); const user = userEvent.setup(); const view = render(<Settings />);
  const signal = fetcher.mock.calls[0][1].signal as AbortSignal;
  await user.selectOptions(screen.getByLabelText("Observation window"), "24h");
  expect(signal.aborted).toBe(true); expect(await screen.findByText("No operations observed in this window.")).toBeInTheDocument();
  resolveOld(reply(fixture())); view.unmount(); expect(fetcher.mock.calls[2][1].signal.aborted).toBe(true);
});
it("rejects malformed contracts and projects unknown fields without exposing them", () => {
  const data = fixture();
  expect(() => parseSnapshot({ ...data, schemaVersion: 2 }, "24h")).toThrow();
  expect(() => parseSnapshot(data, "1h")).toThrow();
  const bad = structuredClone(data); bad.providers[0].lastErrorCategory = "SECRET";
  expect(() => parseSnapshot(bad, "24h")).toThrow();
  expect(() => parseSnapshot({ ...data, providers: [data.providers[0], data.providers[0], data.providers[0]] }, "24h")).toThrow();
  expect(JSON.stringify(parseSnapshot({ ...data, secret: "SECRET" }, "24h"))).not.toContain("SECRET");
});
it("shows sanitized categories and capacity warnings", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { const data = fixture(url.includes("window=1h") ? "1h" : "24h"); data.incomplete = true; data.providers[0].lastErrorCategory = "rate_limit"; return reply(data); }));
  render(<Settings />); expect(await screen.findByText("Rate Limit")).toBeInTheDocument(); expect(screen.getByText(/collector capacity/)).toBeInTheDocument();
});
it("shares only safe browser lifecycle events across component remounts", async () => {
  install(); const view = render(<Settings />); await screen.findByText("synthetic-model");
  view.unmount(); observeBrowserMap("layer_initialization_failure"); render(<Settings />);
  expect(screen.getByText("Layer Initialization Failure")).toBeInTheDocument();
});

it("marks retained status stale after refresh failure and clears current metrics", async () => {
  const fetcher = install(), user = userEvent.setup(); render(<Settings />);
  await screen.findByText("synthetic-model");
  fetcher.mockRejectedValue(new Error("PRIVATE_FAILURE"));
  await user.click(screen.getByRole("button", { name: "Refresh status" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("retained status is stale");
  expect(screen.getByText("Unavailable · stale snapshot")).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE_FAILURE/)).not.toBeInTheDocument();
});


it("handles HTTP 503 without reading or rendering its private response body", async () => {
  const json = vi.fn(async () => ({ error: "PRIVATE_503_PAYLOAD" }));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 503, json })));
  render(<Settings />); expect(await screen.findByRole("alert")).toHaveTextContent("Backend data is unavailable");
  expect(json).not.toHaveBeenCalled(); expect(screen.queryByText(/PRIVATE_503/)).not.toBeInTheDocument();
});
it("rejects forged healthy state and inconsistent success denominators", () => {
  const unknown = fixture("24h", 0); unknown.providers[0].status = "operational";
  expect(() => parseSnapshot(unknown, "24h")).toThrow();
  const inconsistent = fixture(); inconsistent.providers[0].successCount = 100;
  expect(() => parseSnapshot(inconsistent, "24h")).toThrow();
});
it("malformed payloads produce an error, never an invented 100 percent success rate", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => reply({ schemaVersion: 1, providers: "PRIVATE_PAYLOAD" })));
  render(<Settings />); expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText("100.0%")).not.toBeInTheDocument(); expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText(/PRIVATE_PAYLOAD/)).not.toBeInTheDocument();
});
it("distinguishes unavailable provider from no observations while preserving partial endpoint success", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const data = fixture(url.includes("window=1h") ? "1h" : "24h", 0);
    data.providers[0].status = "unavailable"; data.providers[0].lastErrorCategory = "connectivity";
    data.providers[0].sampleCount = 1; data.providers[0].requestCount = 1; data.providers[0].failureCount = 1;
    data.providers[0].lastUpdatedAt = timestamp; data.providers[0].operations.database_read = 1;
    data.providers[0].latency = { sampleCount: 1, meanMs: 10, p50Ms: 10, p95Ms: 10 };
    return reply(data);
  }));
  render(<Settings />); expect(await screen.findByText("Connectivity")).toBeInTheDocument();
  expect(screen.getAllByText("Not Yet Verified").length).toBeGreaterThan(1);
  expect(screen.getByText("0.0%")).toBeInTheDocument(); expect(screen.queryByText("100.0%")).not.toBeInTheDocument();
});

for (const scenario of ["zero-sample health", "missing latency", "inverted quantiles", "operation denominator", "AI errors", "AI usage samples", "AI token fabrication", "AI analyst denominator"] as const) {
  it(`rejects contradictory metrics: ${scenario}`, () => {
    const data = fixture("24h", scenario === "zero-sample health" || scenario === "AI token fabrication" ? 0 : 2);
    const row = data.providers[0], ai = data.providers[2].ai!;
    if (scenario === "zero-sample health") { row.status = "operational"; row.lastSuccessAt = timestamp; }
    if (scenario === "missing latency") row.latency.p50Ms = null;
    if (scenario === "inverted quantiles") row.latency.p95Ms = 1;
    if (scenario === "operation denominator") row.operations.database_read = 100;
    if (scenario === "AI errors") ai.providerErrors = 3;
    if (scenario === "AI usage samples") ai.usageSamples = 3;
    if (scenario === "AI token fabrication") ai.inputTokens = 100;
    if (scenario === "AI analyst denominator") ai.analystRequests = 3;
    expect(() => parseSnapshot(data, "24h")).toThrow("invalid_response");
  });
}
it("accepts reported partial AI usage without estimating missing model calls", () => {
  const data = fixture(), ai = data.providers[2].ai!;
  ai.providerCalls = 4; ai.usageSamples = 1;
  expect(parseSnapshot(data, "24h").providers[2].ai).toEqual(ai);
});
