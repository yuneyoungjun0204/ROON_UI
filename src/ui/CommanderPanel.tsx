// ─────────────────────────────────────────────────────────────────────────
// 지휘관 판단 패널 (Commander Rationale Panel)
// MobRobGPT의 run_commander_ui.py --cell 스타일
// - 모델명, 상태
// - 명령(프롬프트)
// - 투입 배분 (아군→클러스터)
// - 판단 근거 (rationale)
// ─────────────────────────────────────────────────────────────────────────

import { useState, useRef } from "react";
import { useDefenseStore } from "../defenseStore";
import "./CommanderPanel.css";

/** 클러스터 색상 팔레트 (MobRobGPT 스타일) */
const CLUSTER_COLORS = ["#FF8A65", "#BA68C8", "#4FC3F7", "#FFD54F", "#81C784", "#F06292"];

export function CommanderPanel() {
  // Store에서 지휘관 상태 읽기 (MQTT로 수신됨)
  const commanderState = useDefenseStore((s) => s.commanderState);
  const setCommanderState = useDefenseStore((s) => s.setCommanderState);

  const [inputCommand, setInputCommand] = useState("모든 적군 포획");
  const inputRef = useRef<HTMLInputElement>(null);

  // 클러스터 정보 (store에서 받은 것 사용)
  const clusterInfos = commanderState.clusters.map((c) => ({
    id: c.id,
    centroidX: c.centroidX,
    centroidZ: c.centroidZ,
    enemyCount: c.enemyIds?.length || 0,
    threat: c.threat,
    bearing: (c as { bearing?: number }).bearing || 0,
    color: (c as { color?: string }).color || CLUSTER_COLORS[c.id % CLUSTER_COLORS.length],
  }));

  // 명령 제출
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setCommanderState({
      command: inputCommand,
      status: "calling",
    });

    // 시뮬레이션: 1초 후 완료 (실제로는 ROS2/MQTT에서 처리)
    setTimeout(() => {
      setCommanderState({
        status: "ready",
        rationale: `명령 "${inputCommand}" 처리 완료. 클러스터 ${clusterInfos.length}개 탐지.`,
      });
    }, 1000);
  };

  return (
    <div className="commander-panel">
      <div className="commander-header">
        <div className="model-info">
          <span className="label">지휘관:</span>
          <span className="model-name">{commanderState.model}</span>
        </div>
        <div className={`status ${commanderState.status}`}>
          {commanderState.status === "ready" && "● 대기"}
          {commanderState.status === "calling" && "◌ 호출중..."}
          {commanderState.status === "error" && "✕ 오류"}
        </div>
      </div>

      {/* 명령 입력 */}
      <div className="command-section">
        <div className="section-title">명령 (프롬프트)</div>
        <form onSubmit={handleSubmit} className="command-form">
          <input
            ref={inputRef}
            type="text"
            value={inputCommand}
            onChange={(e) => setInputCommand(e.target.value)}
            placeholder="명령을 입력하세요..."
            className="command-input"
          />
          <button type="submit" className="command-submit">전송</button>
        </form>
        <div className="current-command">{commanderState.command}</div>
      </div>

      {/* 클러스터 현황 */}
      <div className="clusters-section">
        <div className="section-title">적 클러스터 탐지</div>
        <div className="clusters-list">
          {clusterInfos.length === 0 ? (
            <div className="no-clusters">클러스터 없음</div>
          ) : (
            clusterInfos.map((c) => (
              <div key={c.id} className="cluster-item" style={{ borderLeftColor: c.color }}>
                <span className="cluster-id">C{c.id}</span>
                <span className="cluster-count">×{c.enemyCount}</span>
                <span className="cluster-bearing">{c.bearing.toFixed(0)}°</span>
                <span className="cluster-threat">위협: {(c.threat * 100).toFixed(0)}%</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 투입 배분 */}
      <div className="assignments-section">
        <div className="section-title">투입 배분 (아군→클러스터)</div>
        <div className="assignment-summary">
          투입 {commanderState.assignments.filter(a => a.status === "active").length}척 /
          예비 {commanderState.assignments.filter(a => a.status === "reserve").length}척
          {commanderState.assignments.filter(a => a.status === "stopped").length > 0 &&
            ` / 정지 ${commanderState.assignments.filter(a => a.status === "stopped").length}척`}
        </div>
        <div className="assignments-list">
          {commanderState.assignments.map((a) => {
            const cluster = clusterInfos.find(c => c.id === a.clusterId);
            const clusterColor = cluster?.color || CLUSTER_COLORS[a.clusterId % CLUSTER_COLORS.length];
            return (
              <div key={a.allyId} className={`assignment-item ${a.status}`}>
                <span className="ally-tag">#{a.allyId}</span>
                <span className="arrow">→</span>
                {a.status === "active" ? (
                  <span
                    className="cluster-tag"
                    style={{ backgroundColor: clusterColor }}
                  >
                    C{a.clusterId}
                  </span>
                ) : (
                  <span className="status-tag">{a.status === "reserve" ? "RSV" : "STOP"}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 웨이포인트 현황 */}
      <WaypointSection />

      {/* 판단 근거 */}
      <div className="rationale-section">
        <div className="section-title">판단 근거 (rationale)</div>
        <div className="rationale-text">{commanderState.rationale}</div>
      </div>

    </div>
  );
}

/** 웨이포인트 현황 컴포넌트 */
function WaypointSection() {
  const allies = useDefenseStore((s) => s.allies);
  const allyColors = ["#FF6B6B", "#FF8C42", "#FFD93D"];

  const totalWps = allies.reduce((sum, a) => sum + a.route.length, 0);
  const netWps = allies.reduce(
    (sum, a) => sum + a.route.filter(wp => wp.paint).length,
    0
  );

  return (
    <div className="waypoints-section">
      <div className="section-title">
        웨이포인트 현황
        <span className="wp-count">({totalWps}개 / 그물 {netWps}개)</span>
      </div>
      <div className="waypoints-list">
        {allies.map((ally) => (
          <div key={ally.id} className="ally-waypoints">
            <div
              className="ally-header"
              style={{ borderLeftColor: allyColors[ally.id % allyColors.length] }}
            >
              <span className="ally-name">아군 #{ally.id}</span>
              <span className="wp-info">
                {ally.route.length > 0 ? `${ally.route.length} WP` : "경로 없음"}
              </span>
            </div>
            {ally.route.length > 0 && (
              <div className="wp-items">
                {ally.route.map((wp, idx) => (
                  <div key={idx} className={`wp-item ${wp.paint ? "net-wp" : ""}`}>
                    <span className="wp-idx">{idx + 1}</span>
                    <span className="wp-coords">
                      ({wp.x.toFixed(1)}, {wp.z.toFixed(1)})
                    </span>
                    {wp.paint && <span className="wp-net-tag">NET</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

