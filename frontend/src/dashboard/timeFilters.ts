import { useEffect, useState } from "react";

export function losAngelesDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find((item) => item.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function dashboardYears(date: string): number[] {
  const current = Number(date.slice(0, 4));
  return Array.from({ length: Math.max(0, current - 2026 + 1) }, (_, index) => current - index);
}

/** Advance an open page on local day/year rollover, including after sleep. */
export function useLosAngelesDate(): string {
  const [date, setDate] = useState(() => losAngelesDate());
  useEffect(() => {
    const refresh = () => setDate(losAngelesDate());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return date;
}
