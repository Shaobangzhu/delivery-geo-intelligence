import type { DashboardData, DestinationHeatmapData, Metric } from "./api";
import type { ArcgisRuntime } from "./arcgisRuntime";

export type PickupLocation = DashboardData["map"]["pickupVolume"][number];
export type DiversityLocation = DashboardData["map"]["merchantDiversity"][number];
export type DestinationCell = DestinationHeatmapData["cells"][number];
export type MapMode = "heatmap" | "points";

export class DashboardMapController {
  private readonly view: InstanceType<ArcgisRuntime["MapView"]>;
  private readonly merchantLayer: InstanceType<ArcgisRuntime["FeatureLayer"]>;
  private readonly destinationLayer: InstanceType<ArcgisRuntime["FeatureLayer"]>;
  private readonly handles: { remove(): void }[] = [];
  private readonly ready: Promise<void>;
  private merchantEdits: Promise<void> = Promise.resolve();
  private destinationEdits: Promise<void> = Promise.resolve();
  private displayedMerchants = new Map<string, number>();
  private displayedCells = new Map<string, number>();
  private readonly merchantObjectIds = new Map<string, number>();
  private readonly cellObjectIds = new Map<string, number>();
  private nextMerchantObjectId = 1;
  private nextCellObjectId = 1;
  private pickupRows: PickupLocation[] = [];
  private destinationCells: DestinationCell[] = [];
  private merchantSignature = "[],[]";
  private destinationSignature = "[]";
  private metric: Metric = "pickupVolume";
  private mode: MapMode = "heatmap";
  private merchantUpdating = false;
  private destinationUpdating = false;
  private destinationPending = false;
  private merchantRevision = 0;
  private destinationRevision = 0;
  private destroyed = false;

  constructor(
    container: HTMLDivElement,
    private readonly arcgis: ArcgisRuntime,
    private readonly onError: (message: string) => void,
    private readonly onUpdating: (value: boolean) => void
  ) {
    const map = new arcgis.Map({ basemap: "arcgis/light-gray/base" });
    this.merchantLayer = new arcgis.FeatureLayer({
      title: "Observed merchant pickups",
      source: [], geometryType: "point", spatialReference: { wkid: 4326 },
      objectIdField: "ObjectID", outFields: ["*"],
      fields: [
        { name: "ObjectID", type: "oid" }, { name: "merchantId", type: "string" },
        { name: "merchantName", type: "string" }, { name: "category", type: "string" },
        { name: "deliveryCount", type: "integer" }, { name: "merchantWeight", type: "integer" },
        { name: "totalKnownEarnings", type: "double" }, { name: "averageEarnings", type: "double" },
        { name: "sampleCount", type: "integer" }
      ],
      popupTemplate: new arcgis.PopupTemplate({
        title: "{merchantName}",
        content: [{ type: "fields", fieldInfos: [
          { fieldName: "category", label: "Category" },
          { fieldName: "deliveryCount", label: "Observed deliveries" },
          { fieldName: "totalKnownEarnings", label: "Total known earnings (USD)", format: { places: 2, digitSeparator: true } },
          { fieldName: "averageEarnings", label: "Average earnings (USD)", format: { places: 2, digitSeparator: true } },
          { fieldName: "sampleCount", label: "Average sample count" }
        ] }]
      })
    });
    this.destinationLayer = new arcgis.FeatureLayer({
      title: "Generalized observed destination activity",
      source: [], geometryType: "point", spatialReference: { wkid: 4326 },
      objectIdField: "ObjectID", outFields: ["ObjectID", "count"],
      fields: [{ name: "ObjectID", type: "oid" }, { name: "count", type: "integer" }],
      popupEnabled: false, popupTemplate: null, visible: false, listMode: "hide"
    });
    map.add(this.merchantLayer);
    map.add(this.destinationLayer);
    this.view = new arcgis.MapView({ container, map, center: [-117.58, 33.97], zoom: 11 });
    this.handles.push(this.view.on("layerview-create-error", () => {
      if (!this.destroyed) this.onError("A map layer could not be displayed.");
    }));
    this.ready = Promise.all([this.view.when(), this.merchantLayer.when(), this.destinationLayer.when()]).then(() => {
      if (this.destroyed) return;
      void this.view.whenLayerView(this.merchantLayer).then((layerView) => {
        if (this.destroyed) return;
        this.handles.push(this.arcgis.reactiveUtils.watch(() => layerView.updating, (value) => {
          this.merchantUpdating = value;
          this.emitUpdating();
        }, { initial: true }));
      }).catch(() => { if (!this.destroyed) this.onError("The merchant map layer could not be displayed."); });
      void this.view.whenLayerView(this.destinationLayer).then((layerView) => {
        if (this.destroyed) return;
        this.handles.push(this.arcgis.reactiveUtils.watch(() => layerView.updating, (value) => {
          this.destinationUpdating = value;
          this.emitUpdating();
        }, { initial: true }));
      }).catch(() => { if (!this.destroyed) this.onError("The destination heatmap layer could not be displayed."); });
    });
    void this.ready.catch(() => {
      if (!this.destroyed) this.onError("The map could not be initialized.");
    });
    this.setMode("pickupVolume", "heatmap");
  }

