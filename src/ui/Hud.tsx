// HUD — 항법 정보 표시와 타각/스로틀 수동 조작.
// 키보드: ←/→ 타각, ↑/↓ 스로틀, Space 타 중앙.

import { useEffect } from "react";
import { Navigation, Gauge, Wifi, WifiOff, Loader2, TerminalSquare, Video } from "lucide-react";
import { useSimStore } from "../store";
import { MAX_RUDDER_DEG } from "../sim/usvSim";
import { config } from "../config";
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

  useEffect(() => {
    // 키를 누르는 "동안" 지령을 램프한다 (실제 반영은 시뮬 루프에서 dt 기반으로).
    const setHeld = (e: KeyboardEvent, down: boolean) => {
      const key = e.key.toLowerCase();
      if (key === "a" || e.key === "ArrowLeft") controls.left = down;
      else if (key === "d" || e.key === "ArrowRight") controls.right = down;
      else if (key === "w" || e.key === "ArrowUp") controls.throttleUp = down;
      else if (key === "s" || e.key === "ArrowDown") controls.throttleDown = down;
      else if (e.key === " ") {
        if (down) {
          useSimStore.getState().setRudderCmd(0);
          controls.steering = false;
        }
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

  return (
    <div className="hud">
      <div className="panel readouts">
        <div className="readout">
          <Navigation size={15} style={{ transform: `rotate(${usv.heading}deg)` }} />
          <div>
            <span className="label">HDG</span>
            <span className="value">{usv.heading.toFixed(1).padStart(5, "0")}°</span>
          </div>
        </div>
        <div className="readout">
          <Gauge size={15} />
          <div>
            <span className="label">SOG</span>
            <span className="value">{sog.toFixed(1)} kn</span>
          </div>
        </div>
        <div className="readout wide">
          <div>
            <span className="label">POSITION</span>
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
              타 중앙 (Space)
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
            <span className="hint">↑/↓ 또는 W/S · 떼면 유지</span>
          </div>
        </div>
      </div>

      <Minimap />
    </div>
  );
}
