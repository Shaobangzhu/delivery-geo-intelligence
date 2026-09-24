import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { PickupMap } from "./PickupMap";
import type { ArcgisRuntime } from "./arcgisRuntime";
import type { PickupLocation } from "./pickupMapController";

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
  removeEvent = vi.fn();
  destroy = vi.fn();
  on = vi.fn(() => ({ remove: this.removeEvent }));
  when = vi.fn(() => FakeMapView.whenPromise ?? Promise.resolve());
  whenLayerView = vi.fn(async () => ({ updating: false }));
  constructor(public options: unknown) { FakeMapView.instances.push(this); }
}

class FakeFeatureLayer {
  static instances: FakeFeatureLayer[] = [];
  static firstEditGate: Promise<void> | null = null;
  renderer: unknown;
  edits: Array<{ addFeatures?: FakeGraphic[]; updateFeatures?: FakeGraphic[]; deleteFeatures?: { objectId: number }[] }> = [];
  when = vi.fn(async () => undefined);
  applyEdits = vi.fn(async (edit: { addFeatures?: FakeGraphic[]; updateFeatures?: FakeGraphic[]; deleteFeatures?: { objectId: number }[] }) => {
    this.edits.push(edit);
    if (this.edits.length === 1 && FakeFeatureLayer.firstEditGate) await FakeFeatureLayer.firstEditGate;
    return { addFeatureResults: [], updateFeatureResults: [], deleteFeatureResults: [] };
  });
  constructor(public options: unknown) { FakeFeatureLayer.instances.push(this); }
}

class FakeGraphic {
  constructor(public options: { geometry?: FakePoint; attributes: Record<string, unknown> }) {}
}
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
  Graphic: FakeGraphic, Point: FakePoint,
  HeatmapRenderer: FakeHeatmapRenderer, SimpleRenderer: FakeSimpleRenderer,
  SimpleMarkerSymbol: FakeSimpleMarkerSymbol, PopupTemplate: FakePopupTemplate,
  config, reactiveUtils: { watch }
} as unknown as ArcgisRuntime;

const rows: PickupLocation[] = [
  { id: "merchant-a", name: "Same Brand", category: "restaurant", city: "Test City", deliveries: 5,
    totalEarnings: 20, averageEarnings: 10, sampleCount: 2, location: { type: "Point", coordinates: [0, 0] } },
  { id: "merchant-b", name: "Same Brand", category: "restaurant", city: "Test City", deliveries: 2,
    totalEarnings: null, averageEarnings: null, sampleCount: 0, location: { type: "Point", coordinates: [1, 1] } }
];

beforeEach(() => {
  FakeMap.instances = [];
  FakeMapView.instances = [];
  FakeMapView.whenPromise = null;
  FakeFeatureLayer.instances = [];
  FakeFeatureLayer.firstEditGate = null;
  loadArcgisMock.mockReset();
  loadArcgisMock.mockResolvedValue(runtime);
  watch.mockClear();
  removeWatch.mockClear();
  vi.stubEnv("VITE_ARCGIS_API_KEY", "public-test-key");
});
afterEach(() => vi.unstubAllEnvs());

