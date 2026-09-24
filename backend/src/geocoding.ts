import { z } from "zod";
import { pointSchema, type GeoJsonPoint } from "./model.js";

const ARCGIS_GEOCODE_URL = "https://geocode-api.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates";
const MIN_SCORE = 90;
const ADDRESS_MATCH_TYPES = new Set(["PointAddress", "Subaddress", "StreetAddress"]);

const candidateSchema = z.object({
  score: z.number().finite().min(0).max(100),
  location: z.object({ x: z.number(), y: z.number() }),
  attributes: z.object({ Addr_type: z.string() })
});
const resultSchema = z.object({
  spatialReference: z.object({ wkid: z.number().optional(), latestWkid: z.number().optional() }),
  candidates: z.array(z.unknown())
});

export type GeocodingFailure = "no_match" | "low_confidence" | "unusable_result" | "provider_error" | "network_error";

export class GeocodingError extends Error {
  constructor(public readonly code: GeocodingFailure) {
    super("Address geocoding failed");
    this.name = "GeocodingError";
  }
}

export type StoredGeocoder = (address: string) => Promise<GeoJsonPoint>;
export type DestinationGeocoder = StoredGeocoder;
export type MerchantGeocoder = StoredGeocoder;

/** Round WGS84 degrees to a stable grid; no raw coordinate leaves this function. */
export function generalizeCoordinates(longitude: number, latitude: number, decimals: number): GeoJsonPoint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 2) {
    throw new RangeError("Invalid destination coordinate precision");
  }
  const exact = pointSchema.safeParse({ type: "Point", coordinates: [longitude, latitude] });
  if (!exact.success) throw new RangeError("Invalid geocoder coordinate");
  const factor = 10 ** decimals;
  const round = (value: number) => {
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  return { type: "Point", coordinates: [round(longitude), round(latitude)] };
}

export function createArcGisStoredGeocoder(
  apiKey: string,
  fetcher: typeof fetch = fetch
): StoredGeocoder {
  if (!apiKey) throw new Error("ArcGIS geocoding credential is missing");

  return async (address: string) => {
    const body = new URLSearchParams({
      f: "json",
      SingleLine: address,
      outSr: "4326",
      outFields: "Addr_type",
      maxLocations: "1",
      matchOutOfRange: "false",
      forStorage: "true"
    });

    const signal = AbortSignal.timeout(8000);
    let response: Response;
    try {
      response = await fetcher(ARCGIS_GEOCODE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Esri-Authorization": `Bearer ${apiKey}`
        },
        body,
        signal
      });
    } catch {
      throw new GeocodingError("network_error");
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new GeocodingError(signal.aborted ? "network_error" : "provider_error");
    }
    if (!response.ok || (typeof payload === "object" && payload !== null && "error" in payload)) {
      throw new GeocodingError("provider_error");
    }

    const parsed = resultSchema.safeParse(payload);
    if (!parsed.success) throw new GeocodingError("unusable_result");
    const { spatialReference, candidates } = parsed.data;
    if (spatialReference.wkid !== 4326 && spatialReference.latestWkid !== 4326) {
      throw new GeocodingError("unusable_result");
    }
    if (candidates.length === 0) throw new GeocodingError("no_match");

    const candidate = candidateSchema.safeParse(candidates[0]);
    if (!candidate.success) throw new GeocodingError("unusable_result");
    if (candidate.data.score < MIN_SCORE || !ADDRESS_MATCH_TYPES.has(candidate.data.attributes.Addr_type)) {
      throw new GeocodingError("low_confidence");
    }
    const exact = pointSchema.safeParse({ type: "Point", coordinates: [candidate.data.location.x, candidate.data.location.y] });
    if (!exact.success) throw new GeocodingError("unusable_result");
    return exact.data;
  };
}

export function createArcGisGeocoder(
  apiKey: string,
  decimals: number,
  fetcher: typeof fetch = fetch
): DestinationGeocoder {
  const exactGeocode = createArcGisStoredGeocoder(apiKey, fetcher);
  return async (address: string) => {
    const exact = await exactGeocode(address);
    return generalizeCoordinates(exact.coordinates[0], exact.coordinates[1], decimals);
  };
}
