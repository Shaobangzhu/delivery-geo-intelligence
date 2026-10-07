import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DashboardMap } from "./DashboardMap";
import type { ArcgisRuntime } from "./arcgisRuntime";
import type { DestinationCell, DiversityLocation, PickupLocation } from "./dashboardMapController";

const { loadArcgisMock } = vi.hoisted(() => ({ loadArcgisMock: vi.fn() }));
vi.mock("./arcgisRuntime", () => ({ loadArcgis: loadArcgisMock }));

class FakeMap {
  static instances: FakeMap[] = [];
  layers: unknown[] = [];
  constructor(public options: unknown) { FakeMap.instances.push(this); }
  add(layer: unknown) { this.layers.push(layer); }
}
class FakeMapView {
  static instances: FakeMapView[] = [];
  static whenPromise: Promise<void> | null = null;
  static destinationLayerViewGate: Promise<void> | null = null;
  removeEvent = vi.fn();
  destroy = vi.fn();
  closePopup = vi.fn();
  on = vi.fn(() => ({ remove: this.removeEvent }));
  when = vi.fn(() => FakeMapView.whenPromise ?? Promise.resolve());
  whenLayerView = vi.fn(async (layer: FakeFeatureLayer) => {
    if (layer.options.title === "Generalized observed destination activity") await FakeMapView.destinationLayerViewGate;
    return { updating: false };
  });
  constructor(public options: unknown) { FakeMapView.instances.push(this); }
}
class FakeFeatureLayer {
  static instances: FakeFeatureLayer[] = [];
  static firstEditGate: Promise<void> | null = null;
  renderer: unknown;
  visible: boolean;
  popupEnabled: boolean;
  popupTemplate: unknown;
  edits: Array<{ addFeatures?: FakeGraphic[]; updateFeatures?: FakeGraphic[]; deleteFeatures?: { objectId: number }[] }> = [];
  private nextObjectId = 1;
  private featureIds = new Set<number>();
  when = vi.fn(async () => undefined);
  applyEdits = vi.fn(async (edit: { addFeatures?: FakeGraphic[]; updateFeatures?: FakeGraphic[]; deleteFeatures?: { objectId: number }[] }) => {
    this.edits.push(edit);
    if (this.edits.length === 1 && FakeFeatureLayer.firstEditGate) await FakeFeatureLayer.firstEditGate;
    const deleteFeatureResults = (edit.deleteFeatures ?? []).map(({ objectId }) => {
      const existed = this.featureIds.delete(objectId);
      return existed ? { objectId } : { objectId, error: new Error(`Feature with object id ${objectId} missing`) };
    });
    const addFeatureResults = (edit.addFeatures ?? []).map((graphic) => {
      const requested = Number(graphic.options.attributes.ObjectID);
      const objectId = Math.max(requested, this.nextObjectId);
      this.nextObjectId = objectId + 1;
      this.featureIds.add(objectId);
      graphic.options.attributes.ObjectID = objectId;
      return { objectId };
    });
    const updateFeatureResults = (edit.updateFeatures ?? []).map((graphic) => {
      const objectId = Number(graphic.options.attributes.ObjectID);
      return this.featureIds.has(objectId) ? { objectId } : { objectId, error: new Error(`Feature with object id ${objectId} missing`) };
    });
    return { addFeatureResults, updateFeatureResults, deleteFeatureResults };
  });
  constructor(public options: Record<string, unknown>) {
    FakeFeatureLayer.instances.push(this);
    this.visible = options.visible !== false;
    this.popupEnabled = options.popupEnabled !== false;
    this.popupTemplate = options.popupTemplate;
  }
}
class FakeGraphic { constructor(public options: { geometry?: FakePoint; attributes: Record<string, unknown> }) {} }
class FakePoint { constructor(public options: { longitude: number; latitude: number }) {} }
class FakeHeatmapRenderer { constructor(public options: Record<string, unknown>) {} }
class FakeUniqueValueRenderer { constructor(public options: Record<string, unknown>) {} }
class FakePictureMarkerSymbol { constructor(public options: Record<string, unknown>) {} }
class FakePopupTemplate { constructor(public options: Record<string, unknown>) {} }

