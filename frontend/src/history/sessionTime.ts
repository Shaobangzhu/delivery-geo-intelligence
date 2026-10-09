const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
export function losAngelesInput(iso: string) {
  const date = new Date(iso);
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}` +
    (date.getUTCMilliseconds() ? `.${String(date.getUTCMilliseconds()).padStart(3, "0")}` : "");
}
/** Validate wall time against actual LA offsets; reject DST gaps and expose both fold instants. */
export function sessionTimeCandidates(local: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(local);
  if (!match) return [];
  const [, year, month, day, hour, minute, second = "00", fraction = ""] = match;
  if (Number(year) < 2000 || Number(year) > 2100) return [];
  const millis = fraction.padEnd(3, "0");
  const normalized = `${year}-${month}-${day}T${hour}:${minute}:${second}` + (Number(millis) ? `.${millis}` : "");
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second), Number(millis));
  return [7, 8].map((offset) => new Date(wall + offset * 3_600_000).toISOString()).filter((iso) => losAngelesInput(iso) === normalized);
}
export function sessionInstant(local: string, occurrence: "earlier" | "later"): string | null {
  const options = sessionTimeCandidates(local);
  return options[occurrence === "later" ? options.length - 1 : 0] ?? null;
}
export function initialOccurrence(iso?: string): "earlier" | "later" {
  if (!iso) return "earlier";
  return sessionTimeCandidates(losAngelesInput(iso)).at(-1) === iso && sessionTimeCandidates(losAngelesInput(iso)).length > 1 ? "later" : "earlier";
}
export function displaySessionTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
}
export function displaySessionDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "short", day: "numeric" }).format(new Date(iso));
}
