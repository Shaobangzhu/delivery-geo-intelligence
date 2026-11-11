import * as matchers from "@testing-library/jest-dom/matchers";
import { cleanup } from "@testing-library/react";
import { afterEach, expect } from "vitest";

expect.extend(matchers);

// jsdom lacks the native modal API. Only adapt open/close lifecycle; do not
// simulate layout, inertness or the browser's native focus trap.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
    queueMicrotask(() => this.dispatchEvent(new Event("close")));
  };
}

afterEach(cleanup);

// Tests must explicitly stub requests; accidental API/SDK fetches fail locally.
globalThis.fetch = async () => { throw new Error("Unexpected fetch: provide a synthetic test stub"); };
