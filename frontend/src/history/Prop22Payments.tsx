import { useEffect, useRef, useState } from "react";
import { DialogFrame } from "./DialogFrame";
import { PaymentModal } from "./PaymentModal";
import { listPayments, deletePayment, paymentError, type EarningsAdjustment } from "./earningsApi";

function displayDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
export function Prop22Payments({ adding, onCloseAdd }: { adding: boolean; onCloseAdd: () => void }) {
  const [rows, setRows] = useState<EarningsAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<EarningsAdjustment | null>(null);
  const [target, setTarget] = useState<EarningsAdjustment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const pending = useRef(false);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError("");
    listPayments(controller.signal).then((data) => { if (active) { setRows(data); setLoading(false); } })
      .catch(() => { if (active) { setError(paymentError()); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [reload]);
  function saved() { setEditing(null); onCloseAdd(); setReload((value) => value + 1); }
  async function confirmDelete() {
    if (!target || pending.current) return;
    pending.current = true; setDeleting(true); setDeleteError("");
    try { await deletePayment(target.id); setTarget(null); setReload((value) => value + 1); }
    catch { setDeleteError("Could not delete the payment. Try again."); }
    finally { pending.current = false; setDeleting(false); }
  }
  return <section className="prop22-section" aria-labelledby="prop22-title">
    <h2 id="prop22-title">Prop 22 Payments</h2>
    {error && <p role="alert" className="form-error">{error}</p>}
    <div className="history-table-card table-scroll"><table className="history-table payment-table">
      <thead><tr><th scope="col">Payment Date</th><th scope="col">Coverage Period</th><th scope="col">Amount</th><th scope="col">Actions</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan={4}>Loading payments…</td></tr> : error ? <tr><td colSpan={4}>Payments unavailable.</td></tr> : !rows.length ? <tr><td colSpan={4}>No Prop 22 payments recorded.</td></tr> : rows.map((row) => <tr key={row.id}>
        <td>{displayDate(row.paymentDate)}</td><td>{row.coverageStartDate && row.coverageEndDate ? `${displayDate(row.coverageStartDate)} – ${displayDate(row.coverageEndDate)}` : "—"}</td><td>${row.amount.toFixed(2)}</td>
        <td><div className="row-actions"><button type="button" className="icon-action" aria-label={`Edit Prop 22 payment ${row.paymentDate}`} onClick={() => setEditing(row)}>✎</button><button type="button" className="icon-action delete-action" aria-label={`Delete Prop 22 payment ${row.paymentDate}`} onClick={() => { setDeleteError(""); setTarget(row); }}>⌫</button></div></td>
      </tr>)}</tbody>
    </table></div>
    {(adding || editing) && <PaymentModal key={editing?.id ?? "new"} payment={editing} onClose={() => { setEditing(null); onCloseAdd(); }} onSaved={saved} />}
    {target && <DialogFrame title="Delete Prop 22 payment?" onClose={() => setTarget(null)} busy={deleting} className="confirm-dialog">
      <p className="dialog-intro">This payment will be permanently removed. This action cannot be undone.</p>
      {deleteError && <p role="alert" className="form-error">{deleteError}</p>}
      <div className="dialog-actions"><button className="button secondary" type="button" disabled={deleting} data-autofocus onClick={() => setTarget(null)}>Cancel</button><button className="button danger" type="button" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Delete Payment"}</button></div>
    </DialogFrame>}
  </section>;
}