const removeWatch = vi.fn();
const watch = vi.fn(() => ({ remove: removeWatch }));
const config = { apiKey: "" };
const runtime = {
  Map: FakeMap, MapView: FakeMapView, FeatureLayer: FakeFeatureLayer,
  Graphic: FakeGraphic, Point: FakePoint, HeatmapRenderer: FakeHeatmapRenderer,
  UniqueValueRenderer: FakeUniqueValueRenderer, PictureMarkerSymbol: FakePictureMarkerSymbol,
  PopupTemplate: FakePopupTemplate, config, reactiveUtils: { watch }
} as unknown as ArcgisRuntime;

const pickupRows: PickupLocation[] = [
  { id: "merchant-a", name: "Same Brand", category: "restaurant", city: "Test City", deliveries: 5,
    totalEarnings: 20, averageEarnings: 10, sampleCount: 2, location: { type: "Point", coordinates: [0, 0] } },
  { id: "merchant-b", name: "Same Brand", category: "restaurant", city: "Test City", deliveries: 2,
    totalEarnings: null, averageEarnings: null, sampleCount: 0, location: { type: "Point", coordinates: [1, 1] } }
];
const diversityRows: DiversityLocation[] = pickupRows.map(({ id, name, category, city, location }) =>
  ({ id, name, category, city, location, distinctMerchantCount: 1 }));
const destinationCells: DestinationCell[] = [
  { location: { type: "Point", coordinates: [2.2, 3.3] }, count: 4 }
];

beforeEach(() => {
  FakeMap.instances = [];
  FakeMapView.instances = [];
  FakeMapView.whenPromise = null;
  FakeMapView.destinationLayerViewGate = null;
  FakeFeatureLayer.instances = [];
  FakeFeatureLayer.firstEditGate = null;
  loadArcgisMock.mockReset();
  loadArcgisMock.mockResolvedValue(runtime);
  watch.mockClear();
  removeWatch.mockClear();
  vi.stubEnv("VITE_ARCGIS_API_KEY", "public-test-key");
});
afterEach(() => vi.unstubAllEnvs());

it("weights pickup activity and distinct merchant variety differently in one persistent view", async () => {
  const { rerender, unmount } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const [merchantLayer, destinationLayer] = FakeFeatureLayer.instances;
  expect(FakeMap.instances).toHaveLength(1);
  expect(FakeMapView.instances).toHaveLength(1);
  expect(FakeMap.instances[0].layers).toEqual([merchantLayer, destinationLayer]);
  expect(config.apiKey).toBe("public-test-key");
  expect((merchantLayer.renderer as FakeHeatmapRenderer).options.field).toBe("deliveryCount");
  expect(merchantLayer.edits[0].addFeatures?.map((feature) => feature.options.attributes.deliveryCount)).toEqual([5, 2]);
  expect(merchantLayer.edits[0].addFeatures?.map((feature) => feature.options.attributes.merchantWeight)).toEqual([1, 1]);
  expect(merchantLayer.edits[0].addFeatures?.map((feature) => feature.options.attributes.ObjectID)).toEqual([1, 2]);

  rerender(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="merchantDiversity" />);
  expect(merchantLayer.renderer).toBeInstanceOf(FakeUniqueValueRenderer);
  expect((merchantLayer.renderer as FakeUniqueValueRenderer).options.field).toBe("category");
  expect((merchantLayer.renderer as FakeUniqueValueRenderer).options.visualVariables).toBeUndefined();
  expect(merchantLayer.edits).toHaveLength(1);
  expect(FakeMapView.instances).toHaveLength(1);
  expect(watch).toHaveBeenCalledTimes(2);
  unmount();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
  expect(FakeMapView.instances[0].removeEvent).toHaveBeenCalledTimes(1);
  expect(removeWatch).toHaveBeenCalledTimes(2);
});

