import type { Db, Filter } from "mongodb";
import { z } from "zod";
import { categorySchema, type DeliveryDocument, type MerchantDocument } from "./model.js";

export const dashboardFilterSchema = z.strictObject({
  period: z.enum(["week", "month", "year"]).default("week"),
  category: z.union([z.literal("all"), categorySchema]).default("all"),
  asOf: z.iso.date().optional()
});
export type DashboardFilters = z.infer<typeof dashboardFilterSchema>;

const TIME_ZONE = "America/Los_Angeles";
const categories = categorySchema.options;
const localDateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: TIME_ZONE, timeZoneName: "shortOffset" });

function localDate(instant: Date): string {
  const parts = localDateFormatter.formatToParts(instant);
  const part = (name: string) => parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function civilDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function offsetMinutes(instant: Date): number {
  const offset = offsetFormatter.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(offset ?? "");
  if (!match) throw new Error("Could not resolve dashboard time zone");
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
}

function localMidnight(date: Date): Date {
  const utcMidnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const offset = offsetMinutes(new Date(utcMidnight + 8 * 60 * 60_000));
  return new Date(utcMidnight - offset * 60_000);
}

function addCivilDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function resolveDashboardFilters(filters: DashboardFilters, now = new Date()) {
  const anchor = new Date(`${filters.asOf ?? localDate(now)}T00:00:00Z`);
  let startCivil: Date;
  let endCivil: Date;
  if (filters.period === "week") {
    startCivil = addCivilDays(anchor, -((anchor.getUTCDay() + 6) % 7));
    endCivil = addCivilDays(startCivil, 7);
  } else if (filters.period === "month") {
    startCivil = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    endCivil = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 1));
  } else {
    startCivil = new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1));
    endCivil = new Date(Date.UTC(anchor.getUTCFullYear() + 1, 0, 1));
  }
  return {
    period: filters.period, category: filters.category, timeZone: TIME_ZONE,
    start: localMidnight(startCivil), endExclusive: localMidnight(endCivil),
    startDate: civilDate(startCivil), endDate: civilDate(addCivilDays(endCivil, -1)),
    startCivil, endCivil
  };
}

type MerchantSummary = { id: string; name: string; category: MerchantDocument["category"]; city: string };
type Ranking = MerchantSummary & { deliveries: number; totalEarnings: number | null; averageEarnings: number | null; sampleCount: number };

function sumKnownPayouts(rows: DeliveryDocument[]) {
  const known = rows.filter((row) => row.payout !== undefined);
  return { value: known.length ? known.reduce((sum, row) => sum + row.payout!, 0) : null, sampleCount: known.length };
}

function merchantSummary(merchant: MerchantDocument): MerchantSummary {
  return { id: merchant._id.toHexString(), name: merchant.name, category: merchant.category, city: merchant.city };
}

function rankingByValue(rows: Ranking[], value: "totalEarnings" | "averageEarnings") {
  return [...rows].filter((row) => row.sampleCount > 0).sort((a, b) =>
    (b[value] ?? 0) - (a[value] ?? 0) || b.sampleCount - a.sampleCount || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  )[0] ?? null;
}

async function resolveDashboardQuery(db: Db, filters: DashboardFilters, now: Date) {
  const range = resolveDashboardFilters(filters, now);
  const merchantFilter: Filter<MerchantDocument> = filters.category === "all" ? {} : { category: filters.category };
  const merchants = await db.collection<MerchantDocument>("merchants").find(merchantFilter).toArray();
  const deliveryFilter: Filter<DeliveryDocument> = {
    pickedUpAt: { $gte: range.start, $lt: range.endExclusive },
    merchantId: { $in: merchants.map((merchant) => merchant._id) }
  };
  return { range, merchants, deliveryFilter };
}

