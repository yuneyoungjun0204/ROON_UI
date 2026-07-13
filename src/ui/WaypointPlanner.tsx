// 웨이포인트 플래너 — 하단 콘솔의 웨이포인트 버튼으로 여는 큰 지도 창.
// 좌측 지도: 클릭으로 핀을 순서대로 추가, 기존 핀은 잡아서 드래그로 이동.
// 우측 도구: 출발/정지 · 마지막 취소 · 전체 삭제 · 스테이션 복귀 · 닫기.

import { useEffect, useRef, useState } from "react";
import { HelpCircle, MapPin, Minus, Play, Plus, Square, Trash2, Undo2, X } from "lucide-react";
import { config } from "../config";
import { lonLatToLocalMeters } from "../geo/webMercator";
import type { LocalPoint } from "../geo/webMercator";
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

const MAP_W = 1080;
const MAP_H = 680;
const PIN_HIT_RADIUS_PX = 12;

interface DragState {
  index: number;
  pos: LocalPoint;
  moved: boolean;
}

export function WaypointPlanner({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomIdx, setZoomIdx] = useState(1);
  const dragRef = useRef<DragState | null>(null);

  const waypoints = useSimStore((s) => s.waypoints);
  const reachedCount = useSimStore((s) => s.reachedCount);
  const autopilot = useSimStore((s) => s.autopilot);
  const addWaypoint = useSimStore((s) => s.addWaypoint);
  const moveWaypoint = useSimStore((s) => s.moveWaypoint);
  const undoWaypoint = useSimStore((s) => s.undoWaypoint);
  const clearWaypoints = useSimStore((s) => s.clearWaypoints);
  const setAutopilot = useSimStore((s) => s.setAutopilot);
  const remaining = waypoints.length - reachedCount;

  // ESC로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** 캔버스 픽셀 → 씬 로컬 미터 (CSS 축소 표시를 감안해 논리 좌표로 환산) */
  const canvasToLocal = (clientX: number, clientY: number): LocalPoint => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scale = MAP_W / rect.width;
    const dx = (clientX - rect.left) * scale - MAP_W / 2;
    const dy = (clientY - rect.top) * scale - MAP_H / 2;
    const { usv } = useSimStore.getState();
    const zoom = MAP_ZOOMS[zoomIdx];
    const center = project(usv.lon, usv.lat, zoom);
    const { lon, lat } = unproject(center.x + dx, center.y + dy, zoom);
    return lonLatToLocalMeters(lon, lat, config.initialLon, config.initialLat);
  };

  /** 커서 아래 핀 인덱스 (없으면 -1) */
  const hitTestPin = (clientX: number, clientY: number): number => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const scale = MAP_W / rect.width;
    const cx = (clientX - rect.left) * scale;
    const cy = (clientY - rect.top) * scale;
    const { usv, waypoints: wps } = useSimStore.getState();
    const zoom = MAP_ZOOMS[zoomIdx];
    const toCanvas = makeToCanvas(project(usv.lon, usv.lat, zoom), zoom, MAP_W, MAP_H);
    for (let i = wps.length - 1; i >= 0; i -= 1) {
      const { px, py } = toCanvas(wps[i].x, wps[i].z);
      if (Math.hypot(px - cx, py - cy) <= PIN_HIT_RADIUS_PX) return i;
    }
    return -1;
  };

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const idx = hitTestPin(e.clientX, e.clientY);
    if (idx >= 0) {
      dragRef.current = { index: idx, pos: canvasToLocal(e.clientX, e.clientY), moved: false };
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    drag.pos = canvasToLocal(e.clientX, e.clientY);
    drag.moved = true;
  };

  const onMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      if (drag.moved) moveWaypoint(drag.index, drag.pos);
      return; // 핀을 잡았다 놓은 경우 — 새 핀 추가 아님
    }
    addWaypoint(canvasToLocal(e.clientX, e.clientY));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = MAP_W * dpr;
    canvas.height = MAP_H * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const zoom = MAP_ZOOMS[zoomIdx];
    let raf = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const { usv, route, waypoints: wps, reachedCount: reached } = useSimStore.getState();
      const center = project(usv.lon, usv.lat, zoom);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#07111a";
      ctx.fillRect(0, 0, MAP_W, MAP_H);
      drawTileLayers(ctx, zoom, center, MAP_W, MAP_H);

      const toCanvas = makeToCanvas(center, zoom, MAP_W, MAP_H);
      const mpp = metersPerPixel(usv.lat, zoom);
      drawStationZone(ctx, toCanvas, mpp);
      drawRoute(ctx, toCanvas, route);

      // 드래그 중인 핀은 커서 위치에 미리보기로 그린다
      const drag = dragRef.current;
      const shown = drag ? wps.map((p, i) => (i === drag.index ? drag.pos : p)) : wps;
      drawWaypoints(ctx, toCanvas, shown, reached, 9, drag ? drag.index : -1);
      drawBoat(ctx, MAP_W / 2, MAP_H / 2, usv.heading, 9);

      // 축척 바
      const barMeters = [20, 50, 100, 200, 500, 1000][Math.min(5, Math.max(0, zoomIdx + 1))];
      const barPx = barMeters / mpp;
      ctx.strokeStyle = "rgba(235, 246, 255, 0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(12, MAP_H - 12);
      ctx.lineTo(12 + barPx, MAP_H - 12);
      ctx.stroke();
      ctx.fillStyle = "rgba(235, 246, 255, 0.92)";
      ctx.font = "600 11px sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(barMeters >= 1000 ? `${barMeters / 1000} km` : `${barMeters} m`, 12, MAP_H - 18);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [zoomIdx]);

  return (
    <div className="planner-overlay">
      <div className="panel planner">
        <div className="planner-head">
          <MapPin size={16} />
          <span className="planner-title">웨이포인트 플래너</span>
          <button className="planner-close" onClick={onClose} aria-label="닫기 (ESC)">
            <X size={16} />
          </button>
        </div>
        <div className="planner-body">
          <div className="planner-map">
            <canvas
              ref={canvasRef}
              style={{ borderRadius: 10, display: "block" }}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={() => {
                dragRef.current = null; // 캔버스 밖으로 나가면 드래그 취소
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                undoWaypoint();
              }}
            />
            {/* 도움말 — 지도 좌측 상단 ? 아이콘 (호버 시 설명) */}
            <div className="map-help">
              <button className="map-overlay-btn" aria-label="도움말">
                <HelpCircle size={17} />
              </button>
              <div className="map-help-pop">
                <p>· 지도 클릭 — 핀 추가 (순서대로)</p>
                <p>· 핀 드래그 — 위치 이동</p>
                <p>· 우클릭 — 마지막 핀 취소</p>
              </div>
            </div>
            {/* 확대/축소 — 지도 우측 상단 오버레이 */}
            <div className="map-zoom">
              <button
                className="map-overlay-btn"
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
                disabled={zoomIdx === 0}
                aria-label="확대"
              >
                <Plus size={16} />
              </button>
              <button
                className="map-overlay-btn"
                onClick={() => setZoomIdx((i) => Math.min(MAP_ZOOMS.length - 1, i + 1))}
                disabled={zoomIdx === MAP_ZOOMS.length - 1}
                aria-label="축소"
              >
                <Minus size={16} />
              </button>
            </div>
            {/* 출발/취소/삭제 — 지도 우측 하단 오버레이 */}
            <div className="map-actions">
              <button
                className={`tool-sq ${autopilot ? "active" : ""}`}
                onClick={() => setAutopilot(!autopilot)}
                disabled={!autopilot && remaining === 0}
                title={autopilot ? "정지" : "출발"}
              >
                {autopilot ? <Square size={20} /> : <Play size={20} />}
              </button>
              <button
                className="tool-sq"
                onClick={undoWaypoint}
                disabled={remaining === 0}
                title="마지막 취소"
              >
                <Undo2 size={20} />
              </button>
              <button
                className="tool-sq"
                onClick={clearWaypoints}
                disabled={waypoints.length === 0}
                title="전체 삭제"
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
