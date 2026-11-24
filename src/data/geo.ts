import { feature } from 'topojson-client';
import landAtlas from 'world-atlas/land-50m.json';

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 1620;

const LON_MIN = -12;
const LON_MAX = 44;
const LAT_MIN = 34;
const LAT_MAX = 63;

function mercY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

const MERC_MIN = mercY(LAT_MIN);
const MERC_MAX = mercY(LAT_MAX);

export function projectGeo(lon: number, lat: number): [number, number] {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * MAP_WIDTH;
  const y = ((MERC_MAX - mercY(lat)) / (MERC_MAX - MERC_MIN)) * MAP_HEIGHT;
  return [x, y];
}

interface LandRing {
  points: [number, number][];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

let cachedPath: Path2D | null = null;
let cachedRings: LandRing[] | null = null;

function ensureLandData() {
  if (cachedPath && cachedRings) return;

  const topo = landAtlas as unknown as { objects: { land: unknown } };
  const geo = feature(
    topo as unknown as Parameters<typeof feature>[0],
    topo.objects.land as Parameters<typeof feature>[1]
  ) as unknown as {
    type: string;
    features?: { geometry: { type: string; coordinates: unknown } }[];
    geometry?: { type: string; coordinates: unknown };
  };

  const geometries =
    geo.type === 'FeatureCollection'
      ? (geo.features ?? []).map((f) => f.geometry)
      : geo.geometry
      ? [geo.geometry]
      : [];

  const path = new Path2D();
  const rings: LandRing[] = [];

  const addPolygonRings = (polygonCoords: number[][][]) => {
    for (let rIdx = 0; rIdx < polygonCoords.length; rIdx++) {
      const ring = polygonCoords[rIdx];
      let overlaps = false;
      for (const [lon, lat] of ring) {
        if (lon >= LON_MIN - 6 && lon <= LON_MAX + 6 && lat >= LAT_MIN - 6 && lat <= LAT_MAX + 6) {
          overlaps = true;
          break;
        }
      }
      if (!overlaps || ring.length < 3) continue;

      const pts: [number, number][] = [];
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (let i = 0; i < ring.length; i++) {
        const [x, y] = projectGeo(ring[i][0], ring[i][1]);
        pts.push([x, y]);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (i === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      }
      path.closePath();

      // Seul l'anneau extérieur (index 0) sert au test de clic sur terre
      if (rIdx === 0) {
        rings.push({ points: pts, minX, maxX, minY, maxY });
      }
    }
  };

  for (const geom of geometries) {
    if (geom.type === 'Polygon') {
      addPolygonRings(geom.coordinates as number[][][]);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates as number[][][][]) {
        addPolygonRings(poly);
      }
    }
  }

  cachedPath = path;
  cachedRings = rings;
}

export function getEuropeLandPath(): Path2D {
  ensureLandData();
  return cachedPath!;
}

export function isPointOnLand(x: number, y: number): boolean {
  ensureLandData();
  for (const ring of cachedRings!) {
    if (x < ring.minX || x > ring.maxX || y < ring.minY || y > ring.maxY) continue;
    let inside = false;
    const pts = ring.points;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0];
      const yi = pts[i][1];
      const xj = pts[j][0];
      const yj = pts[j][1];
      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}