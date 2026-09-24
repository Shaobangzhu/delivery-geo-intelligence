# GIS learning objectives

This phase demonstrates three different questions over the same filtered observations:

1. **Pickup Volume:** weight public merchant locations by observed pickup count.
2. **Merchant Diversity:** count each distinct active merchant once, regardless of repeat pickups.
3. **Destination Heatmap:** visualize only generalized destination density, without individual destination interaction.

The browser maintains one ArcGIS `Map` and `MapView` across filter and metric changes. Two client-side `FeatureLayer`s separate public merchant data from generalized destination cells. `applyEdits()` changes feature data; switching metric changes layer visibility and the merchant renderer. Layer views are created for the current MapView, and their `updating` state drives progress feedback. React cleanup removes watchers and events and destroys the view.

The public merchant layer has a `PopupTemplate`. Its heatmap renderer uses `deliveryCount` for Pickup Volume and a unit `merchantWeight` for Merchant Diversity. Points mode uses a `SimpleRenderer`; Pickup Volume also uses a size visual variable on delivery count. The destination layer uses a `HeatmapRenderer` weighted by cell `count`, has popups disabled, and is never given a Points renderer. Switching to destination mode closes any open merchant popup and hides the merchant layer.

The backend applies calendar and category filters before returning map data. The LayerView is responsible for drawing and update state, not for redefining those filter semantics. The destination endpoint sends only generalized coordinates needed for rendering; ArcGIS can render them, but the UI never prints them or offers feature inspection.

The Merchant Diversity heatmap shows nearby active merchant points, not a true `COUNT(DISTINCT merchantId)` per spatial grid cell. A grid or hex analysis is deferred until there is enough data and a clear spatial unit to justify it.
