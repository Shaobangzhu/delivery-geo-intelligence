import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DialogFrame } from "./DialogFrame";
import { getPayment, savePayment, paymentError, type EarningsAdjustment, type SettlementDetails, type Reconciliation } from "./earningsApi";

export function PaymentModal({ payment, onClose, onSaved }: {
  payment: EarningsAdjustment | null; onClose: () => void; onSaved: () => void;
}) {
  const id = useId();
  const [date, setDate] = useState(payment?.paymentDate ?? "");
  const [amount, setAmount] = useState(payment ? String(payment.amount) : "");
  const [start, setStart] = useState(payment?.coverageStartDate ?? "");
  const [end, setEnd] = useState(payment?.coverageEndDate ?? "");
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [coverageConfirmed, setCoverageConfirmed] = useState(payment?.sessionCoverageConfirmed === true);
  const details = payment?.settlementDetails;
  const [hours, setHours] = useState(details?.engagedSeconds === undefined ? "" : String(Math.floor(details.engagedSeconds / 3600)));
  const [minutes, setMinutes] = useState(details?.engagedSeconds === undefined ? "" : String(Math.floor(details.engagedSeconds % 3600 / 60)));
  const [seconds, setSeconds] = useState(details?.engagedSeconds === undefined ? "" : String(details.engagedSeconds % 60));
  const [miles, setMiles] = useState(details?.engagedMiles === undefined ? "" : String(details.engagedMiles));
  const [eligible, setEligible] = useState(details?.eligibleEarningsExcludingTips === undefined ? "" : String(details.eligibleEarningsExcludingTips));
  const [guarantee, setGuarantee] = useState(details?.reportedGuaranteedAmount === undefined ? "" : String(details.reportedGuaranteedAmount));
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(null);
  const [reconciliationError, setReconciliationError] = useState("");
  const [reconciliationChanged, setReconciliationChanged] = useState(false);
  useEffect(() => {
    if (!payment) return;
    const controller = new AbortController(); let active = true;
    getPayment(payment.id, controller.signal).then((result) => {
      if (active) setReconciliation(result.reconciliation);
    }).catch(() => { if (active) setReconciliationError("Could not load saved reconciliation. Reopen to retry."); });
    return () => { active = false; controller.abort(); };
  }, [payment]);
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
    const components = [hours, minutes, seconds];
    const numeric = components.map((part) => part.trim() ? Number(part) : 0);
    const hasTime = components.some((part) => part.trim());
    const engagedSeconds = numeric[0] * 3600 + numeric[1] * 60 + numeric[2];
    if (hasTime && (numeric.some((part) => !Number.isSafeInteger(part) || part < 0) || numeric[1] > 59 || numeric[2] > 59 || !Number.isSafeInteger(engagedSeconds))) {
      setError("Engaged time requires nonnegative whole hours and minutes/seconds from 0 to 59."); return;
    }
    const optionalValues = [miles, eligible, guarantee];
    if (optionalValues.some((part, index) => part.trim() && (!Number.isFinite(Number(part)) || Number(part) < 0 ||
      (index > 0 && (!Number.isSafeInteger(Math.round(Number(part) * 100)) || Math.abs(Number(part) * 100 - Math.round(Number(part) * 100)) > 1e-7))))) {
      setError("Enter nonnegative settlement values; currency allows up to two decimal places."); return;
    }
    const entered: SettlementDetails = {
      ...(hasTime ? { engagedSeconds } : {}),
      ...(miles.trim() ? { engagedMiles: Number(miles) } : {}),
      ...(eligible.trim() ? { eligibleEarningsExcludingTips: Number(eligible) } : {}),
      ...(guarantee.trim() ? { reportedGuaranteedAmount: Number(guarantee) } : {})
    };
    // Send only changed nested fields on edit, so untouched observations are preserved.
    const settlementPatch: { [K in keyof SettlementDetails]?: number | null } = {};
    for (const key of ["engagedSeconds", "engagedMiles", "eligibleEarningsExcludingTips", "reportedGuaranteedAmount"] as const) {
      if (entered[key] !== details?.[key]) settlementPatch[key] = entered[key] ?? null;
    }
    const settlementPayload = payment
      ? Object.keys(settlementPatch).length ? { settlementDetails: Object.keys(entered).length ? settlementPatch : null } : {}
      : Object.keys(entered).length ? { settlementDetails: entered } : {};
    pending.current = true; setBusy(true);
    try {
      await savePayment({ type: "prop22_guarantee", paymentDate: date, amount: value,
        ...(start ? { coverageStartDate: start, coverageEndDate: end } : payment ? { coverageStartDate: null, coverageEndDate: null } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : payment ? { notes: null } : {}),
        ...settlementPayload,
        ...(coverageConfirmed !== (payment?.sessionCoverageConfirmed === true) ? { sessionCoverageConfirmed: coverageConfirmed } : {})
      }, payment?.id);
      onSaved();
    } catch { setError(paymentError()); }
    finally { pending.current = false; setBusy(false); }
  }
  return <DialogFrame title={payment ? "Edit Prop 22 Payment" : "Add Prop 22 Payment"} onClose={onClose} busy={busy} className="delivery-dialog">
    <p className="dialog-intro">Record the adjustment received. Coverage dates are optional and do not allocate earnings.</p>
    <button type="button" className="dialog-close" aria-label="Close dialog" onClick={onClose} disabled={busy}>×</button>
    <form onSubmit={submit} noValidate aria-busy={busy} onChange={() => setReconciliationChanged(true)}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor={`${id}-date`}>Payment Date *</label><input id={`${id}-date`} type="date" required value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} data-autofocus /></div>
        <div className="form-field"><label htmlFor={`${id}-amount`}>Amount Received *</label><input id={`${id}-amount`} type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} disabled={busy} /></div>
        <div className="form-field"><label htmlFor={`${id}-start`}>Coverage Start Date</label><input id={`${id}-start`} type="date" value={start} onChange={(e) => setStart(e.target.value)} disabled={busy} /></div>
        <div className="form-field"><label htmlFor={`${id}-end`}>Coverage End Date</label><input id={`${id}-end`} type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={busy} /></div>
        <div className="form-field form-wide"><label htmlFor={`${id}-notes`}>Optional Notes</label><textarea id={`${id}-notes`} rows={3} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={busy} /></div>
      </div>
      <div className="form-field coverage-confirmation">
        <label><input type="checkbox" checked={coverageConfirmed} onChange={(e) => setCoverageConfirmed(e.target.checked)} disabled={busy} /> I have recorded all Uber Eats deliveries and sessions for this settlement period.</label>
        <p className="duration-help">This manual confirmation enables full-period efficiency when coverage dates and consistency checks pass. It does not change received income or prove that no activity is missing.</p>
      </div>
      <details className="settlement-details">
        <summary>Settlement Details (Optional)</summary>
        <p className="duration-help">Enter official Uber statement observations, not totals inferred from deliveries. Leave unknown values blank.</p>
        <div className="form-grid">
          <fieldset className="duration-group form-wide" disabled={busy}>
            <legend>Engaged Time</legend>
            <div className="duration-inputs">
              <div className="form-field"><label htmlFor={`${id}-hours`}>Hours</label><input id={`${id}-hours`} type="number" min="0" step="1" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
              <div className="form-field"><label htmlFor={`${id}-minutes`}>Minutes</label><input id={`${id}-minutes`} type="number" min="0" max="59" step="1" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></div>
              <div className="form-field"><label htmlFor={`${id}-seconds`}>Seconds</label><input id={`${id}-seconds`} type="number" min="0" max="59" step="1" value={seconds} onChange={(e) => setSeconds(e.target.value)} /></div>
            </div>
          </fieldset>
          <div className="form-field"><label htmlFor={`${id}-miles`}>Engaged Miles</label><input id={`${id}-miles`} type="number" min="0" step="any" value={miles} onChange={(e) => setMiles(e.target.value)} disabled={busy} /></div>
          <div className="form-field"><label htmlFor={`${id}-eligible`}>Eligible Earnings (Excluding Tips)</label><input id={`${id}-eligible`} type="number" min="0" step="0.01" value={eligible} onChange={(e) => setEligible(e.target.value)} disabled={busy} /></div>
          <div className="form-field form-wide"><label htmlFor={`${id}-guarantee`}>Uber Reported Guaranteed Amount</label><input id={`${id}-guarantee`} type="number" min="0" step="0.01" value={guarantee} onChange={(e) => setGuarantee(e.target.value)} disabled={busy} /></div>
        </div>
        <section className="settlement-reconciliation" aria-label="Saved settlement reconciliation" aria-live="polite">
          {reconciliationChanged ? <p>Save changes, then reopen to view updated reconciliation.</p>
            : reconciliationError ? <p>{reconciliationError}</p>
            : payment && !reconciliation ? <p>Loading saved reconciliation…</p>
            : <>
              <p>Status: <strong>{reconciliation?.status === "matched" ? "Matched" : reconciliation?.status === "mismatch" ? "Needs review" : "Insufficient data"}</strong></p>
              {reconciliation?.expectedAdjustment !== null && reconciliation?.expectedAdjustment !== undefined && <dl>
                <div><dt>Received Adjustment</dt><dd>{money(reconciliation.receivedAdjustment)}</dd></div>
                <div><dt>Expected Adjustment</dt><dd>{money(reconciliation.expectedAdjustment)}</dd></div>
                <div><dt>Difference</dt><dd>{money(reconciliation.difference!)}</dd></div>
              </dl>}
            </>}
          <p className="duration-help">Diagnostic comparison only; offsets or corrections may require statement review. Received income is never replaced.</p>
        </section>
      </details>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" type="submit" disabled={busy}>{busy ? "Saving…" : "Save Payment"}</button></div>
    </form>
  </DialogFrame>;
}

function money(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value); }