it("uses equal category icons with the real ArcGIS renderer and preserves canonical metric renderers", async () => {
  const [{ default: UniqueValueRenderer }, { default: PictureMarkerSymbol }] = await Promise.all([
    import("@arcgis/core/renderers/UniqueValueRenderer.js"),
    import("@arcgis/core/symbols/PictureMarkerSymbol.js")
  ]);
  loadArcgisMock.mockResolvedValue({ ...runtime, UniqueValueRenderer, PictureMarkerSymbol } as ArcgisRuntime);
  const props = { pickupRows, diversityRows, destinationCells };
  const { rerender } = render(<DashboardMap {...props} metric="merchantDiversity" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const [layer, destination] = FakeFeatureLayer.instances;
  const popup = layer.popupTemplate;
  const renderer = layer.renderer;
  expect(renderer).toBeInstanceOf(UniqueValueRenderer);
  if (!(renderer instanceof UniqueValueRenderer)) throw new Error("Expected category renderer");
  expect(renderer.field).toBe("category");
  expect(renderer.visualVariables).toBeNull();
  const infos = renderer.uniqueValueInfos;
  if (!infos) throw new Error("Expected explicit category symbols");
  expect(infos.map((info) => info.value)).toEqual(["restaurant", "grocery", "retail", "other"]);
  const icons = infos.map((info) => {
    expect(info.symbol).toBeInstanceOf(PictureMarkerSymbol);
    const symbol = info.symbol as InstanceType<typeof PictureMarkerSymbol>;
    expect(symbol.width).toBe(18); // ArcGIS converts 24 CSS pixels to 18 points.
    expect(symbol.height).toBe(18);
    expect(symbol.url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    return decodeURIComponent(symbol.url!.split(",")[1]);
  });
  ["#EF4444", "#16A34A", "#7C3AED", "#64748B"].forEach((color, index) => {
    expect(icons[index]).toContain(`fill="${color}"`);
    expect(icons[index]).toContain('stroke="white"');
    expect(icons[index]).toContain('width="24" height="24"');
  });
  expect(new Set(icons.map((svg) => svg.match(/<path d="([^"]+)"/)?.[1])).size).toBe(4);
  rerender(<DashboardMap {...props} metric="pickupVolume" />);
  expect(layer.renderer).toBeInstanceOf(FakeHeatmapRenderer);
  expect((layer.renderer as FakeHeatmapRenderer).options).toMatchObject({ field: "deliveryCount", maxDensity: 0.02, radius: 28 });
  rerender(<DashboardMap {...props} metric="merchantDiversity" />);
  expect(layer.renderer).toBeInstanceOf(UniqueValueRenderer);
  expect(layer.popupTemplate).toBe(popup);
  expect(layer.popupEnabled).toBe(true);
  rerender(<DashboardMap {...props} metric="destinationHeatmap" />);
  await waitFor(() => expect(destination.visible).toBe(true));
  expect(layer.visible).toBe(false);
  expect(layer.popupEnabled).toBe(false);
  expect(destination.popupEnabled).toBe(false);
  expect(destination.popupTemplate).toBeNull();
  expect((destination.renderer as FakeHeatmapRenderer).options.field).toBe("count");
  rerender(<DashboardMap {...props} metric="pickupVolume" />);
  expect(layer.visible).toBe(true);
  expect(destination.visible).toBe(false);
  expect(layer.renderer).toBeInstanceOf(FakeHeatmapRenderer);
  rerender(<DashboardMap {...props} metric="merchantDiversity" />);
  expect(layer.renderer).toBeInstanceOf(UniqueValueRenderer);
  expect(layer.edits[0].addFeatures?.map((feature) => feature.options.attributes.merchantId)).toEqual(["merchant-a", "merchant-b"]);

  expect(FakeMapView.instances).toHaveLength(1);
  expect(FakeMap.instances[0].layers).toHaveLength(2);
  expect(watch).toHaveBeenCalledTimes(2);
  expect(layer.edits).toHaveLength(1);
});

it("renders destinations only as a noninteractive generalized heatmap and clears them on filter change", async () => {
  const { rerender } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={destinationCells} metric="destinationHeatmap" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[1]?.edits).toHaveLength(1));
  const [merchantLayer, destinationLayer] = FakeFeatureLayer.instances;
  const view = FakeMapView.instances[0];
  expect(merchantLayer.visible).toBe(false);
  expect(merchantLayer.popupEnabled).toBe(false);
  expect(destinationLayer.visible).toBe(true);
  expect(destinationLayer.popupEnabled).toBe(false);
  expect(destinationLayer.popupTemplate).toBeNull();
  expect((destinationLayer.renderer as FakeHeatmapRenderer).options.field).toBe("count");
  expect(destinationLayer.edits[0].addFeatures?.[0].options.attributes).toEqual({ ObjectID: 1, count: 4 });
  expect(destinationLayer.options.fields).toEqual([{ name: "ObjectID", type: "oid" }, { name: "count", type: "integer" }]);
  expect(view.closePopup).toHaveBeenCalled();
  expect(JSON.stringify(destinationLayer.options)).not.toMatch(/address|merchantName|deliveryId/i);

  rerender(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="destinationHeatmap" />);
  expect(destinationLayer.visible).toBe(false);
  await waitFor(() => expect(destinationLayer.edits).toHaveLength(2));
  expect(destinationLayer.edits[1].deleteFeatures).toEqual([{ objectId: 1 }]);
  await waitFor(() => expect(destinationLayer.visible).toBe(true));
  rerender(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  expect(merchantLayer.visible).toBe(true);
  expect(merchantLayer.popupEnabled).toBe(true);
  expect(destinationLayer.visible).toBe(false);
  expect(FakeMapView.instances).toHaveLength(1);
});

it("keeps pending destination edits hidden when switching back to public metrics", async () => {
  let finishEdits!: () => void;
  FakeFeatureLayer.firstEditGate = new Promise<void>((resolve) => { finishEdits = resolve; });
  const props = { pickupRows, diversityRows, destinationCells };
  const { rerender } = render(<DashboardMap {...props} metric="destinationHeatmap" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[1]?.edits).toHaveLength(1));
  const [merchant, destination] = FakeFeatureLayer.instances;
  expect(destination.visible).toBe(false);
  rerender(<DashboardMap {...props} metric="merchantDiversity" />);
  expect(merchant.renderer).toBeInstanceOf(FakeUniqueValueRenderer);
  expect(merchant.visible).toBe(true);
  finishEdits();
  await waitFor(() => expect(destination.applyEdits).toHaveResolved());
  expect(destination.visible).toBe(false);
  rerender(<DashboardMap {...props} metric="destinationHeatmap" />);
  await waitFor(() => expect(destination.visible).toBe(true));
  expect(destination.popupEnabled).toBe(false);
  expect(merchant.visible).toBe(false);
  rerender(<DashboardMap {...props} metric="pickupVolume" />);
  expect(merchant.visible).toBe(true);
  expect(destination.visible).toBe(false);
  expect(merchant.renderer).toBeInstanceOf(FakeHeatmapRenderer);
  expect(FakeMapView.instances).toHaveLength(1);
  expect(FakeFeatureLayer.instances).toHaveLength(2);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("uses a sparse-data density range accepted by the real ArcGIS heatmap renderer", async () => {
  const { default: HeatmapRenderer } = await import("@arcgis/core/renderers/HeatmapRenderer.js");
  loadArcgisMock.mockResolvedValue({ ...runtime, HeatmapRenderer } as ArcgisRuntime);
  render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={destinationCells} metric="destinationHeatmap" />);

  const layer = () => FakeFeatureLayer.instances[1];
  await waitFor(() => expect(layer()?.visible).toBe(true));
  const renderer = layer().renderer;
  expect(renderer).toBeInstanceOf(HeatmapRenderer);
  if (!(renderer instanceof HeatmapRenderer)) throw new Error("Expected ArcGIS HeatmapRenderer");
  expect(renderer.field).toBe("count");
  expect(renderer.minDensity).toBe(0);
  expect(renderer.maxDensity).toBeLessThan(new HeatmapRenderer().maxDensity);
  expect(layer().popupEnabled).toBe(false);
});

it("uses the SDK-assigned ID when a generalized cell returns after a filter change", async () => {
  const { rerender } = render(<DashboardMap pickupRows={[]} diversityRows={[]}
    destinationCells={destinationCells} metric="destinationHeatmap" />);
  const layer = () => FakeFeatureLayer.instances[1];
  await waitFor(() => expect(layer()?.edits).toHaveLength(1));
  rerender(<DashboardMap pickupRows={[]} diversityRows={[]}
    destinationCells={[]} metric="destinationHeatmap" />);
  await waitFor(() => expect(layer().edits).toHaveLength(2));
  rerender(<DashboardMap pickupRows={[]} diversityRows={[]}
    destinationCells={destinationCells} metric="destinationHeatmap" />);
  await waitFor(() => expect(layer().edits).toHaveLength(3));
  expect(layer().edits[2].addFeatures?.[0].options.attributes.ObjectID).toBe(2);
  rerender(<DashboardMap pickupRows={[]} diversityRows={[]}
    destinationCells={[]} metric="destinationHeatmap" />);
  await waitFor(() => expect(layer().edits).toHaveLength(4));
  expect(layer().edits[3].deleteFeatures).toEqual([{ objectId: 2 }]);
  await waitFor(() => expect(layer().visible).toBe(true));
  expect(screen.queryByText("The destination heatmap could not be updated.")).not.toBeInTheDocument();
});

it("uses the SDK-assigned ID when a public merchant returns after a filter change", async () => {
  const { rerender } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  const layer = () => FakeFeatureLayer.instances[0];
  await waitFor(() => expect(layer()?.edits).toHaveLength(1));
  rerender(<DashboardMap pickupRows={[pickupRows[0]]} diversityRows={[diversityRows[0]]}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(layer().edits).toHaveLength(2));
  rerender(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(layer().edits).toHaveLength(3));
  expect(layer().edits[2].addFeatures?.[0].options.attributes.ObjectID).toBe(3);
  rerender(<DashboardMap pickupRows={[pickupRows[0]]} diversityRows={[diversityRows[0]]}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(layer().edits).toHaveLength(4));
  expect(layer().edits[3].deleteFeatures).toEqual([{ objectId: 3 }]);
  expect(screen.queryByText("The merchant locations could not be updated.")).not.toBeInTheDocument();
});

it("serializes rapid merchant filter edits and applies only the latest data", async () => {
  let finishFirst!: () => void;
  FakeFeatureLayer.firstEditGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  const { rerender } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const layer = FakeFeatureLayer.instances[0];
  rerender(<DashboardMap pickupRows={[pickupRows[0]]} diversityRows={[diversityRows[0]]}
    destinationCells={[]} metric="pickupVolume" />);
  rerender(<DashboardMap pickupRows={[{ ...pickupRows[1], deliveries: 4 }]} diversityRows={[diversityRows[1]]}
    destinationCells={[]} metric="pickupVolume" />);
  finishFirst();
  await waitFor(() => expect(layer.edits).toHaveLength(2));
  expect(layer.edits[1].deleteFeatures).toEqual([{ objectId: 1 }]);
  expect(layer.edits[1].updateFeatures?.[0].options.attributes.deliveryCount).toBe(4);
  expect(FakeMapView.instances).toHaveLength(1);
});

it("updates an existing merchant's public point after an address correction without rebuilding the map", async () => {
  const { rerender } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const corrected = { ...pickupRows[0], location: { type: "Point" as const, coordinates: [4, 5] as [number, number] } };
  rerender(<DashboardMap pickupRows={[corrected, pickupRows[1]]} diversityRows={[{ ...diversityRows[0], location: corrected.location }, diversityRows[1]]}
    destinationCells={[]} metric="pickupVolume" />);
  const layer = FakeFeatureLayer.instances[0];
  await waitFor(() => expect(layer.edits).toHaveLength(2));
  expect(layer.edits[1].updateFeatures?.[0].options.geometry?.options).toMatchObject({ longitude: 4, latitude: 5 });
  expect(FakeMapView.instances).toHaveLength(1);
});

it("updates merchant data while the hidden destination layer view is still initializing", async () => {
  FakeMapView.destinationLayerViewGate = new Promise<void>(() => undefined);
  const { unmount } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  expect(watch).toHaveBeenCalledTimes(1);
  unmount();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
});

it("avoids construction after early unmount and skips late watchers after view destruction", async () => {
  let resolveImport!: (value: ArcgisRuntime) => void;
  loadArcgisMock.mockReturnValue(new Promise<ArcgisRuntime>((done) => { resolveImport = done; }));
  const early = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  early.unmount();
  resolveImport(runtime);
  await Promise.resolve();
  expect(FakeMapView.instances).toHaveLength(0);

  let resolveReady!: () => void;
  FakeMapView.whenPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
  loadArcgisMock.mockResolvedValue(runtime);
  const late = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" />);
  await waitFor(() => expect(FakeMapView.instances).toHaveLength(1));
  late.unmount();
  resolveReady();
  await Promise.resolve();
  await Promise.resolve();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
  expect(FakeFeatureLayer.instances[0].edits).toHaveLength(0);
  expect(watch).not.toHaveBeenCalled();
});
