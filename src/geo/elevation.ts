import { lonLatToTile, type TileId } from "./webMercator";

const DEM_ZOOM = 15;
const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";

interface ElevationTile {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const tileCache = new Map<string, Promise<ElevationTile | null>>();
const resolvedTileCache = new Map<string, ElevationTile | null>();

function tileKey(tile: TileId): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

function terrariumUrl(tile: TileId): string {
  return `${TERRARIUM_URL}/${tile.z}/${tile.x}/${tile.y}.png`;
}

function lonLatToTileFraction(lon: number, lat: number, zoom: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y =
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
    n;
  return { x, y };
}

function decodeTerrarium(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const i = (y * width + x) * 4;
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  return r * 256 + g + b / 256 - 32768;
}

function sampleTileElevation(
  elevationTile: ElevationTile,
  lon: number,
  lat: number,
  tile: TileId,
): number {
  const fractional = lonLatToTileFraction(lon, lat, tile.z);
  const px = Math.max(
    0,
    Math.min(elevationTile.width - 1, (fractional.x - tile.x) * elevationTile.width),
  );
  const py = Math.max(
    0,
    Math.min(elevationTile.height - 1, (fractional.y - tile.y) * elevationTile.height),
  );
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = Math.min(elevationTile.width - 1, x0 + 1);
  const y1 = Math.min(elevationTile.height - 1, y0 + 1);
  const tx = px - x0;
  const ty = py - y0;

  const h00 = decodeTerrarium(elevationTile.data, elevationTile.width, x0, y0);
  const h10 = decodeTerrarium(elevationTile.data, elevationTile.width, x1, y0);
  const h01 = decodeTerrarium(elevationTile.data, elevationTile.width, x0, y1);
  const h11 = decodeTerrarium(elevationTile.data, elevationTile.width, x1, y1);
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - ty) + hx1 * ty;
}

async function loadElevationTile(tile: TileId): Promise<ElevationTile | null> {
  const key = tileKey(tile);
  const cached = tileCache.get(key);
  if (cached) return cached;

  const promise = fetch(terrariumUrl(tile))
    .then(async (response) => {
      if (!response.ok) return null;
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0);
      const image = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      bitmap.close();
      return {
        data: image.data,
        width: image.width,
        height: image.height,
      };
    })
    .catch(() => null)
    .then((elevationTile) => {
      resolvedTileCache.set(key, elevationTile);
      return elevationTile;
    });

  tileCache.set(key, promise);
  return promise;
}

export async function sampleElevation(lon: number, lat: number): Promise<number | null> {
  const tile = lonLatToTile(lon, lat, DEM_ZOOM);
  const elevationTile = await loadElevationTile(tile);
  if (!elevationTile) return null;

  return sampleTileElevation(elevationTile, lon, lat, tile);
}

export function sampleElevationFromCache(lon: number, lat: number): number | null {
  const tile = lonLatToTile(lon, lat, DEM_ZOOM);
  const elevationTile = resolvedTileCache.get(tileKey(tile));
  if (!elevationTile) return null;
  return sampleTileElevation(elevationTile, lon, lat, tile);
}
