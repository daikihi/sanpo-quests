import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FamiliarSpot, GeoPoint } from '../domain/types.ts';

const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const DEFAULT_CENTER: [number, number] = [139.767125, 35.681236]; // Tokyo Station
const DEFAULT_ZOOM = 12.2; // Approx. 5-10 km radius scale

const SPOTS_SOURCE_ID = 'sanpo-familiar-spots';
const SPOT_CIRCLES_SOURCE_ID = 'sanpo-familiar-spot-circles';
const TRACK_SOURCE_ID = 'sanpo-walk-track';
const USER_POINT_SOURCE_ID = 'sanpo-user-point';

const DIRECTION_LAYER_IDS = [
  'sanpo-direction-arrows-roads',
  'sanpo-direction-arrows-track',
] as const;

function createDirectionArrowImage(): ImageData {
  const size = 24;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#0f766e';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(4, 5);
    ctx.lineTo(20, 12);
    ctx.lineTo(4, 19);
    ctx.lineTo(8, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  return (
    ctx?.getImageData(0, 0, size, size) ??
    new ImageData(new Uint8ClampedArray(size * size * 4), size, size)
  );
}

function createCirclePolygon(
  center: GeoPoint,
  radiusMeters: number,
  steps = 40,
): [number, number][] {
  const coords: [number, number][] = [];
  const earthRadius = 6_371_000;
  const latRad = (center.lat * Math.PI) / 180;
  const lngRad = (center.lng * Math.PI) / 180;
  const angularDist = radiusMeters / earthRadius;

  for (let i = 0; i <= steps; i++) {
    const bearing = (2 * Math.PI * i) / steps;
    const sinLat =
      Math.sin(latRad) * Math.cos(angularDist) +
      Math.cos(latRad) * Math.sin(angularDist) * Math.cos(bearing);
    const pointLat = Math.asin(sinLat);
    const pointLng =
      lngRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angularDist) * Math.cos(latRad),
        Math.cos(angularDist) - Math.sin(latRad) * Math.sin(pointLat),
      );
    coords.push([(pointLng * 180) / Math.PI, (pointLat * 180) / Math.PI]);
  }
  return coords;
}

export interface SanpoMapController {
  setDirectionIconsVisible(visible: boolean): void;
  setFamiliarSpots(spots: readonly FamiliarSpot[]): void;
  setUserLocation(point: GeoPoint, flyTo?: boolean): void;
  appendTrackPoint(point: GeoPoint): void;
  resize(): void;
  destroy(): void;
}

export interface CreateMapViewOptions {
  container: HTMLElement;
  initialCenter?: GeoPoint;
  initialSpots?: readonly FamiliarSpot[];
  showDirectionIcons?: boolean;
  onStatusChange?: (message: string) => void;
}

