// HUD — 항법 정보 표시와 타각/스로틀 수동 조작.
// 키보드: ←/→ 타각, ↑/↓ 스로틀, Space 타 중앙.

import { useEffect } from "react";
import { Navigation, Gauge, Wifi, WifiOff, Loader2, TerminalSquare } from "lucide-react";
import { useSimStore } from "../store";
import { MAX_RUDDER_DEG } from "../sim/usvSim";
import { config } from "../config";

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
    const onKey = (e: KeyboardEvent) => {
      const { usv: u, setRudderCmd: setR, setThrottle: setT } = useSimStore.getState();
      if (e.key === "ArrowLeft") setR(u.rudderCmd - 5);
      else if (e.key === "ArrowRight") setR(u.rudderCmd + 5);
      else if (e.key === "ArrowUp") setT(u.throttle + 10);
      else if (e.key === "ArrowDown") setT(u.throttle - 10);
      else if (e.key === " ") setR(0);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
              {usv.rudder < -0.05 ? "PORT " : usv.rudder > 0.05 ? "STBD " : ""}
              {Math.abs(usv.rudder).toFixed(0)}°
            </span>
          </div>
          <input
            type="range"
            min={-MAX_RUDDER_DEG}
            max={MAX_RUDDER_DEG}
            step={1}
            value={usv.rudderCmd}
            onChange={(e) => setRudderCmd(Number(e.target.value))}
          />
          <button className="center-btn" onClick={() => setRudderCmd(0)}>
            타 중앙 (Space)
          </button>
        </div>
        <div className="control">
          <div className="control-head">
            <span className="label">THROTTLE</span>
            <span className="value">{usv.throttle.toFixed(0)}%</span>
          </div>
          <input
            type="range"
            min={-25}
            max={100}
            step={5}
            value={usv.throttle}
            onChange={(e) => setThrottle(Number(e.target.value))}
          />
          <div className="hint">←/→ 타각 · ↑/↓ 스로틀</div>
        </div>
      </div>
    </div>
  );
}
