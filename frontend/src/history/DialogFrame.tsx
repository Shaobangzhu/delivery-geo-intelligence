import { Dialog } from "@shaobangzhu/clu-ui";
import { useCallback, useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

interface DialogFrameProps {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
  className?: string;
}
const focusSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";

/** DGI owns its established focus targets and mouse-down dismissal policy. */
export function DialogFrame({ title, onClose, busy, children, className = "" }: DialogFrameProps) {
  const initialFocusRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const attach = useCallback((dialog: HTMLDialogElement | null) => {
    initialFocusRef.current = dialog?.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)")
      ?? dialog?.querySelector<HTMLElement>(focusSelector) ?? null;
  }, []);
  useEffect(() => {
    const previousFocus = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
      // Choose a surviving primary trigger after row removal has committed.
      queueMicrotask(() => {
        const restoreFallback = () => {
          if (!document.querySelector("dialog[open]")) document.querySelector<HTMLElement>("[data-history-primary], [data-merchant-primary]")?.focus({ preventScroll: true });
        };
        if (!previousFocus?.isConnected) { restoreFallback(); return; }
        // A successful delete can refresh the row after modal cleanup. Observe
        // that removal until the user intentionally focuses another control.
        if (!previousFocus.closest("tr")) return;
        const stop = () => { observer.disconnect(); document.removeEventListener("focusin", onFocus); };
        const onFocus = (event: FocusEvent) => { if (event.target !== previousFocus && event.target !== document.body) stop(); };
        const observer = new MutationObserver(() => {
          if (!previousFocus.isConnected) { stop(); restoreFallback(); }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        document.addEventListener("focusin", onFocus);
      });
    };
  }, []);
  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const stops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(focusSelector));
    const first = stops[0], last = stops[stops.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && (document.activeElement === first || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !event.currentTarget.contains(document.activeElement))) {
      event.preventDefault(); first.focus();
    }
  }
  return <Dialog ref={attach} open title={title} busy={busy}
    initialFocusRef={initialFocusRef} returnFocusRef={returnFocusRef}
    onOpenChange={() => onClose()} closeOnBackdrop={false}
    className={`dialog-card ${className}`} onKeyDown={onKeyDown}
    onMouseDown={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget &&
        (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) {
        // Prevent the backdrop's native mouse-down default from stealing the
        // focus that Dialog restores to the trigger during unmount.
        event.preventDefault();
        if (!busy) onClose();
      }
    }}>{children}</Dialog>;
}
