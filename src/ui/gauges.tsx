// 하단 콘솔 게이지 — 헤딩 나침반 · 반원 속도계 · 세로 배터리 · 좌/우 추력 바.
// 네 게이지 모두 「그림 영역(.gauge-figure, 고정 높이) + 값 행(.gauge-value)」의
// 동일한 2단 구조를 가진다 — 값 행이 한 줄로 정렬되고 그림 크기 밸런스가 유지된다.

import { Zap } from "lucide-react";
import { useSimStore } from "../store";
import { MAX_SPEED_KN } from "../sim/usvSim";

const MS_TO_KN = 1.943844;

/** 침로를 -180~+180 부호 표기로 (북 0, 동 +, 서 -) */
function signedHeading(heading: number) {
  return ((heading + 180) % 360) - 180;
}

// ---------- 헤딩 나침반 ----------

/** 30° 간격 눈금 (주눈금은 N/E/S/W) — 정적이라 미리 계산 */
const COMPASS_TICKS = Array.from({ length: 12 }, (_, i) => {
  const deg = i * 30;
  const major = deg % 90 === 0;
  const rad = (deg * Math.PI) / 180;
  const r1 = major ? 39 : 42;
  return {
    key: deg,
    major,
    x1: 50 + Math.sin(rad) * r1,
    y1: 50 - Math.cos(rad) * r1,
    x2: 50 + Math.sin(rad) * 46,
    y2: 50 - Math.cos(rad) * 46,
  };
});
const COMPASS_CARDINALS = [
  { label: "N", deg: 0 },
  { label: "E", deg: 90 },
  { label: "S", deg: 180 },
  { label: "W", deg: 270 },
].map(({ label, deg }) => {
  const rad = (deg * Math.PI) / 180;
  return { label, x: 50 + Math.sin(rad) * 30, y: 50 - Math.cos(rad) * 30 };
});

export function CompassGauge() {
  const heading = useSimStore((s) => s.usv.heading);
  const sh = signedHeading(heading);
  return (
    <div className="gauge-card compass-card">
      <div className="gauge-figure">
        <svg viewBox="0 0 100 100" className="compass-svg">
          <circle cx="50" cy="50" r="47" className="compass-ring" />
          {COMPASS_TICKS.map((t) => (
            <line
              key={t.key}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              className={t.major ? "compass-tick major" : "compass-tick"}
            />
          ))}
          {COMPASS_CARDINALS.map((c) => (
            <text
              key={c.label}
              x={c.x}
              y={c.y}
              className={c.label === "N" ? "compass-cardinal north" : "compass-cardinal"}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {c.label}
            </text>
          ))}
          {/* 침로 바늘 — 위(N)가 0°, 시계방향 회전 */}
          <g transform={`rotate(${heading} 50 50)`}>
            <path d="M50 13 L55 50 L50 57 L45 50 Z" className="compass-needle" />
          </g>
          <circle cx="50" cy="50" r="3" className="compass-hub" />
        </svg>
      </div>
      <span className="gauge-value">
        {sh > 0 ? "+" : ""}
        {sh.toFixed(1)}°
      </span>
    </div>
  );
}

// ---------- 속도계 (반원, 중앙 0 · 우측 전진 · 좌측 후진) ----------

/** 눈금: -최대 ~ +최대, 10kn 간격 (주눈금 20kn) */
const SPEED_TICKS = (() => {
  const ticks: { key: number; major: boolean; x1: number; y1: number; x2: number; y2: number; lx: number; ly: number; label: string }[] = [];
  for (let kn = -MAX_SPEED_KN; kn <= MAX_SPEED_KN; kn += 10) {
    const major = kn % 20 === 0;
    const ang = ((kn / MAX_SPEED_KN) * 90 * Math.PI) / 180; // -90°~+90°, 0=위
    const sin = Math.sin(ang);
    const cos = Math.cos(ang);
    const r1 = major ? 36 : 39;
    ticks.push({
      key: kn,
      major,
      x1: 60 + sin * r1,
      y1: 62 - cos * r1,
      x2: 60 + sin * 43,
      y2: 62 - cos * 43,
      lx: 60 + sin * 29,
      ly: 62 - cos * 29,
      label: major ? String(Math.abs(kn)) : "",
    });
  }
  return ticks;
})();

