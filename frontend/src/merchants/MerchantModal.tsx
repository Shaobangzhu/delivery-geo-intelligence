import { useId, useRef, useState, type FormEvent } from "react";
import { DialogFrame } from "../history/DialogFrame";
import { createMerchant, merchantError, updateMerchant, type MerchantRecord } from "./api";
import type { Category } from "../history/api";

interface Props {
  merchant: MerchantRecord | null;
  onClose: () => void;
  onSaved: () => void;
}

export function MerchantModal({ merchant, onClose, onSaved }: Props) {
  const id = useId();
  const [name, setName] = useState(merchant?.name ?? "");
  const [category, setCategory] = useState<Category | "">(merchant?.category ?? "");
  const [publicAddress, setPublicAddress] = useState(merchant?.publicAddress ?? "");
  const [city, setCity] = useState(merchant?.city ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const addressChanged = publicAddress.trim() !== (merchant?.publicAddress ?? "");
  const historyWarning = Boolean(merchant && addressChanged && merchant.deliveryCount > 0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setError("");
    const trimmedName = name.trim();
    const trimmedAddress = publicAddress.trim();
    const trimmedCity = city.trim();
    if (!trimmedName || !category || !trimmedCity || (!merchant && !trimmedAddress) || (addressChanged && !trimmedAddress)) {
      setError("Complete the required fields before saving.");
      return;
    }
    const base = { name: trimmedName, category, city: trimmedCity };
    savingRef.current = true;
    setSaving(true);
    try {
      if (merchant) {
        await updateMerchant(merchant.id, { ...base, ...(addressChanged ? { publicAddress: trimmedAddress } : {}) });
      } else {
        await createMerchant({ ...base, publicAddress: trimmedAddress });
      }
      onSaved();
    } catch (cause) {
      setError(merchantError(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return <DialogFrame title={merchant ? "Edit Merchant" : "Add Merchant"} onClose={onClose} busy={saving} className="merchant-dialog">
    <p className="dialog-intro">Each Merchant represents one physical pickup location.</p>
    <button type="button" className="dialog-close" aria-label="Close dialog" onClick={onClose} disabled={saving}>×</button>
    <form onSubmit={submit} aria-busy={saving} noValidate>
      <div className="form-grid">
        <div className="form-field form-wide">
          <label htmlFor={`${id}-name`}>Merchant Name <span aria-hidden="true">*</span></label>
          <input id={`${id}-name`} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={saving} data-autofocus />
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-category`}>Category <span aria-hidden="true">*</span></label>
          <select id={`${id}-category`} value={category} onChange={(event) => setCategory(event.target.value as Category | "")} required disabled={saving}>
            <option value="">Select category</option>
            <option value="restaurant">Restaurant</option><option value="grocery">Grocery</option>
            <option value="retail">Retail</option><option value="other">Other</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-city`}>City <span aria-hidden="true">*</span></label>
          <input id={`${id}-city`} value={city} onChange={(event) => setCity(event.target.value)} maxLength={120} required disabled={saving} />
        </div>
        <div className="form-field form-wide">
          <label htmlFor={`${id}-address`}>Public Business Address {!merchant && <span aria-hidden="true">*</span>}</label>
          <input id={`${id}-address`} value={publicAddress} onChange={(event) => setPublicAddress(event.target.value)} maxLength={500} required={!merchant} disabled={saving} />
          {merchant && !merchant.publicAddress && <p className="merchant-legacy-note">This earlier record has no saved public address. Its existing pickup point is retained until you enter a verified business address.</p>}
        </div>
      </div>
      {historyWarning && <p className="merchant-location-warning" role="note">Changing this address updates the pickup location associated with existing delivery history. If a store moved to a new physical location, create a new Merchant instead.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
        <button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : merchant ? "Save Changes" : "Save Merchant"}</button>
      </div>
    </form>
  </DialogFrame>;
}
