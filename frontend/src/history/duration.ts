/** Manually observed elapsed seconds; missing data stays unknown. */
export function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return [[hours, "hr"], [minutes, "min"], [remainder, "sec"]]
    .filter(([value]) => value !== 0)
    .map(([value, unit]) => `${value} ${unit}${value === 1 ? "" : "s"}`)
    .join(" ");
}
