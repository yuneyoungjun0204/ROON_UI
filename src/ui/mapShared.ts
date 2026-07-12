// 지도 캔버스 공용 유틸 — 미니맵과 웨이포인트 플래너가
// 같은 웹 메르카토르 투영·타일 캐시·항법 오버레이(스테이션 존/항로/핀/선박)를 공유한다.

import { config, STATION_ZONE_RADIUS_M } from "../config";
import { localMetersToLonLat } from "../geo/webMercator";
import type { LocalPoint } from "../geo/webMercator";
import type { PlannedRoute } from "../nav/pathPlanner";

export const TILE_SIZE = 256;
export const MAP_ZOOMS = [18, 17, 16, 15];

const tileImages = new Map<string, HTMLImageElement>();

export function project(lon: number, lat: number, zoom: number) {
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const latRad = (clampedLat * Math.PI) / 180;
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    x: ((lon + 180) / 360) * scale,
    y:
      ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) *
      scale,
  };
}

/** project()의 역변환 — 웹 메르카토르 픽셀 좌표 → 위경도 */
export function unproject(x: number, y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI * (1 - (2 * y) / scale);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lon, lat };
}

export function metersPerPixel(lat: number, zoom: number) {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

function vworldTileUrl(layer: "Satellite" | "Hybrid", zoom: number, x: number, y: number) {
  const ext = layer === "Satellite" ? "jpeg" : "png";
  return `https://api.vworld.kr/req/wmts/1.0.0/${config.vworldKey}/${layer}/${zoom}/${y}/${x}.${ext}`;
}

function getTileImage(url: string) {
  const cached = tileImages.get(url);
  if (cached) return cached;
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = url;
  tileImages.set(url, image);
  return image;
}

function drawTileLayer(
  ctx: CanvasRenderingContext2D,
  layer: "Satellite" | "Hybrid",
  zoom: number,
  center: { x: number; y: number },
  width: number,
  height: number,
) {
  const halfW = width / 2;
  const halfH = height / 2;
  const minTileX = Math.floor((center.x - halfW) / TILE_SIZE);
  const maxTileX = Math.floor((center.x + halfW) / TILE_SIZE);
  const minTileY = Math.floor((center.y - halfH) / TILE_SIZE);
  const maxTileY = Math.floor((center.y + halfH) / TILE_SIZE);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const image = getTileImage(vworldTileUrl(layer, zoom, tileX, tileY));
      if (!image.complete || image.naturalWidth === 0) continue;
      ctx.drawImage(
        image,
        tileX * TILE_SIZE - center.x + halfW,
        tileY * TILE_SIZE - center.y + halfH,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
  }
}

/** 위성 + 하이브리드(라벨) 타일을 함께 그린다 */
export function drawTileLayers(
  ctx: CanvasRenderingContext2D,
  zoom: number,
  center: { x: number; y: number },
  width: number,
  height: number,
) {
  if (!config.vworldKey) return;
  drawTileLayer(ctx, "Satellite", zoom, center, width, height);
  ctx.save();
  ctx.globalAlpha = 0.82;
  drawTileLayer(ctx, "Hybrid", zoom, center, width, height);
  ctx.restore();
}

export type ToCanvas = (x: number, z: number) => { px: number; py: number };

/** 씬 로컬 미터 → 캔버스 픽셀 변환기 (center는 project()된 화면 중심) */
export function makeToCanvas(
  center: { x: number; y: number },
  zoom: number,
  width: number,
  height: number,
): ToCanvas {
  return (x, z) => {
    const point = localMetersToLonLat(x, z, config.initialLon, config.initialLat);
    const projected = project(point.lon, point.lat, zoom);
    return {
      px: width / 2 + (projected.x - center.x),
      py: height / 2 + (projected.y - center.y),
    };
  };
}

/** 스테이션 존 — 시작 위치(로컬 원점) 반경 노란 원 */
export function drawStationZone(ctx: CanvasRenderingContext2D, toCanvas: ToCanvas, mpp: number) {
  const { px, py } = toCanvas(0, 0);
  const r = STATION_ZONE_RADIUS_M / mpp;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 212, 77, 0.14)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 212, 77, 0.9)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** 계획 항로 (주황 점선) */
export function drawRoute(
  ctx: CanvasRenderingContext2D,
  toCanvas: ToCanvas,
  route: PlannedRoute | null,
) {
  if (!route || route.points.length < 2) return;
  ctx.strokeStyle = "rgba(255, 190, 92, 0.95)";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.setLineDash([6, 5]);
  ctx.beginPath();
  route.points.forEach((p, i) => {
    const { px, py } = toCanvas(p.x, p.z);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
  ctx.stroke();
  ctx.setLineDash([]);
}

/** 웨이포인트 핀 (번호 원). highlightIdx는 드래그 중인 핀 강조 */
export function drawWaypoints(
  ctx: CanvasRenderingContext2D,
  toCanvas: ToCanvas,
  waypoints: LocalPoint[],
  reachedCount: number,
  pinRadius = 7.5,
  highlightIdx = -1,
) {
  waypoints.forEach((p, i) => {
    const { px, py } = toCanvas(p.x, p.z);
    const reached = i < reachedCount;
    const highlighted = i === highlightIdx;
    ctx.beginPath();
    ctx.arc(px, py, highlighted ? pinRadius + 2.5 : pinRadius, 0, Math.PI * 2);
    ctx.fillStyle = reached
      ? "rgba(140, 155, 168, 0.75)"
      : highlighted
        ? "rgba(255, 214, 120, 1)"
        : "rgba(255, 170, 60, 0.95)";
    ctx.fill();
    ctx.strokeStyle = highlighted ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = highlighted ? 2 : 1.5;
    ctx.stroke();
    ctx.fillStyle = "#0b1520";
    ctx.font = `700 ${Math.round(pinRadius * 1.2)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), px, py + 0.5);
    ctx.textBaseline = "alphabetic";
  });
}

/** 선박 삼각형 (침로 방향) */
export function drawBoat(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  headingDeg: number,
  size = 8,
) {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate((headingDeg * Math.PI) / 180);
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.62, size * 0.85);
  ctx.lineTo(-size * 0.62, size * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
