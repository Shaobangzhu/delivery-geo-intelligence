/** Development-only lifecycle evidence. Never retain SDK objects or application data. */
export interface ArcgisDiagnostic {
  attempt: number;
  stage: string;
  elapsedMs: number;
  navigationMs: number;
  error?: { name: string; message: string; stack?: string; cause?: ArcgisDiagnostic["error"] };
}

declare global {
  interface Window { __DGI_ARCGIS_DIAGNOSTICS__?: ArcgisDiagnostic[] }
}
let nextAttempt = 0;

function redact(value: unknown): string {
  let text = String(value);
  for (const secret of [import.meta.env.VITE_ARCGIS_API_KEY, import.meta.env.VITE_DGI_HOME_LONGITUDE, import.meta.env.VITE_DGI_HOME_LATITUDE]) {
    if (secret?.trim()) text = text.replaceAll(secret.trim(), "<redacted>");
  }
  return text.replace(/https?:\/\/[^\s"'<>]+/g, (url) => url.split(/[?#]/)[0])
    .replace(/data:[^\s"']+/g, "<data-url>")
    .replace(/(?:[A-Za-z]:[\\/]|\/)(?:Users|home)[\\/][^\s"'<>)]*/g, "<private-path>")
    .slice(0, 4000);
}

function describe(error: unknown, depth = 0): ArcgisDiagnostic["error"] {
  if (depth > 2) return undefined;
  if (typeof error !== "object" || error === null) return { name: "UnknownError", message: redact(error) };
  const value = error as { name?: unknown; message?: unknown; stack?: unknown; cause?: unknown };
  return {
    name: redact(value.name ?? "Error"), message: redact(value.message ?? "Unknown error"),
    ...(value.stack ? { stack: redact(value.stack) } : {}),
    ...(value.cause !== undefined ? { cause: describe(value.cause, depth + 1) } : {})
  };
}

export type ArcgisTrace = (stage: string, error?: unknown) => void;
export const ignoreArcgisTrace: ArcgisTrace = () => {};

export function createArcgisTrace(): ArcgisTrace {
  if (!import.meta.env.DEV) return ignoreArcgisTrace;
  const attempt = ++nextAttempt;
  const started = performance.now();
  return (stage, error) => {
    try {
      const entry: ArcgisDiagnostic = { attempt, stage, elapsedMs: Math.round((performance.now() - started) * 10) / 10,
        navigationMs: Math.round(performance.now() * 10) / 10,
        ...(error !== undefined ? { error: describe(error) } : {}) };
      const entries = window.__DGI_ARCGIS_DIAGNOSTICS__ ??= [];
      entries.push(entry);
      if (entries.length > 250) entries.splice(0, entries.length - 250);
      if (entry.error) console.error("[DGI ArcGIS]", entry);
      window.dispatchEvent(new CustomEvent("dgi:arcgis-diagnostic", { detail: entry }));
    } catch { /* Diagnostics must not interrupt initialization or cleanup. */ }
  };
}

export function traceArcgisPromise<T>(trace: ArcgisTrace, stage: string, promise: Promise<T>): Promise<T> {
  if (!import.meta.env.DEV) return promise;
  trace(`${stage}:start`);
  return promise.then((value) => { trace(`${stage}:ready`); return value; }, (error: unknown) => {
    trace(`${stage}:failure`, error);
    throw error;
  });
}
