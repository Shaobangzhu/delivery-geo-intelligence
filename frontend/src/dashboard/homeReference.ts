export interface HomeReference { longitude: number; latitude: number }

/** Optional local WGS84 configuration; blanks never become a zero-coordinate fallback. */
export function parseHomeReference(longitude: unknown, latitude: unknown): HomeReference | null {
  const coordinate = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return NaN;
    // Accept decimal notation, not hexadecimal or arbitrary coerced values.
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) return NaN;
    return Number(value);
  };
  const lon = coordinate(longitude), lat = coordinate(latitude);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { longitude: lon, latitude: lat };
}

export const HOME_REFERENCE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="14" fill="#1262df" stroke="white" stroke-width="1.5"/><path d="M6 14L15 6l9 8-2 2-1-1v9h-5v-6h-3v6H9v-9l-1 1z" fill="white"/></svg>';
