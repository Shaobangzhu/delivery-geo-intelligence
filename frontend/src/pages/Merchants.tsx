import { useEffect, useMemo, useState } from "react";
import type { Category } from "../history/api";
import { ConfirmMerchantDelete } from "../merchants/ConfirmMerchantDelete";
import { listMerchantRecords, merchantError, type MerchantRecord } from "../merchants/api";
import { MerchantModal } from "../merchants/MerchantModal";
import "../history/history.css";
import "../merchants/merchants.css";

const categories: { value: Category | ""; label: string }[] = [
  { value: "", label: "All Categories" }, { value: "restaurant", label: "Restaurant" },
  { value: "grocery", label: "Grocery" }, { value: "retail", label: "Retail" }, { value: "other", label: "Other" }
];

export function Merchants() {
  const [records, setRecords] = useState<MerchantRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category | "">("");
  const [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<MerchantRecord | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<MerchantRecord | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");
    listMerchantRecords(controller.signal).then((data) => {
      if (active) { setRecords(data); setLoading(false); }
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(merchantError(cause));
      setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [reload]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return records.filter((merchant) => (!category || merchant.category === category) &&
      (!query || [merchant.name, merchant.publicAddress ?? "", merchant.city].some((value) => value.toLocaleLowerCase().includes(query))));
  }, [records, search, category]);

  function refresh() {
    setEditor(undefined);
    setDeleteTarget(null);
    setReload((value) => value + 1);
  }

  return <section className="merchants-page" aria-labelledby="merchants-title">
    <div className="history-heading">
      <div><div className="section-kicker">Merchants</div><h1 id="merchants-title">Merchants</h1>
        <p>Manage physical pickup locations used by observed delivery records.</p></div>
      <button type="button" className="button primary add-delivery" data-merchant-primary onClick={() => setEditor(null)}>
        <span aria-hidden="true">＋</span> Add Merchant
      </button>
    </div>
    <div className="merchant-filters" aria-label="Merchant filters">
      <div className="filter-field">
        <label htmlFor="merchant-management-search">Search merchant</label>
        <input id="merchant-management-search" type="search" placeholder="Search name, address, or city…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="filter-field">
        <label htmlFor="merchant-management-category">Category</label>
        <select id="merchant-management-category" value={category} onChange={(event) => setCategory(event.target.value as Category | "")}>
          {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </div>
    {error && <p className="history-alert" role="alert">{error}</p>}
    <div className="history-table-card">
      <div className="table-scroll"><table className="history-table merchant-table">
        <thead><tr><th scope="col">Merchant</th><th scope="col">Category</th><th scope="col">Public Address</th><th scope="col">City</th><th scope="col">Observed Deliveries</th><th scope="col">Actions</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={6} className="table-message">Loading merchants…</td></tr>
          : filtered.length === 0 ? <tr><td colSpan={6} className="table-message">{error ? "No records to display." : "No merchants match the current filters."}</td></tr>
            : filtered.map((merchant) => <tr key={merchant.id}>
              <td><span className="merchant-name">{merchant.name}</span></td>
              <td><span className={`category-label category-${merchant.category}`}>{categories.find((item) => item.value === merchant.category)?.label}</span></td>
              <td>{merchant.publicAddress ?? <span className="merchant-address-missing">Address not recorded</span>}</td>
              <td>{merchant.city}</td>
              <td className="number-cell">{merchant.deliveryCount}</td>
              <td><div className="row-actions">
                <button type="button" className="icon-action" aria-label={`Edit ${merchant.name} at ${merchant.publicAddress ?? merchant.city}`} title="Edit merchant" onClick={() => setEditor(merchant)}>✎</button>
                <button type="button" className="icon-action destructive" aria-label={`Delete ${merchant.name} at ${merchant.publicAddress ?? merchant.city}`} title="Delete merchant" onClick={() => setDeleteTarget(merchant)}>⌫</button>
              </div></td>
            </tr>)}</tbody>
      </table></div>
      <div className="table-footer"><span>Showing {filtered.length} of {records.length} physical merchants</span></div>
    </div>
    {editor !== undefined && <MerchantModal key={editor?.id ?? "new"} merchant={editor} onClose={() => setEditor(undefined)} onSaved={refresh} />}
    {deleteTarget && <ConfirmMerchantDelete merchant={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={refresh} />}
  </section>;
}
