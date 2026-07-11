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
  Zap,
  BatteryFull,
  BatteryMedium,
  BatteryLow,
  OctagonX,
  RotateCcw,
} from "lucide-react";
import { useSimStore } from "../store";
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

/** 화면 중앙 오버레이 — R키 홀드 초기화 게이지, 배터리 방전 견인 안내 */
function CenterOverlay() {
  const resetProgress = useSimStore((s) => s.resetProgress);
  const battery = useSimStore((s) => s.battery);

  if (resetProgress > 0) {
    return (
      <div className="panel center-overlay">
        <div className="overlay-title">
          <RotateCcw size={15} />
          <span>초기화 중…</span>
        </div>
        <div className="reset-gauge">
          <div className="reset-gauge-fill" style={{ width: `${Math.min(100, resetProgress * 100)}%` }} />
        </div>
        <span className="overlay-sub">{Math.floor(Math.min(100, resetProgress * 100))}% — R키를 계속 누르고 계세요</span>
      </div>
    );
  }
  if (battery <= 0) {
    return (
      <div className="panel center-overlay overlay-danger">
        <div className="overlay-title">
          <BatteryLow size={16} />
          <span>배터리 방전 — 조작 불능</span>
        </div>
        <span className="overlay-sub">R키를 2초 동안 눌러 견인하세요.</span>
      </div>
    );
  }
  return null;
}

/** 배터리 표시 — 잔량 바 + %. 50% 초과 초록 / 15~50% 노랑 / 15% 이하 빨강, 충전 중이면 ⚡ */
function BatteryStatus() {
  const battery = useSimStore((s) => s.battery);
  const charging = useSimStore((s) => s.charging);
  const level = battery > 50 ? "high" : battery > 15 ? "mid" : "low";
  const Icon = charging ? Zap : battery > 50 ? BatteryFull : battery > 15 ? BatteryMedium : BatteryLow;
  return (
    <div className={`battery battery-${level}`}>
      <Icon size={15} className={charging ? "battery-charge-icon" : undefined} />
      <div className="battery-shell">
        <div className="battery-fill" style={{ width: `${battery}%` }} />
      </div>
      <span className="battery-pct">{battery.toFixed(0)}%</span>
      {charging && <span className="battery-charging-label">충전 중</span>}
    </div>
  );
}

/** 좌/우 쓰러스터 출력 게이지 — 중앙 기준으로 정방향(초록)/역방향(빨강) 채움 */
function ThrusterBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.abs(value)); // 0~100
  const forward = value >= 0;
  return (
    <div className="thruster-row">
      <span className="thruster-label">{label}</span>
      <div className="thruster-bar">
        <div className="thruster-center" />
        <div
          className={`thruster-fill ${forward ? "fwd" : "rev"}`}
          style={
            forward
              ? { left: "50%", width: `${pct / 2}%` }
              : { right: "50%", width: `${pct / 2}%` }
          }
        />
      </div>
      <span className="thruster-value">{value.toFixed(0)}%</span>
    </div>
  );
}

export function Hud() {
  const usv = useSimStore((s) => s.usv);
  const lastCommand = useSimStore((s) => s.lastCommand);
  const setSteer = useSimStore((s) => s.setSteer);
  const setThrottle = useSimStore((s) => s.setThrottle);
  const returnToStation = useSimStore((s) => s.returnToStation);
  const emergencyStop = useSimStore((s) => s.emergencyStop);
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
      else if (key === "r") {
        // R 홀드 = 전체 초기화 (1초 후 게이지 시작, 1초 만에 완충)
        controls.resetHeld = down;
      } else if (e.key === " ") {
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
        <BatteryStatus />
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
        <div className="controls-top">
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
          <button
            className="estop-btn"
            onClick={emergencyStop}
            title="쓰러스터 즉시 차단 · 자율 운항/스테이션 복귀 취소"
          >
            <OctagonX size={13} />
            비상정지
          </button>
        </div>
        <div className="control">
          <div className="control-head">
            <span className="label">STEER</span>
            <span className="value">
              {usv.steer < -0.5 ? (
                <span className="dir dir-port">PORT</span>
              ) : usv.steer > 0.5 ? (
                <span className="dir dir-stbd">STBD</span>
              ) : null}
              {Math.abs(usv.steer).toFixed(0)}%
            </span>
          </div>
          <div className="slider-wrap">
            {/* 조향 중앙(0) 눈금 */}
            <div className="tick" style={{ left: "50%" }} />
            <input
              type="range"
              min={-100}
              max={100}
              step={1}
              value={usv.steer}
              onChange={(e) => setSteer(Number(e.target.value))}
            />
          </div>
          <div className="control-foot">
            <button className="center-btn" onClick={() => setSteer(0)}>
              조향 중앙
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
            {/* 스로틀 0% 눈금 (범위 -100~100 → 중앙) */}
            <div className="tick" style={{ left: "50%" }} />
            <input
              type="range"
              min={-100}
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
        <div className="control thrusters">
          <div className="control-head">
            <span className="label">THRUSTERS</span>
          </div>
          <ThrusterBar label="L" value={usv.thrustPort} />
          <ThrusterBar label="R" value={usv.thrustStbd} />
          <span className="hint">좌/우 차동 추진 · 후미 장착</span>
        </div>
      </div>

      <CenterOverlay />

      <Minimap />
    </div>
  );
}
