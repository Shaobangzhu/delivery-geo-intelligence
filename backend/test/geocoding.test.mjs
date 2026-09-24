import assert from "node:assert/strict";
import test from "node:test";
import { createArcGisGeocoder, generalizeCoordinates } from "../dist/geocoding.js";

const transientInput = "synthetic-destination-token";
const candidate = {
  score: 98,
  location: { x: 0.123456, y: 0.654321 },
  attributes: { Addr_type: "PointAddress" }
};
const successPayload = { spatialReference: { wkid: 4326 }, candidates: [candidate] };

function mockFetch(payload, status = 200) {
  return async () => new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function expectFailure(payload, code, status = 200) {
  const geocode = createArcGisGeocoder("unit-test-key", 2, mockFetch(payload, status));
  await assert.rejects(() => geocode(transientInput), (error) => {
    assert.equal(error.code, code);
    assert.equal(error.message.includes(transientInput), false);
    return true;
  });
}

test("pure coordinate generalization is deterministic and bounded", () => {
  const first = generalizeCoordinates(0.123456, 0.654321, 2);
  assert.deepEqual(first, { type: "Point", coordinates: [0.12, 0.65] });
  assert.deepEqual(generalizeCoordinates(0.123456, 0.654321, 2), first);
  assert.deepEqual(generalizeCoordinates(0.123456, 0.654321, 1), { type: "Point", coordinates: [0.1, 0.7] });
  assert.throws(() => generalizeCoordinates(181, 0, 2), RangeError);
  assert.throws(() => generalizeCoordinates(0, 0, 3), RangeError);
});

test("ArcGIS request uses stored semantics, POST body, private header, and WGS84 output", async () => {
  let called = false;
  const geocode = createArcGisGeocoder("unit-test-key", 2, async (url, options) => {
    called = true;
    assert.equal(url, "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates");
    assert.equal(url.includes(transientInput), false);
    assert.equal(url.includes("unit-test-key"), false);
    assert.equal(options.method, "POST");
    assert.equal(options.headers["X-Esri-Authorization"], "Bearer unit-test-key");
    const body = new URLSearchParams(options.body);
    assert.equal(body.get("SingleLine"), transientInput);
    assert.equal(body.get("forStorage"), "true");
    assert.equal(body.get("outSr"), "4326");
    assert.equal(body.get("maxLocations"), "1");
    assert.equal(body.get("matchOutOfRange"), "false");
    return mockFetch(successPayload)();
  });
  assert.deepEqual(await geocode(transientInput), { type: "Point", coordinates: [0.12, 0.65] });
  assert.equal(called, true);
});

test("no match, low confidence, provider error, and unusable result stay generic", async () => {
  await expectFailure({ ...successPayload, candidates: [] }, "no_match");
  await expectFailure({ ...successPayload, candidates: [{ ...candidate, score: 70 }] }, "low_confidence");
  await expectFailure({ ...successPayload, candidates: [{ ...candidate, attributes: { Addr_type: "StreetName" } }] }, "low_confidence");
  await expectFailure({ ...successPayload, spatialReference: { wkid: 3857 } }, "unusable_result");
  await expectFailure({ ...successPayload, candidates: [{ ...candidate, location: { x: 181, y: 0 } }] }, "unusable_result");
  await expectFailure({ error: { code: 498, message: transientInput } }, "provider_error");
  await expectFailure({ error: { code: 403 } }, "provider_error", 403);
  const brokenJson = createArcGisGeocoder("unit-test-key", 2, async () => new Response("not json"));
  await assert.rejects(() => brokenJson(transientInput), { code: "provider_error" });
});

test("network failures never expose transient input", async () => {
  const geocode = createArcGisGeocoder("unit-test-key", 2, async () => {
    throw new Error("network detail containing private input");
  });
  await assert.rejects(() => geocode(transientInput), (error) => {
    assert.equal(error.code, "network_error");
    assert.equal(error.message.includes(transientInput), false);
    return true;
  });
});
