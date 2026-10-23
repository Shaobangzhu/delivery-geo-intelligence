// SDK contract adapter ONLY for the dedicated E2E build. The production component,
// controller, feature edits, filter updates and session observations run unchanged.
// No WebGL, basemap tiles, geocoding quality or live ArcGIS connectivity is tested.
const event = (name, details = {}) => window.dispatchEvent(new CustomEvent("dgi:e2e:map", { detail: { name, ...details } }));
class Value {
  constructor(options) { Object.assign(this, options); }
}
class Layer extends Value {
  features = new Map();
  async when() { return this; }
  async applyEdits({ addFeatures = [], updateFeatures = [], deleteFeatures = [] }) {
    for (const feature of [...addFeatures, ...updateFeatures]) {
      if (!Number.isInteger(feature.attributes.ObjectID)) throw new Error("Invalid synthetic feature ID");
      this.features.set(feature.attributes.ObjectID, feature);
    }
    for (const item of deleteFeatures) this.features.delete(item.objectId);
    event("features_updated", { layer: this.title, count: this.features.size, visible: this.visible });
    return {
      addFeatureResults: addFeatures.map((item) => ({ objectId: item.attributes.ObjectID })),
      updateFeatureResults: updateFeatures.map((item) => ({ objectId: item.attributes.ObjectID })),
      deleteFeatureResults: deleteFeatures.map((item) => ({ objectId: item.objectId }))
    };
  }
}
class View extends Value {
  graphics = { add() { throw new Error("Private home coordinates must not enter the E2E build"); } };
  constructor(options) { super(options); event("view_created"); }
  async when() {
    if (sessionStorage.getItem("dgi:e2e:map-failure") === "initialization") throw new Error("Synthetic map initialization failure");
    event("view_ready");
    return this;
  }
  async whenLayerView() { return { updating: false }; }
  on() { return { remove() {} }; }
  closePopup() {}
  destroy() { event("view_destroyed"); }
}
export async function loadArcgis() {
  return {
    Map: class { add() {} }, MapView: View, FeatureLayer: Layer,
    Graphic: Value, Point: Value, HeatmapRenderer: Value, UniqueValueRenderer: Value,
    PictureMarkerSymbol: Value, PopupTemplate: Value, config: {},
    reactiveUtils: { watch(getter, callback) { callback(getter()); return { remove() {} }; } }
  };
}
