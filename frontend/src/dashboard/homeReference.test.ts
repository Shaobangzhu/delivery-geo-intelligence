import { expect, it } from "vitest";
import { parseHomeReference } from "./homeReference";

it("validates paired decimal WGS84 coordinates without blank coercion or guessed fallbacks", () => {
  expect(parseHomeReference("-117.5", "34.0")).toEqual({ longitude: -117.5, latitude: 34 });
  expect(parseHomeReference("-180", "-90")).toEqual({ longitude: -180, latitude: -90 });
  expect(parseHomeReference("180", "90")).toEqual({ longitude: 180, latitude: 90 });
  for (const [longitude, latitude] of [[undefined, undefined], [null, "34"], [true, "34"], ["", ""], ["-117.5", undefined], ["0x1", "34"], ["1e999", "34"], ["34", "-117.5"]]) {
    expect(parseHomeReference(longitude, latitude)).toBeNull();
  }
});
