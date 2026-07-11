import { useEffect, useRef, useState } from "react";
import { Plus, Minus, Play, Square, Trash2, Undo2 } from "lucide-react";
import { config, STATION_ZONE_RADIUS_M } from "../config";
import { localMetersToLonLat, lonLatToLocalMeters } from "../geo/webMercator";
import { useSimStore } from "../store";

const CSS_SIZE = 285;
const TILE_SIZE = 256;
const ZOOMS = [18, 17, 16, 15];
const tileImages = new Map<string, HTMLImageElement>();

function project(lon: number, lat: number, zoom: number) {
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
function unproject(x: number, y: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI * (1 - (2 * y) / scale);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return { lon, lat };
}

function metersPerPixel(lat: number, zoom: number) {
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
  size: number,
) {
  const half = size / 2;
  const minTileX = Math.floor((center.x - half) / TILE_SIZE);
  const maxTileX = Math.floor((center.x + half) / TILE_SIZE);
  const minTileY = Math.floor((center.y - half) / TILE_SIZE);
  const maxTileY = Math.floor((center.y + half) / TILE_SIZE);

  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const image = getTileImage(vworldTileUrl(layer, zoom, tileX, tileY));
      if (!image.complete || image.naturalWidth === 0) continue;
      ctx.drawImage(
        image,
        tileX * TILE_SIZE - center.x + half,
        tileY * TILE_SIZE - center.y + half,
        TILE_SIZE,
        TILE_SIZE,
      );
    }
  }
}

function pickScaleBar(metersPerPx: number) {
  const targetMeters = 76 * metersPerPx;
  const candidates = [10, 20, 50, 100, 200, 500, 1000, 2000];
  return candidates.reduce((best, next) =>
    Math.abs(next - targetMeters) < Math.abs(best - targetMeters) ? next : best,
  );
}

export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomIdx, setZoomIdx] = useState(1);
  const waypoints = useSimStore((s) => s.waypoints);
  const reachedCount = useSimStore((s) => s.reachedCount);
  const autopilot = useSimStore((s) => s.autopilot);
  const addWaypoint = useSimStore((s) => s.addWaypoint);
  const undoWaypoint = useSimStore((s) => s.undoWaypoint);
  const clearWaypoints = useSimStore((s) => s.clearWaypoints);
  const setAutopilot = useSimStore((s) => s.setAutopilot);
  const remaining = waypoints.length - reachedCount;

  /** 캔버스 클릭 위치 → 씬 로컬 미터 좌표 */
  const clickToLocal = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - CSS_SIZE / 2;
    const dy = e.clientY - rect.top - CSS_SIZE / 2;
    const { usv } = useSimStore.getState();
    const center = project(usv.lon, usv.lat, ZOOMS[zoomIdx]);
    const { lon, lat } = unproject(center.x + dx, center.y + dy, ZOOMS[zoomIdx]);
    return lonLatToLocalMeters(lon, lat, config.initialLon, config.initialLat);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CSS_SIZE * dpr;
    canvas.height = CSS_SIZE * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const zoom = ZOOMS[zoomIdx];
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { usv } = useSimStore.getState();
      const W = CSS_SIZE;
      const half = W / 2;
      const center = project(usv.lon, usv.lat, zoom);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07111a";
      ctx.fillRect(0, 0, W, W);

      if (config.vworldKey) {
        drawTileLayer(ctx, "Satellite", zoom, center, W);
        ctx.save();
        ctx.globalAlpha = 0.82;
        drawTileLayer(ctx, "Hybrid", zoom, center, W);
        ctx.restore();
      }

      const gradient = ctx.createRadialGradient(half, half, W * 0.18, half, half, W * 0.78);
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.38)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, W);

      // 씬 로컬 미터 → 미니맵 캔버스 픽셀
      const toCanvas = (x: number, z: number) => {
        const point = localMetersToLonLat(x, z, config.initialLon, config.initialLat);
        const projected = project(point.lon, point.lat, zoom);
        return { px: half + (projected.x - center.x), py: half + (projected.y - center.y) };
      };
      const mpp = metersPerPixel(usv.lat, zoom);

      // 스테이션 존 — 시작 위치(로컬 원점) 반경 원
      {
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

      // 계획 항로 (점선) + 웨이포인트
      const { route, waypoints, reachedCount } = useSimStore.getState();
      if (route && route.points.length >= 2) {
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
      waypoints.forEach((p, i) => {
        const { px, py } = toCanvas(p.x, p.z);
        const reached = i < reachedCount;
        ctx.beginPath();
        ctx.arc(px, py, 7.5, 0, Math.PI * 2);
        ctx.fillStyle = reached ? "rgba(140, 155, 168, 0.75)" : "rgba(255, 170, 60, 0.95)";
        ctx.fill();
        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = "#0b1520";
        ctx.font = "700 9px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), px, py + 0.5);
        ctx.textBaseline = "alphabetic";
      });

      ctx.save();
      ctx.translate(half, half);
      ctx.rotate((usv.heading * Math.PI) / 180);
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5, 7);
      ctx.lineTo(-5, 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = "rgba(235, 246, 255, 0.92)";
      ctx.font = "600 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("N", half, 12);

      const barMeters = pickScaleBar(mpp);
      const barPx = barMeters / mpp;
      ctx.strokeStyle = "rgba(235, 246, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(10, W - 10);
      ctx.lineTo(10 + barPx, W - 10);
      ctx.stroke();
      ctx.textAlign = "left";
      ctx.fillText(
        barMeters >= 1000 ? `${barMeters / 1000} km` : `${barMeters} m`,
        10,
        W - 15,
      );
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [zoomIdx]);

  return (
    <div className="panel minimap">
      <div className="minimap-head">
        <span className="label">SAT MAP</span>
        <div className="minimap-zoom">
          <button
            onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
            disabled={zoomIdx === 0}
            aria-label="확대"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))}
            disabled={zoomIdx === ZOOMS.length - 1}
            aria-label="축소"
          >
            <Minus size={13} />
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        style={{ width: CSS_SIZE, height: CSS_SIZE, borderRadius: 8, display: "block" }}
        onClick={(e) => addWaypoint(clickToLocal(e))}
        onContextMenu={(e) => {
          e.preventDefault();
          undoWaypoint();
        }}
        title="클릭: 웨이포인트 추가 · 우클릭: 마지막 취소"
      />
      <div className="minimap-actions">
        <button
          className={autopilot ? "active" : ""}
          onClick={() => setAutopilot(!autopilot)}
          disabled={!autopilot && remaining === 0}
        >
          {autopilot ? <Square size={12} /> : <Play size={12} />}
          {autopilot ? "정지" : "출발"}
        </button>
        <button onClick={undoWaypoint} disabled={remaining === 0} aria-label="마지막 웨이포인트 취소">
          <Undo2 size={12} />
        </button>
        <button onClick={clearWaypoints} disabled={waypoints.length === 0} aria-label="경로 지우기">
          <Trash2 size={12} />
        </button>
        <span className="hint">
          {waypoints.length === 0
            ? "지도를 클릭해 웨이포인트"
            : `WP ${Math.min(reachedCount + 1, waypoints.length)}/${waypoints.length}${autopilot ? " 항해 중" : ""}`}
        </span>
      </div>
    </div>
  );
}
