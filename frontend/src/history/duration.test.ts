import { expect, it } from "vitest";
import { formatDuration } from "./duration";

it.each([
  [undefined, "—"], [41, "41 secs"], [45, "45 secs"], [125, "2 mins 5 secs"],
  [492, "8 mins 12 secs"], [3600, "1 hr"], [3661, "1 hr 1 min 1 sec"],
  [3849, "1 hr 4 mins 9 secs"], [8280, "2 hrs 18 mins"]
])("formats observed duration %s as %s", (seconds, expected) => {
  expect(formatDuration(seconds)).toBe(expected);
});
