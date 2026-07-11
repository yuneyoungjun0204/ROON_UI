// HUD — 항법 정보 표시와 타각/스로틀 수동 조작.
// 키보드: ←/→ 타각, ↑/↓ 스로틀, Space 타 중앙.

import { useEffect } from "react";
import {
  Navigation,
  Gauge,
  Wifi,
  WifiOff,
  Loader2,
  TerminalSquare,
  Video,
  Anchor,
  Bot,
  Gamepad2,
} from "lucide-react";
import { useSimStore } from "../store";
import { MAX_RUDDER_DEG } from "../sim/usvSim";
import { config, STATION_ZONE_RADIUS_M } from "../config";
import { controls, resetControls } from "../sim/controls";
import { Minimap } from "./SatelliteMinimap";

const MS_TO_KN = 1.943844;

function StatusBadge() {
  const status = useSimStore((s) => s.mqttStatus);
  const label =
    status === "connected" ? "MQTT 연결됨" : status === "connecting" ? "연결 중" : "연결 끊김";
  const Icon = status === "connected" ? Wifi : status === "connecting" ? Loader2 : WifiOff;
  return (
    <div className={`badge badge-${status}`}>
      <Icon size={14} className={status === "connecting" ? "spin" : undefined} />
      <span>{label}</span>
    </div>
  );
}

export function Hud() {
  const usv = useSimStore((s) => s.usv);
  const lastCommand = useSimStore((s) => s.lastCommand);
  const setRudderCmd = useSimStore((s) => s.setRudderCmd);
  const setThrottle = useSimStore((s) => s.setThrottle);
  const returnToStation = useSimStore((s) => s.returnToStation);
  const autopilot = useSimStore((s) => s.autopilot);
  const returningToStation = useSimStore((s) => s.returningToStation);

  useEffect(() => {
    // 키를 누르는 "동안" 지령을 램프한다 (실제 반영은 시뮬 루프에서 dt 기반으로).
    const setHeld = (e: KeyboardEvent, down: boolean) => {
      const key = e.key.toLowerCase();
      if (key === "a" || e.key === "ArrowLeft") controls.left = down;
      else if (key === "d" || e.key === "ArrowRight") controls.right = down;
      else if (key === "w" || e.key === "ArrowUp") controls.throttleUp = down;
      else if (key === "s" || e.key === "ArrowDown") controls.throttleDown = down;
      else if (e.key === " ") {
        // Space = 스로틀 0 (정지 지령)
        if (down) useSimStore.getState().setThrottle(0);
      } else return;
      e.preventDefault();
    };
    const onDown = (e: KeyboardEvent) => setHeld(e, true);
    const onUp = (e: KeyboardEvent) => setHeld(e, false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", resetControls);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", resetControls);
    };
  }, []);

  const sog = usv.speed * MS_TO_KN;
  // 침로를 -180°~+180° 범위로 변환 (0=북, 시계방향 양수)
  const signedHeading = ((usv.heading + 180) % 360) - 180;
  // 스테이션 존(원점 반경) 안이면 복귀 버튼 비활성
  const inStationZone = Math.hypot(usv.x, usv.z) <= STATION_ZONE_RADIUS_M;

  return (
    <div className="hud">
      {/* 운항 모드 상태 — 스테이션 복귀 / 자율 운항 / 수동 조작 */}
      <div className={`panel mode-status ${autopilot ? "mode-auto" : "mode-manual"}`}>
        <span className="mode-dot" />
        {autopilot ? (
          returningToStation ? (
            <Anchor size={15} />
          ) : (
            <Bot size={15} />
          )
        ) : (
          <Gamepad2 size={15} />
        )}
        <span>
          {autopilot
            ? returningToStation
              ? "스테이션 복귀 중"
              : "자율 운항 중"
            : "수동 조작 중"}
        </span>
      </div>

      <div className="panel readouts">
        <div className="readout">
          <Navigation size={15} style={{ transform: `rotate(${usv.heading}deg)` }} />
          <div>
            <span className="label">Heading</span>
            <span className="value">
              {signedHeading > 0 ? "+" : ""}
              {signedHeading.toFixed(1)}°
            </span>
          </div>
        </div>
        <div className="readout">
          <Gauge size={15} />
          <div>
            <span className="label">Speed</span>
            <span className="value">{sog.toFixed(1)} knot</span>
          </div>
        </div>
        <div className="readout wide">
          <div>
            <span className="label">GPS</span>
            <span className="value small">
              {usv.lat.toFixed(5)}, {usv.lon.toFixed(5)}
            </span>
          </div>
        </div>
      </div>

      <div className="panel camera-card">
        <div className="camera-head">
          <Video size={13} />
          <span className="label">카메라</span>
          <span className="camera-live">
            <span className="camera-live-dot" />
            LIVE
          </span>
        </div>
        {/* 실제 영상은 3D 캔버스가 이 영역 위치에 시저 렌더링한다 — 배경 투명 유지 */}
        <div id="fpv-view" className="camera-view" />
      </div>

      <div className="panel top-right">
        <StatusBadge />
        <div className="topic">{`devices/${config.deviceToken}/telemetry`}</div>
        {lastCommand && (
          <div className="last-cmd">
            <TerminalSquare size={13} />
            <span>{lastCommand}</span>
          </div>
        )}
      </div>

      <div className="panel controls">
        <button
          className="station-btn"
          onClick={returnToStation}
          disabled={inStationZone}
          title={inStationZone ? "이미 스테이션 존 안에 있습니다" : undefined}
        >
          <Anchor size={13} />
          {inStationZone ? "스테이션 존 내 위치" : "스테이션 복귀"}
          {autopilot && !inStationZone && <span className="station-btn-note">자동 항해 중</span>}
        </button>
        <div className="control">
          <div className="control-head">
            <span className="label">RUDDER</span>
            <span className="value">
              {usv.rudder < -0.05 ? (
                <span className="dir dir-port">PORT</span>
              ) : usv.rudder > 0.05 ? (
                <span className="dir dir-stbd">STBD</span>
              ) : null}
              {Math.abs(usv.rudder).toFixed(0)}°
            </span>
          </div>
          <div className="slider-wrap">
            {/* 타 중앙(0°) 눈금 */}
            <div className="tick" style={{ left: "50%" }} />
            <input
              type="range"
              min={-MAX_RUDDER_DEG}
              max={MAX_RUDDER_DEG}
              step={1}
              value={usv.rudderCmd}
              onChange={(e) => setRudderCmd(Number(e.target.value))}
            />
          </div>
          <div className="control-foot">
            <button className="center-btn" onClick={() => setRudderCmd(0)}>
              타 중앙
            </button>
            <span className="hint">←/→ 또는 A/D</span>
          </div>
        </div>
        <div className="control">
          <div className="control-head">
            <span className="label">THROTTLE</span>
            <span className="value">{usv.throttle.toFixed(0)}%</span>
          </div>
          <div className="slider-wrap">
            {/* 스로틀 0% 눈금 (범위 -25~100 → 20% 지점) */}
            <div className="tick" style={{ left: "20%" }} />
            <input
              type="range"
              min={-25}
              max={100}
              step={5}
              value={usv.throttle}
              onChange={(e) => setThrottle(Number(e.target.value))}
            />
          </div>
          <div className="control-foot">
            <button className="center-btn" onClick={() => setThrottle(0)}>
              스로틀 0 (Space)
            </button>
            <span className="hint">↑/↓ 또는 W/S · 떼면 유지</span>
          </div>
        </div>
      </div>

      <Minimap />
    </div>
  );
}
