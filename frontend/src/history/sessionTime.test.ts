import { expect, it } from "vitest";
import { displaySessionTime, initialOccurrence, losAngelesInput, losAngelesMinuteInput, sessionInstant, sessionTimeCandidates } from "./sessionTime";

it.each([
  ["2026-01-15T08:00:45.123Z", "2026-01-15T00:00", "2026-01-15T08:00:00.000Z", "12:00 AM"],
  ["2026-01-15T20:00:00.000Z", "2026-01-15T12:00", "2026-01-15T20:00:00.000Z", "12:00 PM"],
  ["2026-07-15T18:34:00.000Z", "2026-07-15T11:34", "2026-07-15T18:34:00.000Z", "11:34 AM"],
  ["2026-07-16T06:59:59.999Z", "2026-07-15T23:59", "2026-07-16T06:59:00.000Z", "11:59 PM"],
  ["2026-11-01T08:30:12.345Z", "2026-11-01T01:30", "2026-11-01T08:30:00.000Z", "1:30 AM"],
  ["2026-11-01T09:30:12.345Z", "2026-11-01T01:30", "2026-11-01T09:30:00.000Z", "1:30 AM"]
])("formats %s as LA minutes and serializes the same local minute", (iso, local, normalized, clock) => {
  expect(losAngelesMinuteInput(iso)).toBe(local);
  expect(sessionInstant(local, initialOccurrence(iso))).toBe(normalized);
  expect(displaySessionTime(normalized)).toContain(clock);
});

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
