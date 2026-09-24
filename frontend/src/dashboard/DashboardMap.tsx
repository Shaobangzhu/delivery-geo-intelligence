import { useEffect, useRef, useState } from "react";
import { loadArcgis } from "./arcgisRuntime";
import { DashboardMapController, type DestinationCell, type DiversityLocation, type MapMode, type PickupLocation } from "./dashboardMapController";
import type { Metric } from "./api";
import "@arcgis/core/assets/esri/themes/light/main.css";

interface Props {
  pickupRows: PickupLocation[];
  diversityRows: DiversityLocation[];
  destinationCells: DestinationCell[];
  metric: Metric;
  mode: MapMode;
}

export function DashboardMap({ pickupRows, diversityRows, destinationCells, metric, mode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DashboardMapController | null>(null);
  const latest = useRef({ pickupRows, diversityRows, destinationCells, metric, mode });
  latest.current = { pickupRows, diversityRows, destinationCells, metric, mode };
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const key = import.meta.env.VITE_ARCGIS_API_KEY?.trim();
    if (!key) {
      setError("Map configuration is missing.");
      return;
    }
    void loadArcgis().then((arcgis) => {
      if (cancelled || !containerRef.current) return;
      arcgis.config.apiKey = key;
      const controller = new DashboardMapController(containerRef.current, arcgis, setError, setUpdating);
      controllerRef.current = controller;
      const current = latest.current;
      controller.setMerchantFeatures(current.pickupRows, current.diversityRows);
      controller.setDestinationCells(current.destinationCells);
      controller.setMode(current.metric, current.mode);
    }).catch(() => { if (!cancelled) setError("The map could not be loaded."); });
    return () => {
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => { controllerRef.current?.setMerchantFeatures(pickupRows, diversityRows); }, [pickupRows, diversityRows]);
  useEffect(() => { controllerRef.current?.setDestinationCells(destinationCells); }, [destinationCells]);
  useEffect(() => { controllerRef.current?.setMode(metric, mode); }, [metric, mode]);

  return <div className="dashboard-map-shell">
    <div className="dashboard-map-canvas" ref={containerRef} aria-label={`${metric === "destinationHeatmap" ? "Generalized destination activity" : "Observed merchant activity"} map`} />
    {updating && <span className="map-progress" role="status">Updating map…</span>}
    {error && <div className="map-error" role="alert">{error}</div>}
  </div>;
}
