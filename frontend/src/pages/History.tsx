import { Button, Input, Select, Table } from "@shaobangzhu/clu-ui";
import { Pagination } from "../components/Pagination";
import { PAGE_SIZE } from "../components/pageRange";
import { PlatformOptions, platformLabel, type PlatformFilter } from "../history/platform";
import { useEffect, useMemo, useState } from "react";
import { listDeliveries, listMerchants, userFacingError, type Category, type Delivery, type DeliveryPage, type Merchant, type SortOrder } from "../history/api";
import { ConfirmDelete } from "../history/ConfirmDelete";
import { DeliveryModal } from "../history/DeliveryModal";
import { formatDuration } from "../history/duration";
import { Prop22Payments } from "../history/Prop22Payments";
import { UberAnnualStatements } from "../history/UberAnnualStatements";
import { UberSessions } from "../history/UberSessions";
import "../history/history.css";

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

export function History() {
  const [addingPayment, setAddingPayment] = useState(false);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [merchantError, setMerchantError] = useState("");
  const [result, setResult] = useState<DeliveryPage>(emptyPage);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [platform, setPlatform] = useState<PlatformFilter>("");
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
    listDeliveries({ platform, search, category, fromDate, toDate, sort, page, pageSize: PAGE_SIZE }, controller.signal)
      .then((data) => {
        if (!active) return;
        const lastPage = Math.max(1, data.pagination.totalPages);
        if (page > lastPage) {
          setPage(lastPage);
          return;
        }
        setResult(data);
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (active && !isAbort(error)) { setListError(userFacingError(error)); setLoading(false); }
      });
    return () => { active = false; controller.abort(); };
  }, [platform, search, category, fromDate, toDate, sort, page, reload]);

  const merchantById = useMemo(() => new Map(merchants.map((merchant) => [merchant.id, merchant])), [merchants]);
  const { total } = result.pagination;

  function refreshAfterSave() {
    setEditor(undefined);
    if (editor === null) setPage(1);
    setReload((value) => value + 1);
  }

  function refreshAfterDelete() {
    setDeleteTarget(null);
    if (result.data.length === 1 && page > 1) setPage(page - 1);
    setReload((value) => value + 1);
  }

  return (
    <section className="history-page" data-clu-theme="light" aria-labelledby="history-title">
      <div className="history-heading">
        <div>
          <div className="section-kicker">History</div>
          <h1 id="history-title">Delivery History</h1>
          <p>Create, edit, and maintain delivery records before they feed dashboard analytics.</p>
        </div>
        <div className="history-primary-actions"><Button type="button" variant="secondary" size="small" onClick={() => setAddingPayment(true)}>＋ Add Prop 22 Payment</Button>
        <Button type="button" variant="primary" size="small" className="add-delivery" data-history-primary onClick={() => setEditor(null)}>
          <span aria-hidden="true">＋</span> Add Delivery
        </Button></div>
      </div>

      <div className="history-filters" aria-label="Delivery filters">
        <div className="filter-field search-field">
          <label htmlFor="merchant-search">Merchant search</label>
          <Input id="merchant-search" type="search" placeholder="Search merchant…" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
        </div>
        <div className="filter-field"><label htmlFor="delivery-platform-filter">Delivery Platform</label>
          <Select id="delivery-platform-filter" value={platform} onChange={(event) => { setPlatform(event.target.value as PlatformFilter); setPage(1); }}><PlatformOptions filter /></Select>
        </div>
        <div className="filter-field category-field">
          <label htmlFor="category-filter">Category</label>
          <Select id="category-filter" value={category} onChange={(event) => { setCategory(event.target.value as Category | ""); setPage(1); }}>
            {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
        <div className="filter-field date-field">
          <label htmlFor="date-from">From date</label>
          <Input id="date-from" type="date" value={fromDate} onChange={(event) => { setFromDate(event.target.value); setPage(1); }} />
        </div>
        <div className="filter-field date-field">
          <label htmlFor="date-to">To date</label>
          <Input id="date-to" type="date" value={toDate} onChange={(event) => { setToDate(event.target.value); setPage(1); }} />
        </div>
        <div className="filter-field sort-field">
          <label htmlFor="sort-order">Sort</label>
          <Select id="sort-order" value={sort} onChange={(event) => { setSort(event.target.value as SortOrder); setPage(1); }}>
            <option value="newest">Newest First</option><option value="oldest">Oldest First</option>
            <option value="payoutDesc">Highest Payout</option><option value="payoutAsc">Lowest Payout</option>
            <option value="distanceDesc">Longest Distance</option><option value="distanceAsc">Shortest Distance</option>
          </Select>
        </div>
      </div>

      {merchantError && <p className="history-alert" role="alert">Merchant list: {merchantError}</p>}
      {listError && <p className="history-alert" role="alert">{listError}</p>}

      <div className="history-table-card">
        <Table.ScrollArea label="Delivery records" className="table-scroll"><Table density="compact" className="history-table">
          <Table.Header><Table.Row><Table.HeadCell scope="col">Date &amp; Time</Table.HeadCell><Table.HeadCell scope="col">Merchant</Table.HeadCell><Table.HeadCell scope="col">Category</Table.HeadCell><Table.HeadCell scope="col">Platform</Table.HeadCell><Table.HeadCell scope="col">Payout</Table.HeadCell><Table.HeadCell scope="col">Distance</Table.HeadCell><Table.HeadCell scope="col">Duration</Table.HeadCell><Table.HeadCell scope="col">Destination</Table.HeadCell><Table.HeadCell scope="col">Actions</Table.HeadCell></Table.Row></Table.Header>
          <Table.Body>
            {loading ? <Table.MessageRow colSpan={9} className="dgi-table-message">Loading deliveries…</Table.MessageRow>
              : result.data.length === 0 ? <Table.MessageRow colSpan={9} className="dgi-table-message">{listError ? "No records to display." : "No deliveries match the current filters."}</Table.MessageRow>
              : result.data.map((delivery) => {
                const merchant = merchantById.get(delivery.merchantId);
                return <Table.Row key={delivery.id}>
                  <Table.Cell className="date-cell">{formatDateTime(delivery.pickedUpAt)}</Table.Cell>
                  <Table.Cell><span className="merchant-name">{merchant?.name ?? "Unknown merchant"}</span>{merchant && <span className="merchant-city">{merchant.publicAddress ?? merchant.city}</span>}</Table.Cell>
                  <Table.Cell><span className={`category-label${merchant ? ` category-${merchant.category}` : ""}`}>{merchant ? categories.find((item) => item.value === merchant.category)?.label : "Unknown"}</span></Table.Cell>
                  <Table.Cell><span className="platform-label">{platformLabel(delivery.platform)}</span></Table.Cell>
                  <Table.Cell className="number-cell">{delivery.payout === undefined ? "—" : `$${delivery.payout.toFixed(2)}`}</Table.Cell>
                  <Table.Cell className="number-cell">{delivery.distanceMiles === undefined ? "—" : `${delivery.distanceMiles.toFixed(1)} mi`}</Table.Cell>
                  <Table.Cell className="duration-cell">{formatDuration(delivery.deliveryDurationSeconds)}</Table.Cell>
                  <Table.Cell><span className={delivery.hasDestinationLocation ? "destination-status ready" : "destination-status missing"}>{delivery.hasDestinationLocation ? "Location Ready" : "No Location"}</span></Table.Cell>
                  <Table.Cell><div className="row-actions">
                    <Button type="button" variant="secondary" size="small" className="dgi-row-action" aria-label={`Edit delivery for ${merchant?.name ?? "unknown merchant"}`} onClick={() => setEditor(delivery)} title="Edit delivery">✎</Button>
                    <Button type="button" variant="danger" size="small" className="dgi-row-action" aria-label={`Delete delivery for ${merchant?.name ?? "unknown merchant"}`} onClick={() => setDeleteTarget(delivery)} title="Delete delivery">⌫</Button>
                  </div></Table.Cell>
                </Table.Row>;
              })}
          </Table.Body>
        </Table></Table.ScrollArea>
        <Pagination page={page} total={total} noun="deliveries" label="Delivery pages" disabled={loading} onPageChange={setPage} />
      </div>

      <Prop22Payments adding={addingPayment} onCloseAdd={() => setAddingPayment(false)} />
      <UberSessions merchants={merchants} deliveryRevision={reload} />
      <UberAnnualStatements />
      {editor !== undefined && <DeliveryModal key={editor?.id ?? "new"} delivery={editor} merchants={merchants} onClose={() => setEditor(undefined)} onSaved={refreshAfterSave} />}
      {deleteTarget && <ConfirmDelete delivery={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={refreshAfterDelete} />}
    </section>
  );
}
