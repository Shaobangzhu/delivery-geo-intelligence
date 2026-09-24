export async function loadArcgis() {
  const [Map, MapView, FeatureLayer, Graphic, Point, HeatmapRenderer, SimpleRenderer, SimpleMarkerSymbol, PopupTemplate, config, reactiveUtils] = await Promise.all([
    import("@arcgis/core/Map.js"),
    import("@arcgis/core/views/MapView.js"),
    import("@arcgis/core/layers/FeatureLayer.js"),
    import("@arcgis/core/Graphic.js"),
    import("@arcgis/core/geometry/Point.js"),
    import("@arcgis/core/renderers/HeatmapRenderer.js"),
    import("@arcgis/core/renderers/SimpleRenderer.js"),
    import("@arcgis/core/symbols/SimpleMarkerSymbol.js"),
    import("@arcgis/core/PopupTemplate.js"),
    import("@arcgis/core/config.js"),
    import("@arcgis/core/core/reactiveUtils.js")
  ]);
  return {
    Map: Map.default, MapView: MapView.default, FeatureLayer: FeatureLayer.default,
    Graphic: Graphic.default, Point: Point.default,
    HeatmapRenderer: HeatmapRenderer.default, SimpleRenderer: SimpleRenderer.default,
    SimpleMarkerSymbol: SimpleMarkerSymbol.default, PopupTemplate: PopupTemplate.default,
    config: config.default, reactiveUtils
  };
}

export type ArcgisRuntime = Awaited<ReturnType<typeof loadArcgis>>;
