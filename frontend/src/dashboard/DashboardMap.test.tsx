import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
  when = vi.fn(async () => undefined);
  applyEdits = vi.fn(async (edit: { addFeatures?: FakeGraphic[]; updateFeatures?: FakeGraphic[]; deleteFeatures?: { objectId: number }[] }) => {
    this.edits.push(edit);
    if (this.edits.length === 1 && FakeFeatureLayer.firstEditGate) await FakeFeatureLayer.firstEditGate;
    return { addFeatureResults: [], updateFeatureResults: [], deleteFeatureResults: [] };
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
class FakeSimpleRenderer { constructor(public options: Record<string, unknown>) {} }
class FakeSimpleMarkerSymbol { constructor(public options: Record<string, unknown>) {} }
class FakePopupTemplate { constructor(public options: Record<string, unknown>) {} }

const removeWatch = vi.fn();
const watch = vi.fn(() => ({ remove: removeWatch }));
const config = { apiKey: "" };
const runtime = {
  Map: FakeMap, MapView: FakeMapView, FeatureLayer: FakeFeatureLayer,
  Graphic: FakeGraphic, Point: FakePoint, HeatmapRenderer: FakeHeatmapRenderer,
  SimpleRenderer: FakeSimpleRenderer, SimpleMarkerSymbol: FakeSimpleMarkerSymbol,
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
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
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
    destinationCells={[]} metric="merchantDiversity" mode="heatmap" />);
  expect((merchantLayer.renderer as FakeHeatmapRenderer).options.field).toBe("merchantWeight");
  expect(merchantLayer.edits).toHaveLength(1);
  rerender(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="merchantDiversity" mode="points" />);
  expect(merchantLayer.renderer).toBeInstanceOf(FakeSimpleRenderer);
  expect((merchantLayer.renderer as FakeSimpleRenderer).options.visualVariables).toBeUndefined();
  expect(FakeMapView.instances).toHaveLength(1);
  expect(watch).toHaveBeenCalledTimes(2);
  unmount();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
  expect(FakeMapView.instances[0].removeEvent).toHaveBeenCalledTimes(1);
  expect(removeWatch).toHaveBeenCalledTimes(2);
});

it("renders destinations only as a noninteractive generalized heatmap and clears them on filter change", async () => {
  const { rerender } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={destinationCells} metric="destinationHeatmap" mode="points" />);
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
    destinationCells={[]} metric="destinationHeatmap" mode="heatmap" />);
  expect(destinationLayer.visible).toBe(false);
  await waitFor(() => expect(destinationLayer.edits).toHaveLength(2));
  expect(destinationLayer.edits[1].deleteFeatures).toEqual([{ objectId: 1 }]);
  await waitFor(() => expect(destinationLayer.visible).toBe(true));
  rerender(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" mode="points" />);
  expect(merchantLayer.visible).toBe(true);
  expect(merchantLayer.popupEnabled).toBe(true);
  expect(destinationLayer.visible).toBe(false);
  expect(FakeMapView.instances).toHaveLength(1);
});

it("serializes rapid merchant filter edits and applies only the latest data", async () => {
  let finishFirst!: () => void;
  FakeFeatureLayer.firstEditGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  const { rerender } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const layer = FakeFeatureLayer.instances[0];
  rerender(<DashboardMap pickupRows={[pickupRows[0]]} diversityRows={[diversityRows[0]]}
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
  rerender(<DashboardMap pickupRows={[{ ...pickupRows[1], deliveries: 4 }]} diversityRows={[diversityRows[1]]}
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
  finishFirst();
  await waitFor(() => expect(layer.edits).toHaveLength(2));
  expect(layer.edits[1].deleteFeatures).toEqual([{ objectId: 1 }]);
  expect(layer.edits[1].updateFeatures?.[0].options.attributes.deliveryCount).toBe(4);
  expect(FakeMapView.instances).toHaveLength(1);
});

it("updates merchant data while the hidden destination layer view is still initializing", async () => {
  FakeMapView.destinationLayerViewGate = new Promise<void>(() => undefined);
  const { unmount } = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  expect(watch).toHaveBeenCalledTimes(1);
  unmount();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
});

it("avoids construction after early unmount and skips late watchers after view destruction", async () => {
  let resolveImport!: (value: ArcgisRuntime) => void;
  loadArcgisMock.mockReturnValue(new Promise<ArcgisRuntime>((done) => { resolveImport = done; }));
  const early = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
  early.unmount();
  resolveImport(runtime);
  await Promise.resolve();
  expect(FakeMapView.instances).toHaveLength(0);

  let resolveReady!: () => void;
  FakeMapView.whenPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
  loadArcgisMock.mockResolvedValue(runtime);
  const late = render(<DashboardMap pickupRows={pickupRows} diversityRows={diversityRows}
    destinationCells={[]} metric="pickupVolume" mode="heatmap" />);
  await waitFor(() => expect(FakeMapView.instances).toHaveLength(1));
  late.unmount();
  resolveReady();
  await Promise.resolve();
  await Promise.resolve();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
  expect(FakeFeatureLayer.instances[0].edits).toHaveLength(0);
  expect(watch).not.toHaveBeenCalled();
});
