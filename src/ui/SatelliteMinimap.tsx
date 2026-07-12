import { useEffect, useRef, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { config } from "../config";
import { localMetersToLonLat } from "../geo/webMercator";
import { trail, useSimStore } from "../store";

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

      if (trail.length >= 4) {
        ctx.strokeStyle = "rgba(116, 217, 255, 0.92)";
        ctx.lineWidth = 2;
        ctx.lineJoin = "round";
        ctx.beginPath();
        for (let i = 0; i < trail.length; i += 2) {
          const point = localMetersToLonLat(
            trail[i],
            trail[i + 1],
            config.initialLon,
            config.initialLat,
          );
          const projected = project(point.lon, point.lat, zoom);
          const px = half + (projected.x - center.x);
          const py = half + (projected.y - center.y);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineTo(half, half);
        ctx.stroke();
      }

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

      const mpp = metersPerPixel(usv.lat, zoom);
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
      />
    </div>
  );
}