it("uses one view and layer while filters edit features and renderer switches", async () => {
  const { rerender, unmount } = render(<PickupMap rows={rows} mode="heatmap" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const layer = FakeFeatureLayer.instances[0];
  expect(FakeMap.instances).toHaveLength(1);
  expect(FakeMapView.instances).toHaveLength(1);
  expect(FakeMap.instances[0].layers).toEqual([layer]);
  expect(config.apiKey).toBe("public-test-key");
  expect(layer.renderer).toBeInstanceOf(FakeHeatmapRenderer);
  expect((layer.renderer as FakeHeatmapRenderer).options.field).toBe("deliveryCount");
  expect(layer.edits[0].addFeatures?.map((feature) => feature.options.attributes.deliveryCount)).toEqual([5, 2]);
  expect(layer.edits[0].addFeatures?.map((feature) => feature.options.attributes.ObjectID)).toEqual([1, 2]);
  expect(JSON.stringify(layer.edits[0])).not.toContain("destination");
  expect(JSON.stringify((layer.options as { popupTemplate: FakePopupTemplate }).popupTemplate.options)).not.toMatch(/destination|latitude|longitude/i);

  rerender(<PickupMap rows={rows} mode="points" />);
  expect(layer.renderer).toBeInstanceOf(FakeSimpleRenderer);
  expect((layer.renderer as FakeSimpleRenderer).options.visualVariables).toMatchObject([{ field: "deliveryCount" }]);
  expect(layer.edits).toHaveLength(1);
  expect(FakeMapView.instances).toHaveLength(1);

  const filtered = [{ ...rows[0], deliveries: 3 }];
  rerender(<PickupMap rows={filtered} mode="points" />);
  await waitFor(() => expect(layer.edits).toHaveLength(2));
  expect(layer.edits[1].deleteFeatures).toEqual([{ objectId: 2 }]);
  expect(layer.edits[1].updateFeatures?.map((feature) => feature.options.attributes.deliveryCount)).toEqual([3]);
  expect(layer.edits[1].updateFeatures?.[0].options.geometry).toBeUndefined();
  expect(FakeMap.instances).toHaveLength(1);
  expect(FakeMapView.instances).toHaveLength(1);
  expect(watch).toHaveBeenCalledTimes(1);

  unmount();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
  expect(FakeMapView.instances[0].removeEvent).toHaveBeenCalledTimes(1);
  expect(removeWatch).toHaveBeenCalledTimes(1);
});

it("serializes rapid filter edits and applies only the latest queued dataset", async () => {
  let finishFirst!: () => void;
  FakeFeatureLayer.firstEditGate = new Promise<void>((resolve) => { finishFirst = resolve; });
  const { rerender, unmount } = render(<PickupMap rows={rows} mode="heatmap" />);
  await waitFor(() => expect(FakeFeatureLayer.instances[0]?.edits).toHaveLength(1));
  const layer = FakeFeatureLayer.instances[0];
  rerender(<PickupMap rows={[rows[0]]} mode="heatmap" />);
  rerender(<PickupMap rows={[{ ...rows[1], deliveries: 4 }]} mode="heatmap" />);
  expect(layer.edits).toHaveLength(1);
  finishFirst();
  await waitFor(() => expect(layer.edits).toHaveLength(2));
  expect(layer.edits[1].deleteFeatures).toEqual([{ objectId: 1 }]);
  expect(layer.edits[1].updateFeatures?.map((feature) => feature.options.attributes.deliveryCount)).toEqual([4]);
  expect(layer.edits[1].addFeatures).toBeUndefined();
  expect(FakeMapView.instances).toHaveLength(1);
  unmount();
});

it("does not construct a view when unmounted before async imports resolve", async () => {
  let resolve!: (value: ArcgisRuntime) => void;
  loadArcgisMock.mockReturnValue(new Promise<ArcgisRuntime>((done) => { resolve = done; }));
  const { unmount } = render(<PickupMap rows={rows} mode="heatmap" />);
  unmount();
  resolve(runtime);
  await Promise.resolve();
  expect(FakeMapView.instances).toHaveLength(0);
});

it("destroys an initializing view and skips late edits and watchers", async () => {
  let resolveReady!: () => void;
  FakeMapView.whenPromise = new Promise<void>((resolve) => { resolveReady = resolve; });
  const { unmount } = render(<PickupMap rows={rows} mode="heatmap" />);
  await waitFor(() => expect(FakeMapView.instances).toHaveLength(1));
  unmount();
  resolveReady();
  await Promise.resolve();
  await Promise.resolve();
  expect(FakeMapView.instances[0].destroy).toHaveBeenCalledTimes(1);
  expect(FakeFeatureLayer.instances[0].edits).toHaveLength(0);
  expect(watch).not.toHaveBeenCalled();
});