export function createSanpoMapView(
  options: CreateMapViewOptions,
): SanpoMapController {
  const {
    container,
    initialCenter,
    initialSpots = [],
    showDirectionIcons = false,
    onStatusChange,
  } = options;

  let isStyleReady = false;
  let directionIconsVisible = showDirectionIcons;
  let spotsCache: FamiliarSpot[] = [...initialSpots];
  let userPointCache: GeoPoint | null = initialCenter ?? null;
  const trackPoints: GeoPoint[] = initialCenter ? [initialCenter] : [];

  const map = new maplibregl.Map({
    container,
    style: OPENFREEMAP_STYLE_URL,
    center: initialCenter
      ? [initialCenter.lng, initialCenter.lat]
      : DEFAULT_CENTER,
    zoom: DEFAULT_ZOOM,
    attributionControl: { compact: true },
  });

  map.addControl(
    new maplibregl.NavigationControl({ showCompass: true }),
    'top-right',
  );
  map.addControl(
    new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }),
    'bottom-left',
  );

  function updateSpotsGeoJson(): void {
    const pointSource = map.getSource(SPOTS_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    const circleSource = map.getSource(SPOT_CIRCLES_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;

    if (pointSource) {
      pointSource.setData({
        type: 'FeatureCollection',
        features: spotsCache.map((spot) => ({
          type: 'Feature',
          properties: { name: spot.name, radius: `${spot.radiusMeters}m` },
          geometry: { type: 'Point', coordinates: [spot.lng, spot.lat] },
        })),
      });
    }

    if (circleSource) {
      circleSource.setData({
        type: 'FeatureCollection',
        features: spotsCache.map((spot) => ({
          type: 'Feature',
          properties: { name: spot.name },
          geometry: {
            type: 'Polygon',
            coordinates: [createCirclePolygon(spot, spot.radiusMeters)],
          },
        })),
      });
    }
  }

  function updateTrackGeoJson(): void {
    const trackSource = map.getSource(TRACK_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!trackSource) return;

    const features: GeoJSON.Feature[] =
      trackPoints.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: trackPoints.map((p) => [p.lng, p.lat]),
              },
            },
          ]
        : [];
    trackSource.setData({ type: 'FeatureCollection', features });
  }

  function updateUserPointGeoJson(): void {
    const userSource = map.getSource(USER_POINT_SOURCE_ID) as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!userSource) return;

    userSource.setData({
      type: 'FeatureCollection',
      features: userPointCache
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'Point',
                coordinates: [userPointCache.lng, userPointCache.lat],
              },
            },
          ]
        : [],
    });
  }

  function applyDirectionVisibility(): void {
    if (!isStyleReady) return;
    const vis = directionIconsVisible ? 'visible' : 'none';
    for (const layerId of DIRECTION_LAYER_IDS) {
      if (map.getLayer(layerId)) {
        map.setLayoutProperty(layerId, 'visibility', vis);
      }
    }
  }

  map.on('load', () => {
    isStyleReady = true;
    onStatusChange?.('OpenFreeMap（鉄道網・河川レイヤー強調）を表示中');

    if (!map.hasImage('sanpo-direction-arrow')) {
      map.addImage('sanpo-direction-arrow', createDirectionArrowImage(), {
        pixelRatio: 2,
      });
    }

    const style = map.getStyle();
    const hasOpenMapTiles = Boolean(style.sources?.openmaptiles);

    // 1. Emphasize existing water & railway layers from OpenFreeMap style
    for (const layer of style.layers ?? []) {
      const idLower = layer.id.toLowerCase();
      if (
        layer.type === 'fill' &&
        (idLower.includes('water') || idLower.includes('river'))
      ) {
        try {
          map.setPaintProperty(layer.id, 'fill-color', '#7dd3fc');
          map.setPaintProperty(layer.id, 'fill-opacity', 0.72);
        } catch {
          // Ignore incompatible layer paint properties
        }
      }
      if (layer.type === 'line' && idLower.includes('waterway')) {
        try {
          map.setPaintProperty(layer.id, 'line-color', '#0284c7');
        } catch {
          // Ignore
        }
      }
      if (
        layer.type === 'line' &&
        (idLower.includes('rail') || idLower.includes('transit'))
      ) {
        try {
          map.setPaintProperty(layer.id, 'line-color', '#c2410c');
        } catch {
          // Ignore
        }
      }
    }

    // 2. Add explicit high-visibility emphasis layers for the 2 core vector layers:
    //    (a) Rivers / waterways and (b) Railway network
    if (hasOpenMapTiles) {
      if (!map.getLayer('sanpo-highlight-waterway')) {
        map.addLayer({
          id: 'sanpo-highlight-waterway',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'waterway',
          paint: {
            'line-color': '#0284c7',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 14, 5],
            'line-opacity': 0.88,
          },
        });
      }

      if (!map.getLayer('sanpo-highlight-rail')) {
        map.addLayer({
          id: 'sanpo-highlight-rail',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
          paint: {
            'line-color': '#c2410c',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.2, 14, 4.2],
            'line-opacity': 0.92,
          },
        });
      }

      if (!map.getLayer('sanpo-highlight-rail-ties')) {
        map.addLayer({
          id: 'sanpo-highlight-rail-ties',
          type: 'line',
          source: 'openmaptiles',
          'source-layer': 'transportation',
          filter: ['in', ['get', 'class'], ['literal', ['rail', 'transit']]],
          paint: {
            'line-color': '#fff7ed',
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.2, 14, 2],
            'line-dasharray': [2, 3],
            'line-opacity': 0.95,
          },
        });
      }

      // Direction arrows on vector roads (default OFF)
      if (!map.getLayer('sanpo-direction-arrows-roads')) {
        map.addLayer({
          id: 'sanpo-direction-arrows-roads',
          type: 'symbol',
          source: 'openmaptiles',
          'source-layer': 'transportation',
          filter: [
            'in',
            ['get', 'class'],
            [
              'literal',
              ['primary', 'secondary', 'tertiary', 'minor', 'path'],
            ],
          ],
          layout: {
            visibility: directionIconsVisible ? 'visible' : 'none',
            'symbol-placement': 'line',
            'symbol-spacing': 90,
            'icon-image': 'sanpo-direction-arrow',
            'icon-size': 0.8,
            'icon-rotation-alignment': 'map',
            'icon-allow-overlap': false,
          },
        });
      }
    }

    // 3. Familiar Spots (circles + pins)
    map.addSource(SPOT_CIRCLES_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'sanpo-spot-circles-fill',
      type: 'fill',
      source: SPOT_CIRCLES_SOURCE_ID,
      paint: {
        'fill-color': '#d97706',
        'fill-opacity': 0.14,
      },
    });
    map.addLayer({
      id: 'sanpo-spot-circles-stroke',
      type: 'line',
      source: SPOT_CIRCLES_SOURCE_ID,
      paint: {
        'line-color': '#b45309',
        'line-width': 1.5,
        'line-dasharray': [3, 2],
      },
    });

    map.addSource(SPOTS_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'sanpo-spot-pins',
      type: 'circle',
      source: SPOTS_SOURCE_ID,
      paint: {
        'circle-radius': 6,
        'circle-color': '#d97706',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });

    // 4. Walk check-in track + direction arrows (default OFF)
    map.addSource(TRACK_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'sanpo-walk-track-line',
      type: 'line',
      source: TRACK_SOURCE_ID,
      paint: {
        'line-color': '#1b5e4b',
        'line-width': 3.5,
        'line-opacity': 0.85,
      },
    });
    map.addLayer({
      id: 'sanpo-direction-arrows-track',
      type: 'symbol',
      source: TRACK_SOURCE_ID,
      layout: {
        visibility: directionIconsVisible ? 'visible' : 'none',
        'symbol-placement': 'line',
        'symbol-spacing': 60,
        'icon-image': 'sanpo-direction-arrow',
        'icon-size': 1,
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
      },
    });

    // 5. Current user location marker
    map.addSource(USER_POINT_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    map.addLayer({
      id: 'sanpo-user-point-halo',
      type: 'circle',
      source: USER_POINT_SOURCE_ID,
      paint: {
        'circle-radius': 14,
        'circle-color': '#1b5e4b',
        'circle-opacity': 0.22,
      },
    });
    map.addLayer({
      id: 'sanpo-user-point-dot',
      type: 'circle',
      source: USER_POINT_SOURCE_ID,
      paint: {
        'circle-radius': 6.5,
        'circle-color': '#1b5e4b',
        'circle-stroke-width': 2.5,
        'circle-stroke-color': '#ffffff',
      },
    });

    updateSpotsGeoJson();
    updateTrackGeoJson();
    updateUserPointGeoJson();
    applyDirectionVisibility();
  });

  map.on('error', () => {
    onStatusChange?.(
      '地図タイルの読み込みに失敗しました（オフラインでもルール判定は利用できます）',
    );
  });

  return {
    setDirectionIconsVisible(visible: boolean) {
      directionIconsVisible = visible;
      applyDirectionVisibility();
    },
    setFamiliarSpots(spots: readonly FamiliarSpot[]) {
      spotsCache = [...spots];
      if (isStyleReady) {
        updateSpotsGeoJson();
      }
    },
    setUserLocation(point: GeoPoint, flyTo = true) {
      userPointCache = point;
      if (isStyleReady) {
        updateUserPointGeoJson();
      }
      if (flyTo) {
        map.flyTo({
          center: [point.lng, point.lat],
          zoom: Math.max(map.getZoom(), DEFAULT_ZOOM),
          duration: 600,
        });
      }
    },
    appendTrackPoint(point: GeoPoint) {
      trackPoints.push(point);
      userPointCache = point;
      if (isStyleReady) {
        updateTrackGeoJson();
        updateUserPointGeoJson();
      }
    },
    resize() {
      map.resize();
    },
    destroy() {
      map.remove();
    },
  };
}
