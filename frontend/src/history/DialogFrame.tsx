import { useEffect, useId, useRef, type ReactNode } from "react";

interface DialogFrameProps {
  title: string;
  onClose: () => void;
  busy: boolean;
  children: ReactNode;
  className?: string;
}

const focusSelector = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])";

export function DialogFrame({ title, onClose, busy, children, className = "" }: DialogFrameProps) {
  const titleId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const card = cardRef.current;
    const preferred = card?.querySelector<HTMLElement>("[data-autofocus]");
    (preferred ?? card?.querySelector<HTMLElement>(focusSelector) ?? card)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          closeRef.current();
        }
        return;
      }
      if (event.key !== "Tab" || !card) return;
      const focusable = Array.from(card.querySelectorAll<HTMLElement>(focusSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        card.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !card.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !card.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
      else document.querySelector<HTMLElement>("[data-history-primary]")?.focus();
    };
  }, []);

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div ref={cardRef} className={`dialog-card ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
