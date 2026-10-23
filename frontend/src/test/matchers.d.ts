import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";
import "vitest";

// Vitest 5.0.5 uses result/received generics; jest-dom 7's older Assertion augmentation has one.
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- Module augmentation extends the real matcher interface.
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends TestingLibraryMatchers<T, R> {}
}
