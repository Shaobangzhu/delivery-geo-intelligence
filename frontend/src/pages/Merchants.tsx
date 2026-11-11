import { Button, Input, Select, Table } from "@shaobangzhu/clu-ui";
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

  return <section className="merchants-page" data-clu-theme="light" aria-labelledby="merchants-title">
    <div className="history-heading">
      <div><div className="section-kicker">Merchants</div><h1 id="merchants-title">Merchants</h1>
        <p>Manage physical pickup locations used by observed delivery records.</p></div>
      <Button type="button" variant="primary" size="small" className="add-delivery" data-merchant-primary onClick={() => setEditor(null)}>
        <span aria-hidden="true">＋</span> Add Merchant
      </Button>
    </div>
    <div className="merchant-filters" aria-label="Merchant filters">
      <div className="filter-field">
        <label htmlFor="merchant-management-search">Search merchant</label>
        <Input id="merchant-management-search" type="search" placeholder="Search name, address, or city…" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
      <div className="filter-field">
        <label htmlFor="merchant-management-category">Category</label>
        <Select id="merchant-management-category" value={category} onChange={(event) => setCategory(event.target.value as Category | "")}>
          {categories.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </Select>
      </div>
    </div>
    {error && <p className="history-alert" role="alert">{error}</p>}
    <div className="history-table-card">
      <Table.ScrollArea label="Physical merchants" className="table-scroll"><Table density="compact" className="history-table merchant-table">
        <Table.Header><Table.Row><Table.HeadCell scope="col">Merchant</Table.HeadCell><Table.HeadCell scope="col">Category</Table.HeadCell><Table.HeadCell scope="col">Public Address</Table.HeadCell><Table.HeadCell scope="col">City</Table.HeadCell><Table.HeadCell scope="col">Observed Deliveries</Table.HeadCell><Table.HeadCell scope="col">Actions</Table.HeadCell></Table.Row></Table.Header>
        <Table.Body>{loading ? <Table.MessageRow colSpan={6} className="dgi-table-message">Loading merchants…</Table.MessageRow>
          : filtered.length === 0 ? <Table.MessageRow colSpan={6} className="dgi-table-message">{error ? "No records to display." : "No merchants match the current filters."}</Table.MessageRow>
            : filtered.map((merchant) => <Table.Row key={merchant.id}>
              <Table.Cell><span className="merchant-name">{merchant.name}</span></Table.Cell>
              <Table.Cell><span className={`category-label category-${merchant.category}`}>{categories.find((item) => item.value === merchant.category)?.label}</span></Table.Cell>
              <Table.Cell>{merchant.publicAddress ?? <span className="merchant-address-missing">Address not recorded</span>}</Table.Cell>
              <Table.Cell>{merchant.city}</Table.Cell>
              <Table.Cell className="number-cell">{merchant.deliveryCount}</Table.Cell>
              <Table.Cell><div className="row-actions">
                <Button type="button" variant="secondary" size="small" className="dgi-row-action" aria-label={`Edit ${merchant.name} at ${merchant.publicAddress ?? merchant.city}`} title="Edit merchant" onClick={() => setEditor(merchant)}>✎</Button>
                <Button type="button" variant="danger" size="small" className="dgi-row-action" aria-label={`Delete ${merchant.name} at ${merchant.publicAddress ?? merchant.city}`} title="Delete merchant" onClick={() => setDeleteTarget(merchant)}>⌫</Button>
              </div></Table.Cell>
            </Table.Row>)}</Table.Body>
      </Table></Table.ScrollArea>
      <div className="table-footer"><span>Showing {filtered.length} of {records.length} physical merchants</span></div>
    </div>
    {editor !== undefined && <MerchantModal key={editor?.id ?? "new"} merchant={editor} onClose={() => setEditor(undefined)} onSaved={refresh} />}
    {deleteTarget && <ConfirmMerchantDelete merchant={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={refresh} />}
  </section>;
}
