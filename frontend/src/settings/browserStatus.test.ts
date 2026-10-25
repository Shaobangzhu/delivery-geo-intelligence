import { expect, it } from "vitest";
import { getBrowserMapStatus, observeBrowserMap, resetBrowserMapStatus, subscribeBrowserMapStatus } from "./browserStatus";
it("isolates failing telemetry consumers and releases subscriptions", () => {
  let calls = 0;
  const broken = subscribeBrowserMapStatus(() => { throw new Error("SYNTHETIC_PRIVATE_ERROR"); });
  const healthy = subscribeBrowserMapStatus(() => { calls++; });
  try {
    expect(() => observeBrowserMap("map_initialized")).not.toThrow();
    expect(getBrowserMapStatus().event).toBe("map_initialized");
    expect(calls).toBe(1);
    expect(() => resetBrowserMapStatus()).not.toThrow();
    expect(getBrowserMapStatus()).toEqual({ event: null, timestamp: null });
    expect(calls).toBe(2);
  } finally { broken(); healthy(); resetBrowserMapStatus(); }
  expect(calls).toBe(2);
});
