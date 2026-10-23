import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);

afterEach(cleanup);

// Tests must explicitly stub requests; accidental API/SDK fetches fail locally.
globalThis.fetch = async () => { throw new Error("Unexpected fetch: provide a synthetic test stub"); };
