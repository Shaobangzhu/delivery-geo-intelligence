import { useId, useRef, useState, type FormEvent } from "react";
import { DialogFrame } from "./DialogFrame";
import { savePayment, paymentError, type EarningsAdjustment } from "./earningsApi";

export function PaymentModal({ payment, onClose, onSaved }: {
  payment: EarningsAdjustment | null; onClose: () => void; onSaved: () => void;
}) {
  const id = useId();
  const [date, setDate] = useState(payment?.paymentDate ?? "");
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [start, setStart] = useState(payment?.coverageStartDate ?? "");
  const [end, setEnd] = useState(payment?.coverageEndDate ?? "");
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    const value = Number(amount);
    if (!date || !amount.trim() || !Number.isFinite(value) || value <= 0 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
      setError("Enter a payment date and a positive amount with up to two decimal places."); return;
    }
    if (Boolean(start) !== Boolean(end) || (start && start > end)) {
      setError("Supply both coverage dates with start on or before end."); return;
    }
    pending.current = true; setBusy(true);
    try {
      await savePayment({ type: "prop22_guarantee", paymentDate: date, amount: value,
        ...(start ? { coverageStartDate: start, coverageEndDate: end } : payment ? { coverageStartDate: null, coverageEndDate: null } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : payment ? { notes: null } : {})
      }, payment?.id);
      onSaved();
    } catch { setError(paymentError()); }
    finally { pending.current = false; setBusy(false); }
  }
  return <DialogFrame title={payment ? "Edit Prop 22 Payment" : "Add Prop 22 Payment"} onClose={onClose} busy={busy} className="delivery-dialog">
    <p className="dialog-intro">Record the adjustment received. Coverage dates are optional and do not allocate earnings.</p>
    <button type="button" className="dialog-close" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button>
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor={`${id}-date`}>Payment Date *</label><input id={`${id}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} data-autofocus /></div>
        <div className="form-field"><label htmlFor={`${id}-amount`}>Amount *</label><input id={`${id}-amount`} type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></div>
        <div className="form-field"><label htmlFor={`${id}-start`}>Coverage Start Date</label><input id={`${id}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} /></div>
        <div className="form-field"><label htmlFor={`${id}-end`}>Coverage End Date</label><input id={`${id}-end`} type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} /></div>
        <div className="form-field form-wide"><label htmlFor={`${id}-notes`}>Optional Notes</label><textarea id={`${id}-notes`} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} /></div>
      </div>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Payment"}</button></div>
    </form>
  </DialogFrame>;
}
