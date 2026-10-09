import { useId, useRef, useState, type FormEvent } from "react";
import { DialogFrame } from "./DialogFrame";
import { saveAnnualMileage, sessionError, type AnnualMileage } from "./sessionApi";

export function AnnualMileageModal({ record, onClose, onSaved }: { record: AnnualMileage | null; onClose: () => void; onSaved: () => void }) {
  const id = useId(); const [year, setYear] = useState(record ? String(record.taxYear) : "");
  const [total, setTotal] = useState(record ? String(record.totalVehicleMiles) : "");
  const [uber, setUber] = useState(record ? String(record.uberEatsBusinessMiles) : "");
  const [realtor, setRealtor] = useState(record?.realtorBusinessMiles === undefined ? "" : String(record.realtorBusinessMiles));
  const [other, setOther] = useState(record?.otherBusinessMiles === undefined ? "" : String(record.otherBusinessMiles));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const pending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return; setError("");
    const values = [total, uber, realtor, other].map((value) => value.trim() ? Number(value) : null);
    const taxYear = Number(year);
    if (!Number.isInteger(taxYear) || taxYear < 2000 || taxYear > 2100 || values[0] === null || values[1] === null || values.some((value) => value !== null && (!Number.isFinite(value) || value < 0)) || values.slice(1).reduce<number>((sum, value) => sum + (value ?? 0), 0) > values[0]) {
      setError("Enter a year from 2000 to 2100 and nonnegative miles. Known business miles cannot exceed total vehicle miles."); return;
    }
    pending.current = true; setBusy(true);
    try {
      await saveAnnualMileage(taxYear, { totalVehicleMiles: values[0], uberEatsBusinessMiles: values[1], taxMethod: "standard_mileage",
        ...(values[2] === null ? {} : { realtorBusinessMiles: values[2] }), ...(values[3] === null ? {} : { otherBusinessMiles: values[3] }) });
      onSaved();
    } catch (cause) { setError(sessionError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <DialogFrame title={record ? "Edit Annual Mileage" : "Add Annual Mileage"} onClose={onClose} busy={busy}>
    <p className="dialog-intro">Record annual mileage by business purpose. Standard Mileage is a tax method; no tax savings or additional depreciation are calculated.</p>
    <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button>
    <form noValidate onSubmit={submit} aria-busy={busy}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor={`${id}-year`}>Tax Year *</label><input id={`${id}-year`} type="number" min="2000" max="2100" step="1" required data-autofocus disabled={busy || Boolean(record)} value={year} onChange={(event) => setYear(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-total`}>Total Vehicle Miles *</label><input id={`${id}-total`} type="number" min="0" step="any" required disabled={busy} value={total} onChange={(event) => setTotal(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-uber`}>Uber Eats Business Miles *</label><input id={`${id}-uber`} type="number" min="0" step="any" required disabled={busy} value={uber} onChange={(event) => setUber(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-realtor`}>Realtor Business Miles</label><input id={`${id}-realtor`} type="number" min="0" step="any" disabled={busy} value={realtor} onChange={(event) => setRealtor(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-other`}>Other Business Miles</label><input id={`${id}-other`} type="number" min="0" step="any" disabled={busy} value={other} onChange={(event) => setOther(event.target.value)} /></div>
      </div>
      <p className="duration-help">For 2024–2025, all confirmed reported business miles are Uber Eats, with Realtor and other miles explicitly zero. For other years, blank categories stay unknown; enter zero only when confirmed.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : "Save Annual Mileage"}</button></div>
    </form>
  </DialogFrame>;
}
