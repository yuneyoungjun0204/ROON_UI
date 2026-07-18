// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 설정 상수
// MobRobGPT/boatattack_sim/env/config.py 기반
// ─────────────────────────────────────────────────────────────────────────

export const DEFENSE_CONFIG = {
  // ── 맵 ──
  worldSize: 12600,       // m (12.6km × 12.6km)
  gridSize: 200,          // 격자 수 (cell = 63m)
  dt: 1 / 60,             // 60Hz 틱 (초)

  // ── 모선 ──
  mothership: {
    x: 6300,              // 맵 중앙
    z: 6300,
    heading: 0,
    radius: 260,          // breach 반경
  },

  // ── 적 ──
  nEnemies: 10,
  enemySpeed: 216,        // m/s (54 × 4배 = 216)
  enemyMaxTurn: 5,        // deg/s
  enemyWeaveAmp: 14,      // 위빙 진폭 (deg)
  enemyWeaveFreq: 1 / 32, // 위빙 주파수 (Hz)
  enemyEvade: true,       // 그물 회피
  enemyEvadeLook: 500,    // 전방 탐지 거리
  enemyEvadeDeg: 32,      // 회피 조향각

  // ── 아군 ──
  nAllies: 3,
  allySpeed: 144,         // m/s (36 × 4배 = 144)
  allyMaxTurn: 8,         // deg/s
  allyRowGap: 550,        // 모선 후미 거리
  allySideSpacing: 330,   // 아군 간 횡간격

  // ── 그물 ──
  netsPerShip: 3,
  netWidth: 4,            // cell (~252m)
  netMaxLen: 450,         // m
  deploySpeedMult: 1.0,   // 전개 중 속도 배율
  deployTurnMult: 1.0,    // 전개 중 선회 배율

  // ── 충돌 ──
  allyCollisionRadius: 115,
  allyMotherRadius: 300,

  // ── 클러스터 ──
  nClusters: 4,
  clusterGapDeg: 12,      // 클러스터 분할 임계각

  // ── 적 포메이션 상세 ──
  formations: {
    spawnRadius: 5450,    // 기본 스폰 거리
    groupJitter: 150,     // 그룹 내 산포
    waveRanks: 3,         // 파상 단수
    waveGap: 1000,        // 파상 단 간격
    waveNear: 4000,       // 첫 파 거리
    waveSpread: 18,       // 파상 방위 분산
  },

  // ── 동적 스케일링 ──
  scaling: {
    targetSimRadius: 5450,  // 시뮬에서 적의 목표 거리
    scaleMin: 0.5,          // 최소 스케일 (과축소 방지)
    scaleMax: 2.0,          // 최대 스케일 (과확대 방지)
    dMinFloor: 1000,        // 적 최소 거리 (m)
  },
} as const;

/** 포메이션 이름 (한글) */
export const FORMATION_NAMES: Record<string, string> = {
  concentrated: "집중 공격",
  diversionary: "양동 공격",
  wave: "파상 공격",
  random: "무작위",
};
