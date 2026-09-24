import { useEffect, useState } from "react";
import { loadDashboard, type Category, type DashboardData, type MerchantRanking, type Metric, type Period } from "../dashboard/api";
import "../dashboard/dashboard.css";

const periods: { value: Period; label: string }[] = [
  { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "year", label: "Year" }
];
const metrics: { value: Metric; label: string }[] = [
  { value: "pickupVolume", label: "Pickup Volume" },
  { value: "merchantDiversity", label: "Merchant Diversity" },
  { value: "destinationHeatmap", label: "Destination Heatmap" }
];
const categories: { value: Category; label: string }[] = [
  { value: "all", label: "All" }, { value: "restaurant", label: "Restaurant" },
  { value: "grocery", label: "Grocery" }, { value: "retail", label: "Retail" }, { value: "other", label: "Other" }
];
const colors: Record<Exclude<Category, "all">, string> = {
  restaurant: "#fa6a43", grocery: "#18a76c", retail: "#704ce0", other: "#6b86a5"
};

function money(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}

function MerchantCard({ label, row, kind }: { label: string; row: MerchantRanking | null; kind: "orders" | "total" | "average" }) {
  const value = kind === "orders" ? `${row?.deliveries ?? 0} deliveries`
    : kind === "total" ? money(row?.totalEarnings ?? null) : money(row?.averageEarnings ?? null);
  return <div className="dash-card merchant-card">
    <span className="stat-label">{label}</span><strong>{row?.name ?? "No data"}</strong>
    <span>{row ? value : "—"}</span>
    {kind !== "orders" && <small>{row ? `${row.sampleCount} known payout${row.sampleCount === 1 ? "" : "s"}` : "0 known payouts"}</small>}
  </div>;
}

function Distribution({ data }: { data: DashboardData }) {
  const total = data.summary.totalDeliveries;
  let cumulative = 0;
  const gradient = data.categoryDistribution.map((item) => {
    const start = cumulative;
    cumulative += total ? item.deliveries / total * 100 : 0;
    return `${colors[item.category]} ${start}% ${cumulative}%`;
  }).join(", ");
  return <section className="dash-card distribution-card" aria-labelledby="distribution-title">
    <h2 id="distribution-title">Merchant Category Distribution</h2>
    <div className="distribution-body">
      <div className="donut" style={{ background: total ? `conic-gradient(${gradient})` : "#e5edf8" }} aria-label={`${total} filtered deliveries`}>
        <div><strong>{total}</strong><span>Deliveries</span></div>
      </div>
      <ul className="distribution-legend">{data.categoryDistribution.map((item) => <li key={item.category}>
        <span className="legend-name"><i style={{ background: colors[item.category] }} />{item.category}</span><strong>{item.deliveries}</strong>
      </li>)}</ul>
    </div>
  </section>;
}

