import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

// Tests must explicitly stub requests; accidental API/SDK fetches fail locally.
globalThis.fetch = async () => { throw new Error("Unexpected fetch: provide a synthetic test stub"); };