  private emitUpdating() {
    if (!this.destroyed) this.onUpdating(this.metric === "destinationHeatmap" ? this.destinationUpdating : this.merchantUpdating);
  }

  private heatmap(field: string, largestWeight: number) {
    return new this.arcgis.HeatmapRenderer({
      field, radius: 28, minDensity: 0, maxDensity: Math.max(4, largestWeight * 2),
      colorStops: [
        { ratio: 0, color: "rgba(42, 113, 245, 0)" },
        { ratio: 0.2, color: "rgba(72, 159, 255, 0.65)" },
        { ratio: 0.45, color: "rgba(79, 221, 176, 0.82)" },
        { ratio: 0.7, color: "rgba(255, 211, 65, 0.9)" },
        { ratio: 1, color: "rgba(239, 68, 68, 0.95)" }
      ]
    });
  }

  private merchantRenderer() {
    if (this.mode === "heatmap") {
      return this.metric === "merchantDiversity"
        ? this.heatmap("merchantWeight", 1)
        : this.heatmap("deliveryCount", Math.max(1, ...this.pickupRows.map((row) => row.deliveries)));
    }
    if (this.metric === "merchantDiversity") {
      return new this.arcgis.SimpleRenderer({
        symbol: new this.arcgis.SimpleMarkerSymbol({
          style: "circle", color: "#1769e9", outline: { color: "#ffffff", width: 1.5 }, size: 11
        })
      });
    }
    return new this.arcgis.SimpleRenderer({
      symbol: new this.arcgis.SimpleMarkerSymbol({
        style: "circle", color: "#1769e9", outline: { color: "#ffffff", width: 1.5 }, size: 9
      }),
      visualVariables: [{ type: "size", field: "deliveryCount", stops: [
        { value: 1, size: 9 }, { value: Math.max(2, ...this.pickupRows.map((row) => row.deliveries)), size: 25 }
      ] }]
    });
  }

  setMode(metric: Metric, mode: MapMode): void {
    if (this.destroyed) return;
    this.metric = metric;
    this.mode = mode;
    this.view.closePopup();
    const destinationMode = metric === "destinationHeatmap";
    this.merchantLayer.visible = !destinationMode;
    this.merchantLayer.popupEnabled = !destinationMode;
    this.destinationLayer.visible = destinationMode && !this.destinationPending;
    this.destinationLayer.popupEnabled = false;
    this.merchantLayer.renderer = this.merchantRenderer();
    this.destinationLayer.renderer = this.heatmap("count", Math.max(1, ...this.destinationCells.map((cell) => cell.count)));
    this.emitUpdating();
  }