function Timeline({ data }: { data: DashboardData }) {
  const max = Math.max(1, ...data.pickupTimeline.map((item) => item.deliveries));
  return <section className="dash-card timeline-card" aria-labelledby="timeline-title">
    <h2 id="timeline-title">Observed Pickups Over Time</h2>
    <div className="timeline-chart" role="img" aria-label={`Pickup counts from ${data.filters.range.startDate} through ${data.filters.range.endDate}`}>
      {data.pickupTimeline.map((item, index) => <div className="timeline-bar-group" key={item.date} title={`${item.date}: ${item.deliveries} pickups`}>
        <span className="bar-value">{item.deliveries || ""}</span>
        <div className="bar-track"><div className="bar-fill" style={{ height: `${item.deliveries / max * 100}%` }} /></div>
        <span className="bar-label">{data.filters.period === "year" ? item.date.slice(5) : data.filters.period === "week" ? new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${item.date}T00:00:00Z`)) : index % 5 === 0 ? item.date.slice(-2) : ""}</span>
      </div>)}
    </div>
  </section>;
}

function MapPanel({ data, metric, mapMode, onMapMode }: { data: DashboardData; metric: Metric; mapMode: "heatmap" | "points"; onMapMode: (value: "heatmap" | "points") => void }) {
  const selectedCount = metric === "destinationHeatmap" ? data.map.destinationHeatmap.length : data.map[metric].length;
  return <section className="dash-card map-panel" aria-label={`${metrics.find((item) => item.value === metric)?.label} map area`}>
    {metric !== "destinationHeatmap" && <div className="map-mode" role="group" aria-label="Map display mode">
      <button type="button" aria-pressed={mapMode === "heatmap"} onClick={() => onMapMode("heatmap")}>Heatmap</button>
      <button type="button" aria-pressed={mapMode === "points"} onClick={() => onMapMode("points")}>Points</button>
    </div>}
    <div className="map-placeholder"><span className="map-placeholder-mark" aria-hidden="true">⌖</span>
      <strong>Map visualization</strong><span>ArcGIS rendering follows in a later phase.</span>
      <small>{selectedCount} filtered {metric === "destinationHeatmap" ? "generalized destination areas" : "merchant locations"} available</small>
    </div>
    <div className="map-caption">{metric === "destinationHeatmap" ? "Destination points are generalized before storage." : "Pickup locations represent physical merchant records."}</div>
  </section>;
}

export function Dashboard() {
  const [period, setPeriod] = useState<Period>("week");
  const [metric, setMetric] = useState<Metric>("pickupVolume");
  const [category, setCategory] = useState<Category>("all");
  const [mapMode, setMapMode] = useState<"heatmap" | "points">("heatmap");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError("");
    loadDashboard(period, category, controller.signal).then((result) => { setData(result); setLoading(false); })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("Dashboard analytics are unavailable. Try again.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [period, category]);

  return <section className="dashboard-page" aria-labelledby="dashboard-title">
    <div className="dashboard-heading"><div><div className="section-kicker">Dashboard</div><h1 id="dashboard-title">Observed Delivery Activity</h1></div>
      <div className="dashboard-range" aria-live="polite"><span aria-hidden="true">▦</span> {data ? `${dateLabel(data.filters.range.startDate)} – ${dateLabel(data.filters.range.endDate)}` : error ? "Date range unavailable" : "Loading date range…"}</div>
    </div>
    <div className="dashboard-filters">
      <div className="dashboard-filter"><span>Time Period</span><div className="segmented" role="group" aria-label="Time period">{periods.map((item) => <button key={item.value} type="button" aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</button>)}</div></div>
      <div className="dashboard-filter"><span>Metric / View</span><div className="segmented" role="group" aria-label="Map metric">{metrics.map((item) => <button key={item.value} type="button" aria-pressed={metric === item.value} onClick={() => setMetric(item.value)}>{item.label}</button>)}</div></div>
      <div className="dashboard-filter"><span>Category</span><div className="segmented" role="group" aria-label="Category">{categories.map((item) => <button key={item.value} type="button" aria-pressed={category === item.value} onClick={() => setCategory(item.value)}>{item.label}</button>)}</div></div>
    </div>
    {error && <p className="dashboard-error" role="alert">{error}</p>}
    {loading && <p className="dashboard-loading" role="status">Loading dashboard analytics…</p>}
    {data && !loading && <div className="dashboard-grid">
      <MapPanel data={data} metric={metric} mapMode={mapMode} onMapMode={setMapMode} />
      <div className="dashboard-details">
        <div className="summary-grid">
          <div className="dash-card stat-card"><span className="stat-label">Total Deliveries</span><strong>{data.summary.totalDeliveries}</strong></div>
          <div className="dash-card stat-card"><span className="stat-label">Unique Merchants</span><strong>{data.summary.uniqueMerchants}</strong></div>
          <div className="dash-card stat-card"><span className="stat-label">Observed Destination Areas</span><strong>{data.summary.observedDestinationAreas}</strong></div>
          <div className="dash-card stat-card"><span className="stat-label">Total Earnings</span><strong>{money(data.summary.totalEarnings.value)}</strong><small>{data.summary.totalEarnings.sampleCount} known payouts</small></div>
        </div>
        <div className="merchant-grid">
          <MerchantCard label="Top Merchant by Orders" row={data.summary.topMerchantByOrders} kind="orders" />
          <MerchantCard label="Top Merchant by Total Earnings" row={data.summary.topMerchantByTotalEarnings} kind="total" />
          <MerchantCard label="Top Merchant by Average Earnings" row={data.summary.topMerchantByAverageEarnings} kind="average" />
        </div>
        <div className="charts-grid"><Distribution data={data} /><Timeline data={data} /></div>
        <section className="dash-card ranking-card" aria-labelledby="ranking-title"><h2 id="ranking-title">Top Merchants by Deliveries</h2>
          <div className="ranking-scroll"><table><thead><tr><th scope="col">#</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Deliveries</th><th scope="col">Total Earnings</th><th scope="col">Avg Earnings</th></tr></thead>
          <tbody>{data.topMerchants.length ? data.topMerchants.map((row, index) => <tr key={row.id}><td>{index + 1}</td><td><strong>{row.name}</strong><small>{row.city}</small></td><td>{row.category}</td><td>{row.deliveries}</td><td>{money(row.totalEarnings)} <small>{row.sampleCount} known</small></td><td>{money(row.averageEarnings)} <small>{row.sampleCount} known</small></td></tr>) : <tr><td colSpan={6} className="empty-ranking">No deliveries in this period.</td></tr>}</tbody></table></div>
        </section>
      </div>
    </div>}
    <div className="dashboard-methodology"><strong>Methodology</strong><span>Based on personally observed delivery activity in the displayed Los Angeles time range. Earnings include known payouts only; averages use their known payout sample. Destination locations are generalized, and results do not represent overall demand.</span></div>
  </section>;
}
