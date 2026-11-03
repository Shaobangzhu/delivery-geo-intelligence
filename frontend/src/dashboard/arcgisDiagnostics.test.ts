import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createArcgisTrace, traceArcgisPromise } from "./arcgisDiagnostics";

beforeEach(() => {
  delete window.__DGI_ARCGIS_DIAGNOSTICS__;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("VITE_ARCGIS_API_KEY", "synthetic-secret-key");
  vi.stubEnv("VITE_DGI_HOME_LONGITUDE", "-111.1234567");
  vi.stubEnv("VITE_DGI_HOME_LATITUDE", "22.1234567");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); delete window.__DGI_ARCGIS_DIAGNOSTICS__; });

it("retains import identity and original rejection while redacting diagnostic error details", async () => {
  const original = new TypeError("Failed https://example.test/module.js?token=synthetic-secret-key at -111.1234567,22.1234567", {
    cause: new Error("Failed file /Users/synthetic/private/cache/module.js")
  });
  const trace = createArcgisTrace();
  await expect(traceArcgisPromise(trace, "import:views/MapView.js", Promise.reject(original))).rejects.toBe(original);
  const entries = window.__DGI_ARCGIS_DIAGNOSTICS__!;
  expect(entries.at(-1)).toMatchObject({ stage: "import:views/MapView.js:failure", error: { name: "TypeError", cause: { name: "Error" } } });
  expect(entries.at(-1)?.error?.stack).toContain("TypeError");
  const serialized = JSON.stringify(entries);
  for (const secret of ["synthetic-secret-key", "-111.1234567", "22.1234567", "/Users/synthetic", "?token="]) expect(serialized).not.toContain(secret);
});

it("does not misclassify a pending import as failed and records completion when it resolves", async () => {
  let complete!: (value: object) => void;
  const value = {};
  const pending = traceArcgisPromise(createArcgisTrace(), "import:Map.js", new Promise<object>((resolve) => { complete = resolve; }));
  expect(window.__DGI_ARCGIS_DIAGNOSTICS__?.map(x => x.stage)).toEqual(["import:Map.js:start"]);
  complete(value);
  await expect(pending).resolves.toBe(value);
  expect(window.__DGI_ARCGIS_DIAGNOSTICS__?.at(-1)?.stage).toBe("import:Map.js:ready");
});

it("isolates diagnostic consumers and hostile error getters from the original rejection", async () => {
  vi.spyOn(window, "dispatchEvent").mockImplementation(() => { throw new Error("Synthetic consumer failed"); });
  const original = { get message() { throw new Error("Synthetic getter failed"); } };
  await expect(traceArcgisPromise(createArcgisTrace(), "view", Promise.reject(original))).rejects.toBe(original);
});

it("bypasses capture and preserves promise identity outside development", async () => {
  vi.stubEnv("DEV", false);
  const promise = Promise.resolve({});
  const result = traceArcgisPromise(createArcgisTrace(), "import:Map.js", promise);
  expect(result).toBe(promise);
  await result;
  expect(window.__DGI_ARCGIS_DIAGNOSTICS__).toBeUndefined();
  expect(console.error).not.toHaveBeenCalled();
});
