// 위성 미니맵 — 선박 중심 추적, 클릭으로 웨이포인트 추가.
// 투영·타일·항법 오버레이는 mapShared와 웨이포인트 플래너가 공유한다.

import { useEffect, useRef, useState } from "react";
import { Plus, Minus } from "lucide-react";
import { config } from "../config";
import { lonLatToLocalMeters } from "../geo/webMercator";
import { useSimStore } from "../store";
import {
  MAP_ZOOMS,
  drawBoat,
  drawRoute,
  drawStationZone,
  drawTileLayers,
  drawWaypoints,
  makeToCanvas,
  metersPerPixel,
  project,
  unproject,
} from "./mapShared";

const CSS_SIZE = 285;

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
  const addWaypoint = useSimStore((s) => s.addWaypoint);
  const undoWaypoint = useSimStore((s) => s.undoWaypoint);
  const gps = useSimStore((s) => `${s.usv.lat.toFixed(5)}, ${s.usv.lon.toFixed(5)}`);

  /** 캔버스 클릭 위치 → 씬 로컬 미터 좌표 */
  const clickToLocal = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - CSS_SIZE / 2;
    const dy = e.clientY - rect.top - CSS_SIZE / 2;
    const { usv } = useSimStore.getState();
    const zoom = MAP_ZOOMS[zoomIdx];
    const center = project(usv.lon, usv.lat, zoom);
    const { lon, lat } = unproject(center.x + dx, center.y + dy, zoom);
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

    const zoom = MAP_ZOOMS[zoomIdx];
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { usv, route, waypoints, reachedCount } = useSimStore.getState();
      const W = CSS_SIZE;
      const half = W / 2;
      const center = project(usv.lon, usv.lat, zoom);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07111a";
      ctx.fillRect(0, 0, W, W);

      drawTileLayers(ctx, zoom, center, W, W);

      const gradient = ctx.createRadialGradient(half, half, W * 0.18, half, half, W * 0.78);
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
      gradient.addColorStop(1, "rgba(0, 0, 0, 0.38)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, W, W);

      const toCanvas = makeToCanvas(center, zoom, W, W);
      const mpp = metersPerPixel(usv.lat, zoom);

      drawStationZone(ctx, toCanvas, mpp);
      drawRoute(ctx, toCanvas, route);
      drawWaypoints(ctx, toCanvas, waypoints, reachedCount);
      drawBoat(ctx, half, half, usv.heading);

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
            onClick={() => setZoomIdx((i) => Math.min(MAP_ZOOMS.length - 1, i + 1))}
            disabled={zoomIdx === MAP_ZOOMS.length - 1}
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
      <div className="minimap-gps">
        <span className="label">GPS</span>
        <span className="minimap-gps-value">{gps}</span>
      </div>
      <div className="minimap-actions">
        <span className="hint">클릭: 웨이포인트 · 우클릭: 취소 · 상세 편집은 웨이포인트 버튼</span>
      </div>
    </div>
  );
}
