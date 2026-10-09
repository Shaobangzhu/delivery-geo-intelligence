import { expect, it } from "vitest";
import { initialOccurrence, losAngelesInput, sessionInstant, sessionTimeCandidates } from "./sessionTime";

it("converts Los Angeles wall times independently of browser timezone, including midnight and spring DST", () => {
  const start = sessionInstant("2026-03-07T23:30", "earlier")!;
  const end = sessionInstant("2026-03-08T03:30", "earlier")!;
  expect(start).toBe("2026-03-08T07:30:00.000Z");
  expect(end).toBe("2026-03-08T10:30:00.000Z");
  expect((Date.parse(end) - Date.parse(start)) / 1000).toBe(10800);
  expect(losAngelesInput("2026-04-20T07:00:00.000Z")).toBe("2026-04-20T00:00:00");
  expect(sessionTimeCandidates("2026-03-08T02:30")).toEqual([]);
  expect(sessionTimeCandidates("2026-02-30T12:00")).toEqual([]);
  expect(sessionTimeCandidates("malformed")).toEqual([]);
});
it("offers both fall DST instants, preserving the stored clock occurrence and subsecond precision", () => {
  expect(sessionTimeCandidates("2026-11-01T01:30")).toEqual(["2026-11-01T08:30:00.000Z", "2026-11-01T09:30:00.000Z"]);
  const later = "2026-11-01T09:30:00.123Z";
  expect(initialOccurrence(later)).toBe("later");
  expect(sessionInstant(losAngelesInput(later), "later")).toBe(later);
  expect(initialOccurrence("2026-04-20T17:00:00.000Z")).toBe("earlier");
});
