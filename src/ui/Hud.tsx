// HUD — 항법 정보 표시와 조작 콘솔.
// 키보드: ←/→(A/D) 조향, ↑/↓(W/S) 스로틀, Space 스로틀 0, R 홀드 초기화.
// 하단 콘솔: 나침반 · 속도계 · 배터리 · 추력 | 웨이포인트 · 스테이션 복귀 · 비상정지.

import { useEffect, useState } from "react";
import {
  Wifi,
  WifiOff,
  Loader2,
  TerminalSquare,
  Video,
  Anchor,
  Bot,
  Gamepad2,
  OctagonX,
  RotateCcw,
  BatteryLow,
  MapPin,
  Cctv,
} from "lucide-react";
import { useSimStore } from "../store";
import { config, STATION_ZONE_RADIUS_M } from "../config";
import { controls, resetControls } from "../sim/controls";
import { Minimap } from "./SatelliteMinimap";
import { WaypointPlanner } from "./WaypointPlanner";
import { CompassGauge, SpeedGauge, BatteryGauge, ThrustBars } from "./gauges";

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

/** 운항 모드 표시 내용 — 플로팅 상태 배지가 사용 */
function ModeIndicator({ prefix }: { prefix?: string }) {
  const autopilot = useSimStore((s) => s.autopilot);
  const returning = useSimStore((s) => s.returningToStation);
  const Icon = autopilot ? (returning ? Anchor : Bot) : Gamepad2;
  const label = autopilot
    ? returning
      ? "스테이션 복귀 중"
      : "자율 운항 중"
    : "수동 조작 중";
  return (
    <>
      <span className="mode-dot" />
      <Icon size={15} />
      <span>
        {prefix}
        {label}
      </span>
    </>
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

export function Hud() {
  const usv = useSimStore((s) => s.usv);
  const lastCommand = useSimStore((s) => s.lastCommand);
  const returnToStation = useSimStore((s) => s.returnToStation);
  const emergencyStop = useSimStore((s) => s.emergencyStop);
  const autopilot = useSimStore((s) => s.autopilot);
  const [plannerOpen, setPlannerOpen] = useState(false);

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

  // 스테이션 존(원점 반경) 안이면 복귀 버튼 비활성
  const inStationZone = Math.hypot(usv.x, usv.z) <= STATION_ZONE_RADIUS_M;

  return (
    <div className="hud">
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

      {/* 스테이션 존 고정 CCTV — 선박과 무관하게 항상 같은 곳을 비춘다 */}
      <div className="panel camera-card cctv-card">
        <div className="camera-head">
          <Cctv size={13} />
          <span className="label">스테이션 CCTV</span>
          <span className="camera-live">
            <span className="camera-live-dot" />
            LIVE
          </span>
        </div>
        <div id="cctv-view" className="camera-view cctv-view" />
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

      {/* 하단 콘솔 — 게이지 + 액션 버튼, 위에 플로팅 상태 배지 */}
      <div className="bottom-console">
        <div className={`panel floating-status ${autopilot ? "mode-auto" : "mode-manual"}`}>
          <ModeIndicator prefix="현재 상태: " />
        </div>
        <div className="panel console-card">
          <CompassGauge />
          <SpeedGauge />
          <BatteryGauge />
          <ThrustBars />
          <div className="console-divider" />
          <button className="console-btn" onClick={() => setPlannerOpen(true)}>
            <MapPin size={22} />
            <span>웨이포인트</span>
          </button>
          <button
            className="console-btn"
            onClick={returnToStation}
            disabled={inStationZone}
            title={inStationZone ? "이미 스테이션 존 안에 있습니다" : undefined}
          >
            <Anchor size={22} />
            <span>{inStationZone ? "존 내 위치" : "스테이션 복귀"}</span>
          </button>
          <button
            className="console-btn estop"
            onClick={emergencyStop}
            title="쓰러스터 즉시 차단 · 자율 운항/스테이션 복귀 취소"
          >
            <OctagonX size={22} />
            <span>비상정지</span>
          </button>
        </div>
      </div>

      <CenterOverlay />

      {plannerOpen && <WaypointPlanner onClose={() => setPlannerOpen(false)} />}

      <Minimap />
    </div>
  );
}
