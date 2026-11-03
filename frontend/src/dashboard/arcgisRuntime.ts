import { ignoreArcgisTrace, traceArcgisPromise, type ArcgisTrace } from "./arcgisDiagnostics";

export async function loadArcgis(trace: ArcgisTrace = ignoreArcgisTrace) {
  const [Map, MapView, FeatureLayer, Graphic, Point, HeatmapRenderer, UniqueValueRenderer, PictureMarkerSymbol, PopupTemplate, config, reactiveUtils] = await Promise.all([
    traceArcgisPromise(trace, "import:Map.js", import("@arcgis/core/Map.js")),
    traceArcgisPromise(trace, "import:views/MapView.js", import("@arcgis/core/views/MapView.js")),
    traceArcgisPromise(trace, "import:layers/FeatureLayer.js", import("@arcgis/core/layers/FeatureLayer.js")),
    traceArcgisPromise(trace, "import:Graphic.js", import("@arcgis/core/Graphic.js")),
    traceArcgisPromise(trace, "import:geometry/Point.js", import("@arcgis/core/geometry/Point.js")),
    traceArcgisPromise(trace, "import:renderers/HeatmapRenderer.js", import("@arcgis/core/renderers/HeatmapRenderer.js")),
    traceArcgisPromise(trace, "import:renderers/UniqueValueRenderer.js", import("@arcgis/core/renderers/UniqueValueRenderer.js")),
    traceArcgisPromise(trace, "import:symbols/PictureMarkerSymbol.js", import("@arcgis/core/symbols/PictureMarkerSymbol.js")),
    traceArcgisPromise(trace, "import:PopupTemplate.js", import("@arcgis/core/PopupTemplate.js")),
    traceArcgisPromise(trace, "import:config.js", import("@arcgis/core/config.js")),
    traceArcgisPromise(trace, "import:core/reactiveUtils.js", import("@arcgis/core/core/reactiveUtils.js"))
  ]);
  return {
    Map: Map.default, MapView: MapView.default, FeatureLayer: FeatureLayer.default,
    Graphic: Graphic.default, Point: Point.default,
    HeatmapRenderer: HeatmapRenderer.default,
    UniqueValueRenderer: UniqueValueRenderer.default, PictureMarkerSymbol: PictureMarkerSymbol.default,
    PopupTemplate: PopupTemplate.default,
    config: config.default, reactiveUtils
  };
}

export type ArcgisRuntime = Awaited<ReturnType<typeof loadArcgis>>;
