# GIS learning objectives

This phase demonstrates three different questions over the same filtered observations:

1. **Pickup Volume:** visualize observed pickup count as heat intensity only.
2. **Merchant Diversity:** show each distinct active physical merchant once as an equal-size category point, regardless of repeat pickups.
3. **Destination Heatmap:** visualize only generalized destination density, without individual destination interaction.

The browser maintains one ArcGIS `Map` and `MapView` across filter and metric changes. Two client-side `FeatureLayer`s separate public merchant data from generalized destination cells. `applyEdits()` changes feature data; switching metric changes layer visibility and the merchant renderer. Layer views are created for the current MapView, and their `updating` state drives progress feedback. React cleanup removes watchers and events and destroys the view.

The public merchant layer has a `PopupTemplate`. Pickup Volume uses only a `HeatmapRenderer` weighted by `deliveryCount`, retaining sparse-data density tuning. Merchant Diversity uses only a `UniqueValueRenderer` on `category`, with equal-size self-contained SVG `PictureMarkerSymbol`s. Category is encoded with color and icon, and no size visual variable is used. The destination layer uses only a `HeatmapRenderer` weighted by cell `count`, has popups disabled, and is never given an individual marker renderer. Switching to destination closes any open merchant popup and hides the merchant layer.

The metric alone selects the representation. Quantitative pickup intensity calls for a heatmap; distinct entities and categories call for discrete symbols; privacy-sensitive destination activity is rendered only as heat intensity.

The backend applies calendar and category filters before returning map data. The LayerView is responsible for drawing and update state, not for redefining those filter semantics. The destination endpoint sends only generalized coordinates needed for rendering; ArcGIS can render them, but the UI never prints them or offers feature inspection.

The Merchant Diversity category point map shows distinct active merchants, not a true `COUNT(DISTINCT merchantId)` per spatial grid cell. A grid or hex analysis is deferred until there is enough data and a clear spatial unit to justify it.