export async function getDestinationHeatmap(db: Db, filters: DashboardFilters, now = new Date()) {
  const { deliveryFilter } = await resolveDashboardQuery(db, filters, now);
  const rows = await db.collection<DeliveryDocument>("deliveries").find(
    { ...deliveryFilter, destinationLocation: { $exists: true } },
    { projection: { _id: 0, destinationLocation: 1 } }
  ).toArray();
  const cells = new Map<string, { location: NonNullable<DeliveryDocument["destinationLocation"]>; count: number }>();
  for (const row of rows) {
    if (!row.destinationLocation) continue;
    const key = row.destinationLocation.coordinates.join(",");
    const cell = cells.get(key) ?? { location: row.destinationLocation, count: 0 };
    cell.count += 1;
    cells.set(key, cell);
  }
  return { cells: [...cells.values()].sort((a, b) => b.count - a.count ||
    a.location.coordinates[0] - b.location.coordinates[0] || a.location.coordinates[1] - b.location.coordinates[1]) };
}

export async function getDashboardAnalytics(db: Db, filters: DashboardFilters, now = new Date()) {
  const { range, merchants, deliveryFilter } = await resolveDashboardQuery(db, filters, now);
  const merchantById = new Map(merchants.map((merchant) => [merchant._id.toHexString(), merchant]));
  const deliveries = await db.collection<DeliveryDocument>("deliveries").find(deliveryFilter).toArray();
  const byMerchant = new Map<string, DeliveryDocument[]>();
  const destinationAreas = new Set<string>();
  for (const delivery of deliveries) {
    const id = delivery.merchantId.toHexString();
    const group = byMerchant.get(id) ?? [];
    group.push(delivery);
    byMerchant.set(id, group);
    if (delivery.destinationLocation) {
      destinationAreas.add(delivery.destinationLocation.coordinates.join(","));
    }
  }

  const rankings: Ranking[] = [...byMerchant].flatMap(([id, rows]) => {
    const merchant = merchantById.get(id);
    if (!merchant) return [];
    const earnings = sumKnownPayouts(rows);
    return [{ ...merchantSummary(merchant), deliveries: rows.length,
      totalEarnings: earnings.value, averageEarnings: earnings.value === null ? null : earnings.value / earnings.sampleCount,
      sampleCount: earnings.sampleCount }];
  }).sort((a, b) => b.deliveries - a.deliveries || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const categoryDistribution = categories.map((category) => ({
    category, deliveries: deliveries.filter((delivery) => merchantById.get(delivery.merchantId.toHexString())?.category === category).length
  }));

  const timeline = [];
  if (filters.period === "year") {
    for (let month = 0; month < 12; month += 1) {
      const date = new Date(Date.UTC(range.startCivil.getUTCFullYear(), month, 1));
      const key = civilDate(date).slice(0, 7);
      timeline.push({ date: key, deliveries: deliveries.filter((delivery) => localDate(delivery.pickedUpAt).startsWith(key)).length });
    }
  } else {
    for (let date = range.startCivil; date < range.endCivil; date = addCivilDays(date, 1)) {
      const key = civilDate(date);
      timeline.push({ date: key, deliveries: deliveries.filter((delivery) => localDate(delivery.pickedUpAt) === key).length });
    }
  }

  const pickupVolume = rankings.map((ranking) => ({
    ...ranking, location: merchantById.get(ranking.id)!.location
  }));
  const merchantDiversity = pickupVolume.map(({ id, name, category, city, location }) =>
    ({ id, name, category, city, distinctMerchantCount: 1, location }));
  const earnings = sumKnownPayouts(deliveries);

  return {
    filters: {
      period: range.period, category: range.category,
      range: { start: range.start.toISOString(), endExclusive: range.endExclusive.toISOString(),
        startDate: range.startDate, endDate: range.endDate, timeZone: range.timeZone }
    },
    summary: {
      totalDeliveries: deliveries.length, uniqueMerchants: rankings.length,
      observedDestinationAreas: destinationAreas.size, totalEarnings: earnings,
      topMerchantByOrders: rankings[0] ?? null,
      topMerchantByTotalEarnings: rankingByValue(rankings, "totalEarnings"),
      topMerchantByAverageEarnings: rankingByValue(rankings, "averageEarnings")
    },
    categoryDistribution, pickupTimeline: timeline, topMerchants: rankings,
    map: { pickupVolume, merchantDiversity }
  };
}
