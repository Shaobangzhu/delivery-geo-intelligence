import type { DashboardData } from "./api";
import type { ArcgisRuntime } from "./arcgisRuntime";

export type PickupLocation = DashboardData["map"]["pickupVolume"][number];
export type PickupMode = "heatmap" | "points";

export class PickupMapController {
  private readonly view: InstanceType<ArcgisRuntime["MapView"]>;
  private readonly layer: InstanceType<ArcgisRuntime["FeatureLayer"]>;
  private readonly handles: { remove(): void }[] = [];
  private readonly ready: Promise<void>;
  private edits: Promise<void> = Promise.resolve();
  private currentIdsByMerchant = new Map<string, number>();
  private readonly objectIdByMerchant = new Map<string, number>();
  private nextObjectId = 1;
  private rows: PickupLocation[] = [];
  private signature = "[]";
  private mode: PickupMode = "heatmap";
  private revision = 0;
  private destroyed = false;

  constructor(
    container: HTMLDivElement,
    private readonly arcgis: ArcgisRuntime,
    private readonly onError: (message: string) => void,
    private readonly onUpdating: (value: boolean) => void
  ) {
    const map = new arcgis.Map({ basemap: "arcgis/light-gray/base" });
    this.layer = new arcgis.FeatureLayer({
      title: "Observed pickup activity",
      source: [], geometryType: "point", spatialReference: { wkid: 4326 },
      objectIdField: "ObjectID", outFields: ["*"],
      fields: [
        { name: "ObjectID", type: "oid" },
        { name: "merchantId", type: "string" },
        { name: "merchantName", type: "string" },
        { name: "category", type: "string" },
        { name: "deliveryCount", type: "integer" },
        { name: "totalKnownEarnings", type: "double" },
        { name: "averageEarnings", type: "double" },
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
    map.add(this.layer);
    this.view = new arcgis.MapView({ container, map, center: [-117.58, 33.97], zoom: 11 });
    this.handles.push(this.view.on("layerview-create-error", () => {
      if (!this.destroyed) this.onError("The pickup layer could not be displayed.");
    }));
    this.ready = Promise.all([this.view.when(), this.layer.when()]).then(async () => {
      if (this.destroyed) return;
      const layerView = await this.view.whenLayerView(this.layer);
      if (this.destroyed) return;
      this.handles.push(this.arcgis.reactiveUtils.watch(() => layerView.updating, (value) => {
        if (!this.destroyed) this.onUpdating(value);
      }, { initial: true }));
    });
    void this.ready.catch(() => {
      if (!this.destroyed) this.onError("The map could not be initialized.");
    });
    this.setMode("heatmap");
  }

  private renderer(mode: PickupMode) {
    if (mode === "heatmap") {
      const largestCount = Math.max(1, ...this.rows.map((row) => row.deliveries));
      return new this.arcgis.HeatmapRenderer({
        field: "deliveryCount", radius: 28, minDensity: 0,
        maxDensity: Math.max(4, largestCount * 2),
        colorStops: [
          { ratio: 0, color: "rgba(42, 113, 245, 0)" },
          { ratio: 0.2, color: "rgba(72, 159, 255, 0.65)" },
          { ratio: 0.45, color: "rgba(79, 221, 176, 0.82)" },
          { ratio: 0.7, color: "rgba(255, 211, 65, 0.9)" },
          { ratio: 1, color: "rgba(239, 68, 68, 0.95)" }
        ]
      });
    }
    const largestCount = Math.max(2, ...this.rows.map((row) => row.deliveries));
    return new this.arcgis.SimpleRenderer({
      symbol: new this.arcgis.SimpleMarkerSymbol({
        style: "circle", color: "#1769e9", outline: { color: "#ffffff", width: 1.5 }, size: 9
      }),
      visualVariables: [{ type: "size", field: "deliveryCount", stops: [
        { value: 1, size: 9 }, { value: largestCount, size: 25 }
      ] }]
    });
  }

  setMode(mode: PickupMode): void {
    if (this.destroyed) return;
    this.mode = mode;
    this.layer.renderer = this.renderer(mode);
  }

  setFeatures(rows: PickupLocation[]): void {
    if (this.destroyed) return;
    const signature = JSON.stringify(rows);
    if (signature === this.signature) return;
    this.signature = signature;
    this.rows = rows;
    this.layer.renderer = this.renderer(this.mode);
    const revision = ++this.revision;
    this.edits = this.edits.catch(() => undefined).then(async () => {
      await this.ready;
      if (this.destroyed || revision !== this.revision) return;
      const nextIdsByMerchant = new Map<string, number>();
      const addFeatures: InstanceType<ArcgisRuntime["Graphic"]>[] = [];
      const updateFeatures: InstanceType<ArcgisRuntime["Graphic"]>[] = [];
      for (const row of rows) {
        let objectId = this.objectIdByMerchant.get(row.id);
        if (objectId === undefined) {
          objectId = this.nextObjectId++;
          this.objectIdByMerchant.set(row.id, objectId);
        }
        nextIdsByMerchant.set(row.id, objectId);
        const attributes = {
          ObjectID: objectId, merchantId: row.id, merchantName: row.name,
          category: row.category, deliveryCount: row.deliveries,
          totalKnownEarnings: row.totalEarnings, averageEarnings: row.averageEarnings,
          sampleCount: row.sampleCount
        };
        const graphic = new this.arcgis.Graphic({
          ...(this.currentIdsByMerchant.has(row.id) ? {} : { geometry: new this.arcgis.Point({
            longitude: row.location.coordinates[0], latitude: row.location.coordinates[1], spatialReference: { wkid: 4326 }
          }) }),
          attributes
        });
        if (this.currentIdsByMerchant.has(row.id)) updateFeatures.push(graphic);
        else addFeatures.push(graphic);
      }
      const deleteFeatures = [...this.currentIdsByMerchant].filter(([id]) => !nextIdsByMerchant.has(id))
        .map(([, objectId]) => ({ objectId }));
      const result = await this.layer.applyEdits({
        ...(deleteFeatures.length ? { deleteFeatures } : {}),
        ...(addFeatures.length ? { addFeatures } : {}),
        ...(updateFeatures.length ? { updateFeatures } : {})
      });
      if (this.destroyed) return;
      if ([...result.addFeatureResults, ...result.updateFeatureResults, ...result.deleteFeatureResults].some((item) => item.error)) {
        throw new Error("Pickup feature edit failed");
      }
      this.currentIdsByMerchant = nextIdsByMerchant;
    }).catch(() => {
      if (!this.destroyed) {
        this.signature = "";
        this.onError("The pickup locations could not be updated.");
      }
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.revision += 1;
    this.handles.forEach((handle) => handle.remove());
    this.handles.length = 0;
    this.view.destroy();
  }
}
