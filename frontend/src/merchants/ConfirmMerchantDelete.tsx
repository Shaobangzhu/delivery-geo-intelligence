import { useRef, useState } from "react";
import { DialogFrame } from "../history/DialogFrame";
import { ApiError } from "../history/api";
import { deleteMerchant, merchantError, type MerchantRecord } from "./api";

interface Props {
  merchant: MerchantRecord;
  onClose: () => void;
  onDeleted: () => void;
}

export function ConfirmMerchantDelete({ merchant, onClose, onDeleted }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState(merchant.deliveryCount > 0);
  const [error, setError] = useState("");
  const deletingRef = useRef(false);

  async function confirm() {
    if (deletingRef.current || blocked) return;
    deletingRef.current = true;
    setDeleting(true);
    setError("");
    try {
      await deleteMerchant(merchant.id);
      onDeleted();
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) setBlocked(true);
      setError(merchantError(cause));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return <DialogFrame title="Delete merchant?" onClose={onClose} busy={deleting} className="confirm-dialog">
    <p className="dialog-intro">{merchant.name}{merchant.publicAddress ? ` · ${merchant.publicAddress}` : ` · ${merchant.city}`}</p>
    {blocked ? <p className="merchant-location-warning">This physical Merchant has delivery history and cannot be deleted. Existing deliveries will remain linked to it.</p>
      : <p className="merchant-delete-copy">This unused Merchant will be permanently removed. This action cannot be undone.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="dialog-actions">
      <button type="button" className="button secondary" onClick={onClose} disabled={deleting} data-autofocus>{blocked ? "Close" : "Cancel"}</button>
      {!blocked && <button type="button" className="button danger" onClick={confirm} disabled={deleting}>{deleting ? "Deleting…" : "Delete Merchant"}</button>}
    </div>
  </DialogFrame>;
}
