// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 HUD
// - 시나리오 선택
// - 통계 표시
// - 아군 상태
// - 제어 버튼
// - 카메라 조작 안내
// - 버드아이 뷰 미니맵 (클러스터, 할당, 레이캐스트)
// - 지휘관 판단 패널
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef } from "react";
import { useDefenseStore } from "../defenseStore";
import { DEFENSE_CONFIG as C, FORMATION_NAMES } from "../config/defense";
import type { EnemyFormation, AllyState } from "../types/defense";
import { CommanderPanel } from "./CommanderPanel";
import "./DefenseHud.css";

/** 버드아이 뷰 미니맵 */
function BattlefieldMinimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const allies = useDefenseStore((s) => s.allies);
  const enemies = useDefenseStore((s) => s.enemies);
  const mothership = useDefenseStore((s) => s.mothership);
  const nets = useDefenseStore((s) => s.nets);

  const MAP_SIZE = 180;
  const WORLD_SIZE = C.worldSize;
  const scale = MAP_SIZE / WORLD_SIZE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      // 배경
      ctx.fillStyle = "#0a3055";
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      // 그리드
      ctx.strokeStyle = "rgba(100, 200, 255, 0.1)";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= 4; i++) {
        const pos = (i / 4) * MAP_SIZE;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, MAP_SIZE);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(MAP_SIZE, pos);
        ctx.stroke();
      }

      // 그물 (녹색 선)
      ctx.strokeStyle = "#00ff00";
      ctx.lineWidth = 2;
      for (const net of nets) {
        if (!net.installed) continue;
        ctx.beginPath();
        ctx.moveTo(net.startX * scale, net.startZ * scale);
        ctx.lineTo(net.endX * scale, net.endZ * scale);
        ctx.stroke();
      }

      // 모선 (흰색 사각형 + 빨간 원)
      const msX = mothership.x * scale;
      const msZ = mothership.z * scale;

      // breach 반경
      ctx.strokeStyle = "rgba(255, 0, 0, 0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(msX, msZ, mothership.radius * scale, 0, Math.PI * 2);
      ctx.stroke();

      // 모선 본체
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(msX - 4, msZ - 10, 8, 20);

      // 적군 (빨간 삼각형)
      // heading 0 = 북쪽(위), 90 = 동쪽(오른쪽), 시계방향
      for (const enemy of enemies) {
        if (!enemy.alive) continue;
        const ex = enemy.x * scale;
        const ez = enemy.z * scale;
        // Canvas에서 양수 회전 = 시계방향, heading도 시계방향
        const angle = (enemy.heading * Math.PI) / 180;

        ctx.save();
        ctx.translate(ex, ez);
        ctx.rotate(angle);
        ctx.fillStyle = "#ff4444";
        ctx.beginPath();
        ctx.moveTo(0, -5);   // 선수 (위쪽)
        ctx.lineTo(-3, 4);   // 좌현
        ctx.lineTo(3, 4);    // 우현
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      // 아군 (파란 삼각형)
      for (const ally of allies) {
        if (!ally.alive) continue;
        const ax = ally.x * scale;
        const az = ally.z * scale;
        const angle = (ally.heading * Math.PI) / 180;

        ctx.save();
        ctx.translate(ax, az);
        ctx.rotate(angle);
        ctx.fillStyle = "#4488ff";
        ctx.beginPath();
        ctx.moveTo(0, -6);   // 선수 (위쪽)
        ctx.lineTo(-4, 5);   // 좌현
        ctx.lineTo(4, 5);    // 우현
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      requestAnimationFrame(draw);
    };

    const animId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animId);
  }, [allies, enemies, mothership, nets, scale]);

  return (
    <div className="minimap">
      <div className="minimap-title">전장 현황</div>
      <canvas
        ref={canvasRef}
        width={MAP_SIZE}
        height={MAP_SIZE}
        className="minimap-canvas"
      />
      <div className="minimap-legend">
        <span className="legend-ally">▲ 아군</span>
        <span className="legend-enemy">▲ 적군</span>
        <span className="legend-mother">■ 모선</span>
      </div>
    </div>
  );
}

/** 카메라 조작 안내 */
function CameraHelp() {
  return (
    <div className="camera-help">
      <div className="help-title">카메라 조작</div>
      <div className="help-row"><span className="key">T / ESC</span> 전술 뷰</div>
      <div className="help-row"><span className="key">u1-u3</span> 아군 추적</div>
      <div className="help-row"><span className="key">a1-a10</span> 적군 추적</div>
    </div>
  );
}

