import { createArcgisTrace } from "./arcgisDiagnostics";
import { observeBrowserMap } from "../settings/browserStatus";
import { useEffect, useRef, useState } from "react";
import { loadArcgis } from "./arcgisRuntime";
import { DashboardMapController, type DestinationCell, type DiversityLocation, type PickupLocation } from "./dashboardMapController";
import type { Metric } from "./api";
import { parseHomeReference } from "./homeReference";
import "@arcgis/core/assets/esri/themes/light/main.css";

interface Props {
  pickupRows: PickupLocation[];
  diversityRows: DiversityLocation[];
  destinationCells: DestinationCell[];
  metric: Metric;
}

export function DashboardMap({ pickupRows, diversityRows, destinationCells, metric }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<DashboardMapController | null>(null);
  const latest = useRef({ pickupRows, diversityRows, destinationCells, metric });
  latest.current = { pickupRows, diversityRows, destinationCells, metric };
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [home] = useState(() => parseHomeReference(import.meta.env.VITE_DGI_HOME_LONGITUDE, import.meta.env.VITE_DGI_HOME_LATITUDE));

  useEffect(() => {
    const trace = createArcgisTrace();
    trace("effect:setup");
    let stage = "sdk-imports";
    let cancelled = false;
    const key = import.meta.env.VITE_ARCGIS_API_KEY?.trim();
    if (!key) {
      trace("status:not_configured");
      observeBrowserMap("not_configured");
      setError("Map configuration is missing.");
      return;
    }
    trace("sdk-imports:start");
    void loadArcgis(trace).then((arcgis) => {
      trace("sdk-imports:ready");
      if (cancelled || !containerRef.current) { trace("effect:cancelled"); return; }
      stage = "api-key";
      arcgis.config.apiKey = key;
      trace("api-key:configured");
      stage = "controller-construction";
      trace("controller:start");
      const controller = new DashboardMapController(containerRef.current, arcgis, (message) => {
        trace("controller:failure");
        setError(message);
        const event = message === "The map could not be initialized." ? "map_initialization_failure" : message.includes("updated") ? "layer_update_failure" : "layer_initialization_failure";
        trace(`status:${event}`);
        observeBrowserMap(event);
      }, setUpdating, home, () => { trace("status:map_initialized"); observeBrowserMap("map_initialized"); }, trace);
      trace("controller:constructed");
      controllerRef.current = controller;
      stage = "initial-features";
      const current = latest.current;
      controller.setMerchantFeatures(current.pickupRows, current.diversityRows);
      controller.setDestinationCells(current.destinationCells);
      controller.setMetric(current.metric);
      trace("initial-features:submitted");
    }).catch((error: unknown) => { trace(`${stage}:failure`, error); if (!cancelled) { trace("status:map_initialization_failure"); observeBrowserMap("map_initialization_failure"); setError("The map could not be loaded."); } });
    return () => {
      trace("effect:cleanup");
      cancelled = true;
      controllerRef.current?.destroy();
      controllerRef.current = null;
    };
  }, [home]);

  useEffect(() => { controllerRef.current?.setMerchantFeatures(pickupRows, diversityRows); }, [pickupRows, diversityRows]);
  useEffect(() => { controllerRef.current?.setDestinationCells(destinationCells); }, [destinationCells]);
  useEffect(() => { controllerRef.current?.setMetric(metric); }, [metric]);

  return <div className="dashboard-map-shell">
    <div className="dashboard-map-canvas" ref={containerRef} aria-label={`${metric === "destinationHeatmap" ? "Generalized destination activity" : "Observed merchant activity"} map`} />
    {updating && <span className="map-progress" role="status">Updating map…</span>}
    {error && <div className="map-error" role="alert">{error}</div>}
    {home && !error && <span className="map-home-reference">🏠 Home</span>}
  </div>;
}
