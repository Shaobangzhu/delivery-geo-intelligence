import { useSyncExternalStore } from "react";
export type BrowserEvent = "map_initialized" | "map_initialization_failure" | "layer_initialization_failure" | "layer_update_failure" | "not_configured";
let snapshot: { event: BrowserEvent | null; timestamp: string | null } = { event: null, timestamp: null };
const listeners = new Set<() => void>();
function notifyListeners() {
  listeners.forEach((notify) => {
    try { notify(); } catch { /* A telemetry consumer must not interrupt the map or other consumers. */ }
  });
}
export function subscribeBrowserMapStatus(notify: () => void) {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}
export function observeBrowserMap(event: BrowserEvent) {
  snapshot = { event, timestamp: new Date().toISOString() };
  notifyListeners();
}
export const getBrowserMapStatus = () => snapshot;
export function useBrowserMapStatus() {
  return useSyncExternalStore(subscribeBrowserMapStatus, getBrowserMapStatus);
}

// Clear session observations for isolated hosts/tests without retaining previous lifecycle state.
export function resetBrowserMapStatus() {
  snapshot = { event: null, timestamp: null };
  notifyListeners();
}
