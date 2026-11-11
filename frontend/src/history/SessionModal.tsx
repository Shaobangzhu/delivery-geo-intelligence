import { Button, Input, Select } from "@shaobangzhu/clu-ui";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { DialogFrame } from "./DialogFrame";
import { type DeliveryPage, type Merchant } from "./api";
import { listSessionCandidates, saveSession, sessionError, strategies, type DeliverySession, type DeliveryStrategy } from "./sessionApi";
import { displaySessionTime, initialOccurrence, losAngelesMinuteInput, sessionInstant, sessionTimeCandidates } from "./sessionTime";
import { platforms, type DeliveryPlatform } from "./platform";

export function SessionModal({ session, merchants, onClose, onSaved }: {
  session: DeliverySession | null; merchants: Merchant[]; onClose: () => void; onSaved: () => void;
}) {
  const id = useId();
  const [start, setStart] = useState(session ? losAngelesMinuteInput(session.startedAt) : "");
  const [end, setEnd] = useState(session ? losAngelesMinuteInput(session.endedAt) : "");
  const [startChanged, setStartChanged] = useState(false);
  const [endChanged, setEndChanged] = useState(false);
  const [startOccurrence, setStartOccurrence] = useState(initialOccurrence(session?.startedAt));
  const [endOccurrence, setEndOccurrence] = useState(initialOccurrence(session?.endedAt));
  const [strategy, setStrategy] = useState<DeliveryStrategy | "">(session?.strategy ?? "");
  const [miles, setMiles] = useState(session?.totalDrivenMiles === undefined ? "" : String(session.totalDrivenMiles));
  const [taxMiles, setTaxMiles] = useState(session?.taxEligibleBusinessMiles === undefined ? "" : String(session.taxEligibleBusinessMiles));
  const [offers, setOffers] = useState({
    uber_eats: session?.tripsOfferedByPlatform?.uber_eats?.toString() ?? "",
    doordash: session?.tripsOfferedByPlatform?.doordash?.toString() ?? ""
  });
  const [selected, setSelected] = useState(session?.deliveryIds ?? []);
  const [linkOpen, setLinkOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [candidates, setCandidates] = useState<DeliveryPage | null>(null);
  const [candidateError, setCandidateError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  // Preserve untouched stored instants, including legacy subminute precision and DST folds.
  // New/edited wall times contain minutes only, so serialization zeros seconds and millis.
  const parsedStart = sessionInstant(start, startOccurrence);
  const parsedEnd = sessionInstant(end, endOccurrence);
  const startIso = parsedStart && session && !startChanged ? session.startedAt : parsedStart;
  const endIso = parsedEnd && session && !endChanged ? session.endedAt : parsedEnd;
  useEffect(() => {
    setPage(1);
  }, [startIso, endIso]);
  useEffect(() => {
    if (!linkOpen || !startIso || !endIso || startIso >= endIso) { setCandidates(null); return; }
    const controller = new AbortController(); let active = true;
    setLoading(true); setCandidateError("");
    listSessionCandidates(startIso, endIso, page, controller.signal).then((data) => {
      if (active) { setCandidates(data); setLoading(false); }
    }).catch((cause) => { if (active) { setCandidateError(sessionError(cause)); setCandidates(null); setLoading(false); } });
    return () => { active = false; controller.abort(); };
  }, [linkOpen, startIso, endIso, page, reload]);
  function toggle(deliveryId: string) {
    setSelected((previous) => previous.includes(deliveryId) ? previous.filter((item) => item !== deliveryId) : [...previous, deliveryId]);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending.current) return;
    setError("");
    if (!startIso || !endIso || Date.parse(endIso) <= Date.parse(startIso)) {
      setError("Enter valid Los Angeles start/end times (2000–2100), with end after start. Skipped DST clock times are invalid."); return;
    }
    const total = miles.trim() ? Number(miles) : null;
    const eligible = taxMiles.trim() ? Number(taxMiles) : null;
    if ([total, eligible].some((value) => value !== null && (!Number.isFinite(value) || value < 0)) || (total !== null && eligible !== null && eligible > total)) {
      setError("Enter nonnegative miles; IRS eligible miles cannot exceed total driven miles."); return;
    }
    const offerChanges: Partial<Record<DeliveryPlatform, number | null>> = {};
    for (const { value: platform } of platforms) {
      const raw = offers[platform].trim();
      const input = event.currentTarget.elements.namedItem(platform) as HTMLInputElement;
      const count = raw ? Number(raw) : undefined;
      if (input.validity.badInput || (count !== undefined && (!/^\d+$/.test(raw) || !Number.isSafeInteger(count) || count < 0))) {
        setError("Enter Trips Offered as nonnegative whole numbers within the safe integer range, or leave blank if unknown."); return;
      }
      if (count !== session?.tripsOfferedByPlatform?.[platform]) offerChanges[platform] = count ?? null;
    }
    const original = session?.deliveryIds ?? [];
    const linksChanged = Boolean(session?.associationIntegrity) || selected.length !== original.length || selected.some((item) => !original.includes(item));
    pending.current = true; setBusy(true);
    try {
      await saveSession({ startedAt: startIso, endedAt: endIso,
        ...(strategy ? { strategy } : session?.strategy ? { strategy: null } : {}),
        ...(total !== null ? { totalDrivenMiles: total } : session?.totalDrivenMiles !== undefined ? { totalDrivenMiles: null } : {}),
        ...(eligible !== null ? { taxEligibleBusinessMiles: eligible } : session?.taxEligibleBusinessMiles !== undefined ? { taxEligibleBusinessMiles: null } : {}),
        ...(Object.keys(offerChanges).length ? { tripsOfferedByPlatform: offerChanges } : {}),
        ...(linksChanged ? { deliveryIds: selected } : {})
      }, session?.id);
      onSaved();
    } catch (cause) { setError(sessionError(cause)); }
    finally { pending.current = false; setBusy(false); }
  }
  const deliveryLabel = (delivery: { id: string; merchantId: string; pickedUpAt: string }) => `${displaySessionTime(delivery.pickedUpAt)} · ${merchants.find((merchant) => merchant.id === delivery.merchantId)?.name ?? "Delivery"} · ${delivery.id.slice(-6)}`;
  return <DialogFrame title={session ? "Edit Session" : "Add Session"} onClose={onClose} busy={busy} className="delivery-dialog">
    <p className="dialog-intro">Record the complete operating period, including driving and time outside active deliveries. Times use America/Los_Angeles.</p>
    {session?.associationIntegrity && <p role="alert" className="form-error">An earlier session update did not complete. Review all delivery links before saving. Complete efficiency is blocked until this review succeeds.</p>}
    <form onSubmit={submit} noValidate aria-busy={busy}>
      <div className="form-grid">
        <div className="form-field"><label htmlFor={`${id}-start`}>Session Start *</label><Input id={`${id}-start`} type="datetime-local" step="60" required data-autofocus disabled={busy} value={start} onChange={(event) => { setStart(event.target.value.slice(0, 16)); setStartChanged(true); }} />
          {sessionTimeCandidates(start).length === 2 && <><label htmlFor={`${id}-start-fold`}>Start clock occurrence</label><Select id={`${id}-start-fold`} value={startOccurrence} disabled={busy} onChange={(event) => { setStartOccurrence(event.target.value as "earlier" | "later"); setStartChanged(true); }}><option value="earlier">First occurrence (PDT)</option><option value="later">Second occurrence (PST)</option></Select></>}
        </div>
        <div className="form-field"><label htmlFor={`${id}-end`}>Session End *</label><Input id={`${id}-end`} type="datetime-local" step="60" required disabled={busy} value={end} onChange={(event) => { setEnd(event.target.value.slice(0, 16)); setEndChanged(true); }} />
          {sessionTimeCandidates(end).length === 2 && <><label htmlFor={`${id}-end-fold`}>End clock occurrence</label><Select id={`${id}-end-fold`} value={endOccurrence} disabled={busy} onChange={(event) => { setEndOccurrence(event.target.value as "earlier" | "later"); setEndChanged(true); }}><option value="earlier">First occurrence (PDT)</option><option value="later">Second occurrence (PST)</option></Select></>}
        </div>
        <div className="form-field form-wide"><label htmlFor={`${id}-strategy`}>Operating Strategy</label><Select id={`${id}-strategy`} disabled={busy} value={strategy} onChange={(event) => setStrategy(event.target.value as DeliveryStrategy | "")}><option value="">Not recorded</option>{strategies.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</Select></div>
        {platforms.map(({ value, label }) => <div className="form-field" key={value}><label htmlFor={`${id}-${value}`}>{label} — Trips Offered</label><Input id={`${id}-${value}`} name={value} type="number" min="0" max={Number.MAX_SAFE_INTEGER} step="1" aria-describedby={`${id}-offers-help`} disabled={busy} value={offers[value]} onChange={(event) => setOffers((previous) => ({ ...previous, [value]: event.target.value }))} /></div>)}
        <p id={`${id}-offers-help`} className="duration-help form-wide">Enter offers reported by each delivery platform during this session. Leave blank if unknown or not monitored. Zero means no offers were received while online.</p>
        <div className="form-field"><label htmlFor={`${id}-miles`}>Total Driven Miles</label><Input id={`${id}-miles`} type="number" min="0" step="any" disabled={busy} value={miles} onChange={(event) => setMiles(event.target.value)} /></div>
        <div className="form-field"><label htmlFor={`${id}-tax`}>IRS Eligible Business Miles</label><Input id={`${id}-tax`} type="number" min="0" step="any" disabled={busy} value={taxMiles} onChange={(event) => setTaxMiles(event.target.value)} /></div>
        <p className="duration-help form-wide">Leave unknown mileage blank. Eligibility is manually recorded; session miles do not automatically qualify for a tax deduction.</p>
      </div>
      <details className="settlement-details" open={linkOpen} onToggle={(event) => setLinkOpen(event.currentTarget.open)}>
        <summary>Link Deliveries (Optional) · {selected.length} selected</summary>
        <p className="duration-help">Time range suggests candidates only. Check each delivery to link it explicitly; existing links survive changes to session times.</p>
        {session?.linkedDeliveries.map((delivery) => <label key={delivery.id} className="session-link"><input type="checkbox" checked={selected.includes(delivery.id)} disabled={busy} onChange={() => toggle(delivery.id)} />{deliveryLabel(delivery)} (existing link)</label>)}
        {loading ? <p role="status">Loading candidate deliveries…</p> : candidateError ? <p role="alert">{candidateError}</p> : !candidates ? <p>Enter a valid start and end to browse deliveries.</p>
          : <>
            {candidates.data.filter((delivery) => !session?.deliveryIds.includes(delivery.id)).map((delivery) => <label key={delivery.id} className="session-link"><input type="checkbox" checked={selected.includes(delivery.id)} disabled={busy || Boolean(delivery.sessionId && delivery.sessionId !== session?.id)} onChange={() => toggle(delivery.id)} />{deliveryLabel(delivery)}{delivery.sessionId && delivery.sessionId !== session?.id ? " (linked to another session)" : ""}</label>)}
            {!candidates.data.length && <p>No deliveries in this interval.</p>}
            <div className="session-candidate-pages"><Button type="button" variant="secondary" size="small" disabled={busy || page <= 1} onClick={() => setPage((value) => value - 1)}>Previous candidates</Button><span>Page {page} of {Math.max(1, candidates.pagination.totalPages)}</span><Button type="button" variant="secondary" size="small" disabled={busy || page >= candidates.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next candidates</Button></div>
          </>}
        <Button type="button" variant="quiet" size="small" disabled={busy || loading} onClick={() => setReload((value) => value + 1)}>Refresh candidates</Button>
        {selected.filter((item) => !session?.deliveryIds.includes(item) && !candidates?.data.some((delivery) => delivery.id === item)).map((item) => <label key={item} className="session-link"><input type="checkbox" checked disabled={busy} onChange={() => toggle(item)} />Selected delivery · {item.slice(-6)} (outside current candidate page)</label>)}
      </details>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="dialog-actions"><Button type="button" variant="secondary" size="small" disabled={busy} onClick={onClose}>Cancel</Button><Button variant="primary" size="small" disabled={busy} type="submit">{busy ? "Saving…" : "Save Session"}</Button></div>
    </form>
  </DialogFrame>;
}
