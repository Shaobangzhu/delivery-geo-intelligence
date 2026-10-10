import { expect, it } from "vitest";
import { dashboardYears, losAngelesDate } from "./timeFilters";
import { dashboardQuery } from "./api";

it("uses LA year rollover and generates descending options beginning in 2026", () => {
  const before = losAngelesDate(new Date("2028-01-01T07:59:59Z"));
  const after = losAngelesDate(new Date("2028-01-01T08:00:00Z"));
  expect(before).toBe("2027-12-31"); expect(after).toBe("2028-01-01");
  expect(dashboardYears(before)).toEqual([2027, 2026]);
  expect(dashboardYears(after)).toEqual([2028, 2027, 2026]);
  expect(dashboardYears("2030-06-01")).toEqual([2030, 2029, 2028, 2027, 2026]);
});
it("shares the wire contract and omits a remembered year in other modes", () => {
  expect(dashboardQuery("year", "grocery", 2026).toString()).toBe("period=year&category=grocery&year=2026");
  expect(dashboardQuery("all", "grocery", 2026).toString()).toBe("period=all&category=grocery");
});