export function SpeedGauge() {
  const speed = useSimStore((s) => s.usv.speed);
  const kn = speed * MS_TO_KN;
  const clamped = Math.max(-MAX_SPEED_KN, Math.min(MAX_SPEED_KN, kn));
  const needleAngle = (clamped / MAX_SPEED_KN) * 90; // -90(좌) ~ +90(우)
  const reversing = kn < -0.05;
  return (
    <div className="gauge-card speed-card">
      <div className="gauge-figure">
        {/* viewBox를 실제 그림 범위로 크롭 — 위/좌우 빈 여백 제거 */}
        <svg viewBox="13 14 94 63" className="speed-svg">
          {/* 후진(좌) / 전진(우) 반원 호 */}
          <path d="M17 62 A43 43 0 0 1 60 19" className="speed-arc rev" />
          <path d="M60 19 A43 43 0 0 1 103 62" className="speed-arc fwd" />
          {SPEED_TICKS.map((t) => (
            <g key={t.key}>
              <line
                x1={t.x1}
                y1={t.y1}
                x2={t.x2}
                y2={t.y2}
                className={t.major ? "speed-tick major" : "speed-tick"}
              />
              {t.label && (
                <text x={t.lx} y={t.ly} className="speed-label" textAnchor="middle" dominantBaseline="central">
                  {t.label}
                </text>
              )}
            </g>
          ))}
          {/* REV/FWD — 호 끝·눈금 라벨과 겹치지 않게 그림 아래쪽으로 */}
          <text x="23" y="75" className="speed-zone rev-zone" textAnchor="middle">REV</text>
          <text x="97" y="75" className="speed-zone fwd-zone" textAnchor="middle">FWD</text>
          <g transform={`rotate(${needleAngle} 60 62)`}>
            <line x1="60" y1="62" x2="60" y2="24" className={reversing ? "speed-needle rev" : "speed-needle"} />
          </g>
          <circle cx="60" cy="62" r="3.4" className="compass-hub" />
        </svg>
      </div>
      <span className="gauge-value">
        {Math.abs(kn).toFixed(1)} <em className="gauge-unit">knot</em>
        {reversing && <b className="rev-chip">R</b>}
      </span>
    </div>
  );
}

// ---------- 세로 배터리 ----------

export function BatteryGauge() {
  const battery = useSimStore((s) => s.battery);
  const charging = useSimStore((s) => s.charging);
  const level = battery > 50 ? "high" : battery > 15 ? "mid" : "low";
  return (
    <div className={`gauge-card battv-card battv-${level}`}>
      <div className="gauge-figure">
        <div className="battv">
          <div className="battv-cap" />
          <div className="battv-body">
            {/* 위아래로 차오르는 게이지 — scaleY(GPU 합성)로 잔상·리페인트 없이 */}
            <div className="battv-fill" style={{ transform: `scaleY(${battery / 100})` }} />
            {charging && <Zap size={20} className="battv-bolt" />}
          </div>
        </div>
      </div>
      <span className="gauge-value">
        {battery.toFixed(0)}%{charging && <em className="gauge-unit"> 충전</em>}
      </span>
    </div>
  );
}

// ---------- 좌/우 추력 바 (세로, 중앙 0 · 위 전진 · 아래 후진) ----------

function ThrustVBar({ label, value }: { label: string; value: number }) {
  const scale = Math.min(1, Math.abs(value) / 100);
  const forward = value >= 0;
  return (
    <div className="thrustv">
      <div className="thrustv-bar">
        <div className="thrustv-center" />
        <div className="thrustv-fill up" style={{ transform: `scaleY(${forward ? scale : 0})` }} />
        <div className="thrustv-fill down" style={{ transform: `scaleY(${forward ? 0 : scale})` }} />
      </div>
      <span className="thrustv-label">{label}</span>
    </div>
  );
}

export function ThrustBars() {
  const port = useSimStore((s) => s.usv.thrustPort);
  const stbd = useSimStore((s) => s.usv.thrustStbd);
  return (
    <div className="gauge-card thrust-card">
      <div className="gauge-figure">
        <ThrustVBar label="L" value={port} />
        <ThrustVBar label="R" value={stbd} />
      </div>
      {/* 값 행 — 다른 게이지와 같은 줄에, 각 바 아래로 정렬 */}
      <span className="gauge-value thrust-values">
        <span>{port.toFixed(0)}%</span>
        <span>{stbd.toFixed(0)}%</span>
      </span>
    </div>
  );
}
