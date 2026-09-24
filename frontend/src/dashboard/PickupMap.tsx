import { useEffect, useRef, useState } from "react";
import { loadArcgis } from "./arcgisRuntime";
import { PickupMapController, type PickupLocation, type PickupMode } from "./pickupMapController";
import "@arcgis/core/assets/esri/themes/light/main.css";

export function PickupMap({ rows, mode }: { rows: PickupLocation[]; mode: PickupMode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PickupMapController | null>(null);
  const latestRef = useRef({ rows, mode });
  latestRef.current = { rows, mode };
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const key = import.meta.env.VITE_ARCGIS_API_KEY?.trim();
    if (!key) {
      setError("Set VITE_ARCGIS_API_KEY in the frontend environment to show the map.");
      return;
    }
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    void loadArcgis().then((arcgis) => {
      if (cancelled) return;
      arcgis.config.apiKey = key;
      const controller = new PickupMapController(container, arcgis, setError, setUpdating);
      controllerRef.current = controller;
      controller.setFeatures(latestRef.current.rows);
      controller.setMode(latestRef.current.mode);
    }).catch(() => {
      if (!cancelled) setError("The ArcGIS map could not be loaded.");
    });
    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => { controllerRef.current?.setFeatures(rows); }, [rows]);
  useEffect(() => { controllerRef.current?.setMode(mode); }, [mode]);

  return <div className="pickup-map-shell">
    <div ref={containerRef} className="pickup-map-canvas" role="application" aria-label="Observed pickup activity map" />
    {updating && !error && <span className="map-progress" role="status">Updating map…</span>}
    {error && <div className="map-error" role="alert">{error}</div>}
  </div>;
}
