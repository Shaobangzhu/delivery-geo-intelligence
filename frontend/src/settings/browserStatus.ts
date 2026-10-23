import { useSyncExternalStore } from "react";
export type BrowserEvent = "map_initialized" | "map_initialization_failure" | "layer_initialization_failure" | "layer_update_failure" | "not_configured";
let snapshot: { event: BrowserEvent | null; timestamp: string | null } = { event: null, timestamp: null };
const listeners = new Set<() => void>();
export function observeBrowserMap(event: BrowserEvent) {
  snapshot = { event, timestamp: new Date().toISOString() };
  listeners.forEach((notify) => notify());
}
export const getBrowserMapStatus = () => snapshot;
export function useBrowserMapStatus() {
  return useSyncExternalStore((notify) => { listeners.add(notify); return () => { listeners.delete(notify); }; }, getBrowserMapStatus);
}

// Clear session observations for isolated hosts/tests without retaining previous lifecycle state.
export function resetBrowserMapStatus() {
  snapshot = { event: null, timestamp: null };
  listeners.forEach((notify) => notify());
}
