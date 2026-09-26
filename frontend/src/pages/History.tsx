import { useEffect, useMemo, useState } from "react";
import { listDeliveries, listMerchants, userFacingError, type Category, type Delivery, type DeliveryPage, type Merchant, type SortOrder } from "../history/api";
import { ConfirmDelete } from "../history/ConfirmDelete";
import { DeliveryModal } from "../history/DeliveryModal";
import "../history/history.css";

const PAGE_SIZE = 10;
const emptyPage: DeliveryPage = { data: [], pagination: { page: 1, pageSize: PAGE_SIZE, total: 0, totalPages: 0 } };
const categories: { value: Category | ""; label: string }[] = [
  { value: "", label: "All Categories" }, { value: "restaurant", label: "Restaurant" },
  { value: "grocery", label: "Grocery" }, { value: "retail", label: "Retail" }, { value: "other", label: "Other" }
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
  }).format(new Date(value));
}

function pageNumbers(page: number, totalPages: number): number[] {
  const start = Math.max(1, Math.min(page - 2, totalPages - 4));
  return Array.from({ length: Math.min(totalPages, 5) }, (_, index) => start + index);
}

export function History() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantError, setMerchantError] = useState("");
  const [result, setResult] = useState<DeliveryPage>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [page, setPage] = useState(1);
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<Delivery | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<Delivery | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    listMerchants(controller.signal).then((rows) => { if (active) setMerchants(rows); }).catch((error: unknown) => {
      if (active && !isAbort(error)) setMerchantError(userFacingError(error));
    });
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    if (fromDate && toDate && fromDate > toDate) {
      setResult(emptyPage);
      setListError("Start date must be on or before end date.");
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setListError("");
    listDeliveries({ search, category, fromDate, toDate, sort, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((data) => { if (active) { setResult(data); setLoading(false); } })
      .catch((error: unknown) => {
        if (active && !isAbort(error)) { setListError(userFacingError(error)); setLoading(false); }
      });
    return () => { active = false; controller.abort(); };
  }, [search, category, fromDate, toDate, sort, page, reload]);

  const merchantById = useMemo(() => new Map(merchants.map((merchant) => [merchant.id, merchant])), [merchants]);
  const { total, totalPages } = result.pagination;
  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  function refreshAfterSave() {
    setEditor(undefined);
    setPage(1);
    setReload((value) => value + 1);
  }

  function refreshAfterDelete() {
    setDeleteTarget(null);
    if (result.data.length === 1 && page > 1) setPage(page - 1);
    else setReload((value) => value + 1);
  }

  return (
    <section className="history-page" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <div className="section-kicker">History</div>
          <h1 id="history-title">Delivery History</h1>
          <p>Create, edit, and maintain delivery records before they feed dashboard analytics.</p>
        </div>
        <button type="button" className="button primary add-delivery" data-history-primary onClick={() => setEditor(null)}>
          <span aria-hidden="true">＋</span> Add Delivery
        </button>
      </div>

      <div className="history-filters" aria-label="Delivery filters">
        <div className="filter-field search-field">
          <label htmlFor="merchant-search">Merchant search</label>
          <input id="merchant-search" type="search" placeholder="Search merchant…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </div>
        <div className="filter-field category-field">
          <label htmlFor="category-filter">Category</label>
          <select id="category-filter" value={category} onChange={(event) => { setCategory(event.target.value as Category | ""); setPage(1); }}>
            {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="filter-field date-field">
          <label htmlFor="date-from">From date</label>
          <input id="date-from" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
        </div>
        <div className="filter-field date-field">
          <label htmlFor="date-to">To date</label>
          <input id="date-to" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
        </div>
        <div className="filter-field sort-field">
          <label htmlFor="sort-order">Sort</label>
          <select id="sort-order" value={sort} onChange={(event) => { setSort(event.target.value as SortOrder); setPage(1); }}>
            <option value="newest">Newest First</option><option value="oldest">Oldest First</option>
            <option value="payoutDesc">Highest Payout</option><option value="payoutAsc">Lowest Payout</option>
            <option value="distanceDesc">Longest Distance</option><option value="distanceAsc">Shortest Distance</option>
          </select>
        </div>
      </div>

      {merchantError && <p className="history-alert" role="alert">Merchant list: {merchantError}</p>}
      {listError && <p className="history-alert" role="alert">{listError}</p>}

      <div className="history-table-card">
        <div className="table-scroll"><table className="history-table">
          <thead><tr><th scope="col">Date &amp; Time</th><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Payout</th><th scope="col">Distance</th><th scope="col">Destination</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="table-message">Loading deliveries…</td></tr>
              : result.data.length === 0 ? <tr><td colSpan={7} className="table-message">{listError ? "No records to display." : "No deliveries match the current filters."}</td></tr>
              : result.data.map((delivery) => {
                const merchant = merchantById.get(delivery.merchantId);
                return <tr key={delivery.id}>
                  <td className="date-cell">{formatDateTime(delivery.pickedUpAt)}</td>
                  <td><span className="merchant-name">{merchant?.name ?? "Unknown merchant"}</span>{merchant && <span className="merchant-city">{merchant.publicAddress ?? merchant.city}</span>}</td>
                  <td><span className={`category-label${merchant ? ` category-${merchant.category}` : ""}`}>{merchant ? categories.find((item) => item.value === merchant.category)?.label : "Unknown"}</span></td>
                  <td className="number-cell">{delivery.payout === undefined ? "—" : `$${delivery.payout.toFixed(2)}`}</td>
                  <td className="number-cell">{delivery.distanceMiles === undefined ? "—" : `${delivery.distanceMiles.toFixed(1)} mi`}</td>
                  <td><span className={delivery.hasDestinationLocation ? "destination-status ready" : "destination-status missing"}>{delivery.hasDestinationLocation ? "Location Ready" : "No Location"}</span></td>
                  <td><div className="row-actions">
                    <button type="button" className="icon-action" aria-label={`Edit delivery for ${merchant?.name ?? "unknown merchant"}`} onClick={() => setEditor(delivery)} title="Edit delivery">✎</button>
                    <button type="button" className="icon-action destructive" aria-label={`Delete delivery for ${merchant?.name ?? "unknown merchant"}`} onClick={() => setDeleteTarget(delivery)} title="Delete delivery">⌫</button>
                  </div></td>
                </tr>;
              })}
          </tbody>
        </table></div>
        <div className="table-footer">
          <span>Showing {startItem}{total > 0 ? `–${endItem}` : ""} of {total} deliveries</span>
          <nav className="pagination" aria-label="Delivery pages">
            <button type="button" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>‹</button>
            {pageNumbers(page, totalPages).map((number) => <button key={number} type="button" aria-label={`Page ${number}`} aria-current={number === page ? "page" : undefined} disabled={loading} onClick={() => setPage(number)}>{number}</button>)}
            <button type="button" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>›</button>
          </nav>
        </div>
      </div>

      {editor !== undefined && <DeliveryModal key={editor?.id ?? "new"} delivery={editor} merchants={merchants} onClose={() => setEditor(undefined)} onSaved={refreshAfterSave} />}
      {deleteTarget && <ConfirmDelete delivery={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={refreshAfterDelete} />}
    </section>
  );
}