  setMerchantFeatures(pickupRows: PickupLocation[], diversityRows: DiversityLocation[]): void {
    if (this.destroyed) return;
    const signature = `${JSON.stringify(pickupRows)},${JSON.stringify(diversityRows)}`;
    if (signature === this.merchantSignature) return;
    this.merchantSignature = signature;
    this.pickupRows = pickupRows;
    this.merchantLayer.renderer = this.merchantRenderer();
    const weights = new Map(diversityRows.map((row) => [row.id, row.distinctMerchantCount]));
    const revision = ++this.merchantRevision;
    this.merchantEdits = this.merchantEdits.catch(() => undefined).then(async () => {
      await this.ready;
      if (this.destroyed || revision !== this.merchantRevision) return;
      const next = new Map<string, number>();
      const addFeatures: InstanceType<ArcgisRuntime["Graphic"]>[] = [];
      const updateFeatures: InstanceType<ArcgisRuntime["Graphic"]>[] = [];
      for (const row of pickupRows) {
        let objectId = this.merchantObjectIds.get(row.id);
        if (objectId === undefined) {
          objectId = this.nextMerchantObjectId++;
          this.merchantObjectIds.set(row.id, objectId);
        }
        next.set(row.id, objectId);
        const graphic = new this.arcgis.Graphic({
          geometry: new this.arcgis.Point({
            longitude: row.location.coordinates[0], latitude: row.location.coordinates[1], spatialReference: { wkid: 4326 }
          }),
          attributes: {
            ObjectID: objectId, merchantId: row.id, merchantName: row.name,
            category: row.category, deliveryCount: row.deliveries,
            merchantWeight: weights.get(row.id) ?? 0,
            totalKnownEarnings: row.totalEarnings, averageEarnings: row.averageEarnings,
            sampleCount: row.sampleCount
          }
        });
        if (this.displayedMerchants.has(row.id)) updateFeatures.push(graphic);
        else addFeatures.push(graphic);
      }
      const deleteFeatures = [...this.displayedMerchants].filter(([id]) => !next.has(id)).map(([, objectId]) => ({ objectId }));
      const result = await this.merchantLayer.applyEdits({
        ...(deleteFeatures.length ? { deleteFeatures } : {}),
        ...(addFeatures.length ? { addFeatures } : {}),
        ...(updateFeatures.length ? { updateFeatures } : {})
      });
      if (this.destroyed) return;
      if ([...result.addFeatureResults, ...result.updateFeatureResults, ...result.deleteFeatureResults].some((item) => item.error)) {
        throw new Error("Merchant feature edit failed");
      }
      this.displayedMerchants = next;
    }).catch(() => {
      if (!this.destroyed) {
        this.merchantSignature = "";
        this.onError("The merchant locations could not be updated.");
      }
    });
  }

  setDestinationCells(cells: DestinationCell[]): void {
    if (this.destroyed) return;
    const signature = JSON.stringify(cells);
    if (signature === this.destinationSignature) return;
    this.destinationSignature = signature;
    this.destinationCells = cells;
    this.destinationPending = true;
    this.destinationLayer.visible = false;
    this.destinationLayer.renderer = this.heatmap("count", Math.max(1, ...cells.map((cell) => cell.count)));
    const revision = ++this.destinationRevision;
    this.destinationEdits = this.destinationEdits.catch(() => undefined).then(async () => {
      await this.ready;
      if (this.destroyed || revision !== this.destinationRevision) return;
      const next = new Map<string, number>();
      const addFeatures: InstanceType<ArcgisRuntime["Graphic"]>[] = [];
      const updateFeatures: InstanceType<ArcgisRuntime["Graphic"]>[] = [];
      for (const cell of cells) {
        const key = cell.location.coordinates.join(",");
        let objectId = this.cellObjectIds.get(key);
        if (objectId === undefined) {
          objectId = this.nextCellObjectId++;
          this.cellObjectIds.set(key, objectId);
        }
        next.set(key, objectId);
        const graphic = new this.arcgis.Graphic({
          ...(this.displayedCells.has(key) ? {} : { geometry: new this.arcgis.Point({
            longitude: cell.location.coordinates[0], latitude: cell.location.coordinates[1], spatialReference: { wkid: 4326 }
          }) }),
          attributes: { ObjectID: objectId, count: cell.count }
        });
        if (this.displayedCells.has(key)) updateFeatures.push(graphic);
        else addFeatures.push(graphic);
      }
      const deleteFeatures = [...this.displayedCells].filter(([key]) => !next.has(key)).map(([, objectId]) => ({ objectId }));
      const result = await this.destinationLayer.applyEdits({
        ...(deleteFeatures.length ? { deleteFeatures } : {}),
        ...(addFeatures.length ? { addFeatures } : {}),
        ...(updateFeatures.length ? { updateFeatures } : {})
      });
      if (this.destroyed) return;
      if ([...result.addFeatureResults, ...result.updateFeatureResults, ...result.deleteFeatureResults].some((item) => item.error)) {
        throw new Error("Destination feature edit failed");
      }
      this.displayedCells = next;
      if (revision === this.destinationRevision) {
        this.destinationPending = false;
        this.destinationLayer.visible = this.metric === "destinationHeatmap";
      }
    }).catch(() => {
      if (!this.destroyed) {
        this.destinationSignature = "";
        this.destinationPending = false;
        this.onError("The destination heatmap could not be updated.");
      }
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.merchantRevision += 1;
    this.destinationRevision += 1;
    this.handles.forEach((handle) => handle.remove());
    this.handles.length = 0;
    this.view.destroy();
  }
}