export function DefenseHud() {
  const stats = useDefenseStore((s) => s.stats);
  const step = useDefenseStore((s) => s.step);
  const formation = useDefenseStore((s) => s.formation);
  const allies = useDefenseStore((s) => s.allies);
  const enemies = useDefenseStore((s) => s.enemies);
  const running = useDefenseStore((s) => s.running);
  const done = useDefenseStore((s) => s.done);
  const selectedAlly = useDefenseStore((s) => s.selectedAlly);

  const toggleRunning = useDefenseStore((s) => s.toggleRunning);
  const reset = useDefenseStore((s) => s.reset);
  const setFormation = useDefenseStore((s) => s.setFormation);
  const selectAlly = useDefenseStore((s) => s.selectAlly);
  const startNetDeploy = useDefenseStore((s) => s.startNetDeploy);
  const stopNetDeploy = useDefenseStore((s) => s.stopNetDeploy);

  const aliveEnemies = enemies.filter((e) => e.alive).length;
  const aliveAllies = allies.filter((a) => a.alive).length;
  const elapsedSec = (step / 60).toFixed(1);

  return (
    <div className="defense-hud">
      {/* 상단: 시나리오 + 시간 */}
      <div className="hud-top">
        <div className="scenario-info">
          <span className="label">시나리오:</span>
          <span className="value">{FORMATION_NAMES[formation]}</span>
        </div>
        <div className="time-info">
          <span className="label">경과:</span>
          <span className="value">{elapsedSec}s</span>
          <span className="step">(step {step})</span>
        </div>
      </div>

      {/* 전황 통계 */}
      <div className="stats-panel">
        <div className="stat good">
          <span className="stat-label">포획</span>
          <span className="stat-value">{stats.captures}</span>
        </div>
        <div className="stat bad">
          <span className="stat-label">돌파</span>
          <span className="stat-value">{stats.breaches}</span>
        </div>
        <div className="stat">
          <span className="stat-label">적 잔존</span>
          <span className="stat-value">{aliveEnemies}/10</span>
        </div>
        <div className="stat">
          <span className="stat-label">아군</span>
          <span className="stat-value">{aliveAllies}/3</span>
        </div>
        <div className="stat">
          <span className="stat-label">그물 사용</span>
          <span className="stat-value">{stats.netsUsed}</span>
        </div>
      </div>

      {/* 아군 상태 패널 */}
      <div className="allies-panel">
        <div className="panel-title">아군 함대</div>
        {allies.map((ally) => (
          <AllyStatusCard
            key={ally.id}
            ally={ally}
            selected={ally.id === selectedAlly}
            onSelect={() => selectAlly(ally.id)}
            onStartNet={() => startNetDeploy(ally.id)}
            onStopNet={() => stopNetDeploy(ally.id)}
          />
        ))}
      </div>

      {/* 지휘관 판단 패널 (MobRobGPT 스타일) */}
      <CommanderPanel />

      {/* 버드아이 뷰 미니맵 */}
      <BattlefieldMinimap />

      {/* 카메라 도움말 */}
      <CameraHelp />

      {/* 시나리오 선택 */}
      <div className="formation-panel">
        <div className="panel-title">적 포메이션</div>
        <div className="formation-buttons">
          {(["concentrated", "diversionary", "wave", "random"] as EnemyFormation[]).map(
            (f) => (
              <button
                key={f}
                className={`formation-btn ${formation === f ? "active" : ""}`}
                onClick={() => {
                  setFormation(f);
                  reset(f);
                }}
              >
                {FORMATION_NAMES[f]}
              </button>
            )
          )}
        </div>
      </div>

      {/* 제어 버튼 */}
      <div className="control-panel">
        <button
          className={`control-btn ${running ? "pause" : "play"}`}
          onClick={toggleRunning}
          disabled={done}
        >
          {running ? "⏸ 일시정지" : "▶ 시작"}
        </button>
        <button className="control-btn reset" onClick={() => reset()}>
          🔄 리셋
        </button>
      </div>

      {/* 종료 메시지 */}
      {done && (
        <div className="game-over">
          <div className="result">
            {stats.breaches === 0 ? "🏆 방어 성공!" : "💥 방어 실패"}
          </div>
          <div className="summary">
            포획: {stats.captures} | 돌파: {stats.breaches} | 잔존: {aliveEnemies}
          </div>
        </div>
      )}
    </div>
  );
}

/** 아군 상태 카드 */
function AllyStatusCard({
  ally,
  selected,
  onSelect,
  onStartNet,
  onStopNet,
}: {
  ally: AllyState;
  selected: boolean;
  onSelect: () => void;
  onStartNet: () => void;
  onStopNet: () => void;
}) {
  const statusColor = !ally.alive
    ? "#666"
    : ally.painting
    ? "#00aaff"
    : selected
    ? "#44ff44"
    : "#228822";

  return (
    <div
      className={`ally-card ${selected ? "selected" : ""} ${!ally.alive ? "dead" : ""}`}
      onClick={onSelect}
      style={{ borderLeftColor: statusColor }}
    >
      <div className="ally-header">
        <span className="ally-name">아군 {ally.id + 1}</span>
        <span className="ally-status">
          {!ally.alive ? "격침" : ally.painting ? "전개중" : "대기"}
        </span>
      </div>
      <div className="ally-info">
        <div className="info-row">
          <span>그물:</span>
          <span className="nets">
            {Array.from({ length: C.netsPerShip }).map((_, i) => (
              <span
                key={i}
                className={`net-indicator ${i < ally.netsRemaining ? "available" : "used"}`}
              />
            ))}
          </span>
        </div>
        <div className="info-row">
          <span>속력:</span>
          <span>{ally.speed.toFixed(1)} m/s</span>
        </div>
      </div>
      {ally.alive && selected && (
        <div className="ally-controls">
          {ally.painting ? (
            <button className="net-btn stop" onClick={(e) => { e.stopPropagation(); onStopNet(); }}>
              그물 중단
            </button>
          ) : (
            <button
              className="net-btn deploy"
              onClick={(e) => { e.stopPropagation(); onStartNet(); }}
              disabled={ally.netsRemaining === 0}
            >
              그물 전개
            </button>
          )}
        </div>
      )}
    </div>
  );
}
