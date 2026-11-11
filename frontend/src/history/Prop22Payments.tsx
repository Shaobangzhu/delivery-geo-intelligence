import { Button, Select, Table } from "@shaobangzhu/clu-ui";
import { Pagination } from "../components/Pagination";
import { PAGE_SIZE, pageRange } from "../components/pageRange";
import { PlatformOptions, platformLabel, type PlatformFilter } from "./platform";
import { useEffect, useRef, useState } from "react";
import { DialogFrame } from "./DialogFrame";
import { PaymentModal } from "./PaymentModal";
import { listPayments, deletePayment, paymentError, type EarningsAdjustment } from "./earningsApi";

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
export function Prop22Payments({ adding, onCloseAdd }: { adding: boolean; onCloseAdd: () => void }) {
  const [platform, setPlatform] = useState<PlatformFilter>("");
  const [rows, setRows] = useState<EarningsAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [page, setPage] = useState(1);
  const range = pageRange(page, rows.length);
  const [editing, setEditing] = useState<EarningsAdjustment | null>(null);
  const [target, setTarget] = useState<EarningsAdjustment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    listPayments(controller.signal, platform).then((data) => { if (active) { setRows(data); setPage((page) => pageRange(page, data.length).page); setLoading(false); } })
      .catch(() => { if (active) { setError(paymentError()); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [reload, platform]);
  function saved() { if (!editing) setPage(1); setEditing(null); onCloseAdd(); setReload((value) => value + 1); }
  async function confirmDelete() {
    if (!target || pending.current) return;
    pending.current = true; setDeleting(true); setDeleteError("");
    try { await deletePayment(target.id); setTarget(null); setReload((value) => value + 1); }
    catch { setDeleteError("Could not delete the payment. Try again."); }
    finally { pending.current = false; setDeleting(false); }
  }
  return <section className="prop22-section" aria-labelledby="prop22-title">
    <h2 id="prop22-title">Prop 22 Payments</h2>
    <div className="filter-field payment-platform-filter"><label htmlFor="payment-platform-filter">Payment Platform</label><Select id="payment-platform-filter" value={platform} onChange={(event) => { setPlatform(event.target.value as PlatformFilter); setPage(1); }}><PlatformOptions filter /></Select></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="history-table-card"><Table.ScrollArea label="Prop 22 payments" className="table-scroll"><Table density="compact" className="history-table payment-table">
      <Table.Header><Table.Row><Table.HeadCell scope="col">Payment Date</Table.HeadCell><Table.HeadCell scope="col">Platform</Table.HeadCell><Table.HeadCell scope="col">Coverage Period</Table.HeadCell><Table.HeadCell scope="col">Amount</Table.HeadCell><Table.HeadCell scope="col">Actions</Table.HeadCell></Table.Row></Table.Header>
      <Table.Body>{loading ? <Table.MessageRow colSpan={5} className="dgi-table-message">Loading payments…</Table.MessageRow> : error ? <Table.MessageRow colSpan={5} className="dgi-table-message">Payments unavailable.</Table.MessageRow> : !rows.length ? <Table.MessageRow colSpan={5} className="dgi-table-message">No Prop 22 payments recorded.</Table.MessageRow> : rows.slice(range.offset, range.offset + PAGE_SIZE).map((row) => <Table.Row key={row.id}>
        <Table.Cell>{displayDate(row.paymentDate)}</Table.Cell><Table.Cell><span className="platform-label">{platformLabel(row.platform)}</span></Table.Cell><Table.Cell>{row.coverageStartDate && row.coverageEndDate ? `${displayDate(row.coverageStartDate)} – ${displayDate(row.coverageEndDate)}` : "—"}</Table.Cell><Table.Cell>${row.amount.toFixed(2)}</Table.Cell>
        <Table.Cell><div className="row-actions"><Button type="button" variant="secondary" size="small" className="dgi-row-action" aria-label={`Edit Prop 22 payment ${row.paymentDate}`} onClick={() => setEditing(row)}>✎</Button><Button type="button" variant="danger" size="small" className="dgi-row-action" aria-label={`Delete Prop 22 payment ${row.paymentDate}`} onClick={() => { setDeleteError(""); setTarget(row); }}>⌫</Button></div></Table.Cell>
      </Table.Row>)}</Table.Body>
    </Table></Table.ScrollArea>
    {!loading && !error && <Pagination page={page} total={rows.length} noun="payments" label="Prop 22 payment pages" onPageChange={setPage} />}
    </div>
    {(adding || editing) && <PaymentModal key={editing?.id ?? "new"} payment={editing} onClose={() => { setEditing(null); onCloseAdd(); }} onSaved={saved} />}
    {target && <DialogFrame title="Delete Prop 22 payment?" onClose={() => setTarget(null)} busy={deleting} className="confirm-dialog">
      <p className="dialog-intro">This payment will be permanently removed. This action cannot be undone.</p>
      {deleteError && <p role="alert" className="form-error">{deleteError}</p>}
      <div className="dialog-actions"><Button variant="secondary" size="small" type="button" disabled={deleting} data-autofocus onClick={() => setTarget(null)}>Cancel</Button><Button variant="danger" size="small" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Delete Payment"}</Button></div>
    </DialogFrame>}
  </section>;
}
