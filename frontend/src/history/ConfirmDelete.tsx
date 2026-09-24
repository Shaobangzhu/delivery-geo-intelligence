import { useRef, useState } from "react";
import { deleteDelivery, userFacingError, type Delivery } from "./api";
import { DialogFrame } from "./DialogFrame";

interface ConfirmDeleteProps {
  delivery: Delivery;
  onClose: () => void;
  onDeleted: () => void;
}

export function ConfirmDelete({ delivery, onClose, onDeleted }: ConfirmDeleteProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const deletingRef = useRef(false);

  async function confirm() {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    setError("");
    try {
      await deleteDelivery(delivery.id);
      onDeleted();
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  return (
    <DialogFrame title="Delete delivery?" onClose={onClose} busy={deleting} className="confirm-dialog">
      <p className="dialog-intro">This delivery record will be permanently removed. This action cannot be undone.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="button secondary" onClick={onClose} disabled={deleting} data-autofocus>Cancel</button>
        <button type="button" className="button danger" onClick={confirm} disabled={deleting}>{deleting ? "Deleting…" : "Delete Delivery"}</button>
      </div>
    </DialogFrame>
  );
}
