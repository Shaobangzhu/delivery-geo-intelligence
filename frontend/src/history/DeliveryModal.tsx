import { useId, useRef, useState, type FormEvent } from "react";
import { createDelivery, updateDelivery, userFacingError, type Delivery, type DeliveryPayload, type Merchant } from "./api";
import { DialogFrame } from "./DialogFrame";

interface DeliveryModalProps {
  delivery: Delivery | null;
  merchants: Merchant[];
  onClose: () => void;
  onSaved: () => void;
}

function localDateTime(iso: string): string {
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function DeliveryModal({ delivery, merchants, onClose, onSaved }: DeliveryModalProps) {
  const id = useId();
  const [merchantId, setMerchantId] = useState(delivery?.merchantId ?? "");
  const [pickedUpAt, setPickedUpAt] = useState(delivery ? localDateTime(delivery.pickedUpAt) : "");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [replaceDestination, setReplaceDestination] = useState(false);
  const [payout, setPayout] = useState(delivery?.payout === undefined ? "" : String(delivery.payout));
  const [distance, setDistance] = useState(delivery?.distanceMiles === undefined ? "" : String(delivery.distanceMiles));
  const duration = delivery?.deliveryDurationSeconds;
  const [hours, setHours] = useState(duration === undefined ? "" : String(Math.floor(duration / 3600)));
  const [minutes, setMinutes] = useState(duration === undefined ? "" : String(Math.floor(duration % 3600 / 60)));
  const [seconds, setSeconds] = useState(duration === undefined ? "" : String(duration % 60));
  const [notes, setNotes] = useState(delivery?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);
  const needsAddress = delivery === null || replaceDestination;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingRef.current) return;
    setError("");
    if (!merchantId || !pickedUpAt || (needsAddress && !destinationAddress.trim())) {
      setError("Complete the required fields before saving.");
      return;
    }
    const pickupDate = new Date(pickedUpAt);
    const payoutValue = payout.trim() === "" ? null : Number(payout);
    const distanceValue = distance.trim() === "" ? null : Number(distance);
    if (Number.isNaN(pickupDate.getTime()) ||
        (payoutValue !== null && (!Number.isFinite(payoutValue) || payoutValue < 0)) ||
        (distanceValue !== null && (!Number.isFinite(distanceValue) || distanceValue < 0))) {
      setError("Enter a valid pickup time, payout, and distance.");
      return;
    }

    const parts = [hours, minutes, seconds];
    const durationEmpty = parts.every((part) => part.trim() === "");
    const values = parts.map((part) => part.trim() === "" ? 0 : Number(part));
    const totalSeconds = values[0] * 3600 + values[1] * 60 + values[2];
    if (!durationEmpty && (parts.some((part) => part !== "" && !/^\d+$/.test(part)) ||
        values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
        values[1] > 59 || values[2] > 59 || !Number.isSafeInteger(totalSeconds) || totalSeconds <= 0)) {
      setError("Enter a positive duration with whole hours, and minutes and seconds from 0 to 59.");
      return;
    }

    const payload: DeliveryPayload = {
      merchantId,
      ...(!durationEmpty ? { deliveryDurationSeconds: totalSeconds }
        : duration !== undefined ? { deliveryDurationSeconds: null } : {}),
      pickedUpAt: pickupDate.toISOString(),
      ...(delivery ? { payout: payoutValue, distanceMiles: distanceValue, notes: notes.trim() || null } : {
        ...(payoutValue === null ? {} : { payout: payoutValue }),
        ...(distanceValue === null ? {} : { distanceMiles: distanceValue }),
        ...(notes.trim() ? { notes: notes.trim() } : {})
      }),
      ...(needsAddress ? { destinationAddress: destinationAddress.trim() } : {})
    };

    savingRef.current = true;
    setSaving(true);
    try {
      if (delivery) await updateDelivery(delivery.id, payload);
      else await createDelivery(payload);
      setDestinationAddress("");
      onSaved();
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <DialogFrame title={delivery ? "Edit Delivery" : "Add Delivery"} onClose={onClose} busy={saving} className="delivery-dialog">
      <p className="dialog-intro">{delivery ? "Update this observed delivery record." : "Add an observed delivery record."}</p>
      <button type="button" className="dialog-close" aria-label="Close dialog" onClick={onClose} disabled={saving}>×</button>
      <form onSubmit={submit} aria-busy={saving} noValidate>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor={`${id}-merchant`}>Merchant <span aria-hidden="true">*</span></label>
            <select id={`${id}-merchant`} value={merchantId} onChange={(event) => setMerchantId(event.target.value)} required data-autofocus disabled={saving}>
              <option value="">{merchants.length ? "Select merchant" : "No merchants available"}</option>
              {merchants.map((merchant) => (
                <option key={merchant.id} value={merchant.id}>{merchant.name} · {merchant.publicAddress ?? merchant.city} · {merchant.id.slice(-6)}</option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-pickup`}>Pickup Date &amp; Time <span aria-hidden="true">*</span></label>
            <input id={`${id}-pickup`} type="datetime-local" value={pickedUpAt} onChange={(event) => setPickedUpAt(event.target.value)} required disabled={saving} />
          </div>
          <div className="form-field form-wide">
            {delivery && (
              <div className="stored-location">
                <span className={delivery.hasDestinationLocation ? "location-ready" : "location-missing"}>
                  {delivery.hasDestinationLocation ? "Location stored" : "No location stored"}
                </span>
                <button type="button" className="text-button" onClick={() => {
                  setReplaceDestination((current) => !current);
                  setDestinationAddress("");
                }} disabled={saving}>
                  {replaceDestination ? "Cancel replacement" : "Replace Destination"}
                </button>
              </div>
            )}
            {needsAddress && (
              <>
                <label htmlFor={`${id}-address`}>{delivery ? "New Destination Address" : "Destination Address"} <span aria-hidden="true">*</span></label>
                <input id={`${id}-address`} type="text" autoComplete="off" value={destinationAddress} onChange={(event) => setDestinationAddress(event.target.value)} required maxLength={500} disabled={saving} />
              </>
            )}
            <p className="privacy-note">Destination address is used for geocoding and is not stored.</p>
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-payout`}>Payout</label>
            <div className="input-prefix"><span aria-hidden="true">$</span><input id={`${id}-payout`} type="number" min="0" step="0.01" inputMode="decimal" value={payout} onChange={(event) => setPayout(event.target.value)} disabled={saving} /></div>
          </div>
          <div className="form-field">
            <label htmlFor={`${id}-distance`}>Distance (mi)</label>
            <input id={`${id}-distance`} type="number" min="0" step="0.01" inputMode="decimal" value={distance} onChange={(event) => setDistance(event.target.value)} disabled={saving} />
          </div>
          <fieldset className="duration-group form-wide" disabled={saving}>
            <legend>Delivery Duration <span>(optional)</span></legend>
            <div className="duration-inputs">
              <div className="form-field"><label htmlFor={`${id}-hours`}>Hours</label>
                <input id={`${id}-hours`} type="number" min="0" step="1" inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} /></div>
              <div className="form-field"><label htmlFor={`${id}-minutes`}>Minutes</label>
                <input id={`${id}-minutes`} type="number" min="0" max="59" step="1" inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></div>
              <div className="form-field"><label htmlFor={`${id}-seconds`}>Seconds</label>
                <input id={`${id}-seconds`} type="number" min="0" max="59" step="1" inputMode="numeric" value={seconds} onChange={(event) => setSeconds(event.target.value)} /></div>
            </div>
            <p className="duration-help">Observed elapsed time from your delivery record. Leave all fields blank for unknown duration.</p>
          </fieldset>
          <div className="form-field form-wide">
            <label htmlFor={`${id}-notes`}>Optional Notes</label>
            <textarea id={`${id}-notes`} rows={3} maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={saving} />
          </div>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving || merchants.length === 0}>
            {saving ? "Saving…" : delivery ? "Save Changes" : "Save Delivery"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}
