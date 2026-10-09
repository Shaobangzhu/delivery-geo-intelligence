import { useId, useRef, useState, type FormEvent } from "react";
import { DialogFrame } from "./DialogFrame";
import { saveVehicleProfile, sessionError, type VehicleProfile } from "./sessionApi";

export function VehicleModal({ profile, onClose, onSaved }: { profile: VehicleProfile; onClose: () => void; onSaved: () => void }) {
  const id = useId();
  const [energy, setEnergy] = useState(String(profile.energyCashCostPerMile));
  const [tires, setTires] = useState(String(profile.tireReplacementSetCost));
  const [life, setLife] = useState(profile.expectedTireSetLifeMiles === undefined ? "" : String(profile.expectedTireSetLifeMiles));
  const [depreciation, setDepreciation] = useState(profile.marginalDepreciationCostPerMile === undefined ? "" : String(profile.marginalDepreciationCostPerMile));
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const pending = useRef(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current) return; setError("");
    const values = [energy, tires, life, depreciation].map((value) => value.trim() ? Number(value) : null);
    if (values[0] === null || values[1] === null || values.some((value) => value !== null && (!Number.isFinite(value) || value < 0)) || (values[2] !== null && (values[2] <= 0 || !Number.isFinite(values[1]! / values[2])))) {
      setError("Enter nonnegative costs and, if configured, a positive tire lifespan producing a finite rate."); return;
    }
    pending.current = true; setBusy(true);
    try {
      await saveVehicleProfile({ energyCashCostPerMile: values[0], tireReplacementSetCost: values[1], expectedTireSetLifeMiles: values[2], marginalDepreciationCostPerMile: values[3] });
      onSaved();
    } catch (cause) { setError(sessionError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <DialogFrame title="Tesla Model Y — Vehicle Economics" onClose={onClose} busy={busy}>
    <p className="dialog-intro">Personal assumptions for the 2022 Long Range. Historical tire purchase cost does not establish its lifespan. Leave unknown estimates blank.</p>
    <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button>
    <form noValidate onSubmit={submit} aria-busy={busy}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor={`${id}-energy`}>Energy Cash Cost ($/mi)</label><input id={`${id}-energy`} type="number" min="0" step="any" required data-autofocus disabled={busy} value={energy} onChange={(event) => setEnergy(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-tires`}>Tire Replacement Set ($)</label><input id={`${id}-tires`} type="number" min="0" step="any" required disabled={busy} value={tires} onChange={(event) => setTires(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-life`}>Expected Tire Set Life (mi)</label><input id={`${id}-life`} type="number" min="0" step="any" disabled={busy} value={life} onChange={(event) => setLife(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-depreciation`}>Marginal Mileage Depreciation ($/mi)</label><input id={`${id}-depreciation`} type="number" min="0" step="any" disabled={busy} value={depreciation} onChange={(event) => setDepreciation(event.target.value)} /></div>
      </div>
      <p className="duration-help">Initial energy cash cost is explicitly $0.00/mi under your home-charging assumption. Paid repairs, rotations, and alignment are historically zero; washing and cabin filters are excluded. Future costs can differ.</p>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={busy}>{busy ? "Saving…" : "Save Vehicle Settings"}</button></div>
    </form>
  </DialogFrame>;
}
