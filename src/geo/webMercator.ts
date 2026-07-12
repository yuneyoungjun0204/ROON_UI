const EARTH_RADIUS_M = 6378137;
const ORIGIN_SHIFT_M = Math.PI * EARTH_RADIUS_M;
const WORLD_SIZE_M = ORIGIN_SHIFT_M * 2;

export interface MercatorPoint {
  x: number;
  y: number;
}

export interface LocalPoint {
  x: number;
  z: number;
}

export interface TileId {
  x: number;
  y: number;
  z: number;
}

export interface TileWorldBounds {
  west: number;
  east: number;
  north: number;
  south: number;
}

function clampLat(lat: number): number {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

export function lonLatToMercator(lon: number, lat: number): MercatorPoint {
  const clampedLat = clampLat(lat);
  const x = (lon * ORIGIN_SHIFT_M) / 180;
  const y =
    Math.log(Math.tan(((90 + clampedLat) * Math.PI) / 360)) * EARTH_RADIUS_M;
  return { x, y };
}

export function mercatorToLonLat(point: MercatorPoint): { lon: number; lat: number } {
  const lon = (point.x / ORIGIN_SHIFT_M) * 180;
  const lat =
    (Math.atan(Math.exp(point.y / EARTH_RADIUS_M)) * 360) / Math.PI - 90;
  return { lon, lat };
}

export function lonLatToTile(lon: number, lat: number, zoom: number): TileId {
  const clampedLat = clampLat(lat);
  const latRad = (clampedLat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
  );
  return { x, y, z: zoom };
}

export function tileToMercatorBounds(tile: TileId): TileWorldBounds {
  const n = 2 ** tile.z;
  const west = (tile.x / n) * WORLD_SIZE_M - ORIGIN_SHIFT_M;
  const east = ((tile.x + 1) / n) * WORLD_SIZE_M - ORIGIN_SHIFT_M;
  const north = ORIGIN_SHIFT_M - (tile.y / n) * WORLD_SIZE_M;
  const south = ORIGIN_SHIFT_M - ((tile.y + 1) / n) * WORLD_SIZE_M;
  return { west, east, north, south };
}

export function mercatorToLocal(point: MercatorPoint, origin: MercatorPoint): LocalPoint {
  return {
    x: point.x - origin.x,
    z: -(point.y - origin.y),
  };
}

export function mercatorToLocalMeters(
  point: MercatorPoint,
  origin: MercatorPoint,
  originLat: number,
): LocalPoint {
  const scale = Math.cos((originLat * Math.PI) / 180);
  return {
    x: (point.x - origin.x) * scale,
    z: -(point.y - origin.y) * scale,
  };
}

export function lonLatToLocalMeters(
  lon: number,
  lat: number,
  originLon: number,
  originLat: number,
): LocalPoint {
  return mercatorToLocalMeters(
    lonLatToMercator(lon, lat),
    lonLatToMercator(originLon, originLat),
    originLat,
  );
}

export function localMetersToLonLat(
  x: number,
  z: number,
  originLon: number,
  originLat: number,
): { lon: number; lat: number } {
  const origin = lonLatToMercator(originLon, originLat);
  const scale = Math.cos((originLat * Math.PI) / 180);
  return mercatorToLonLat({
    x: origin.x + x / scale,
    y: origin.y - z / scale,
  });
}
