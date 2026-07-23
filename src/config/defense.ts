// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 설정 상수
// MobRobGPT/boatattack_sim/env/config.py 기반
//
// 스케일 시스템:
// - BASE_CONFIG: 원본 MobRobGPT 스케일 (12.6km 맵)
// - SCALE: 공간 스케일 팩터 (거리, 크기)
// - DEFENSE_CONFIG: 실제 사용 값 (BASE * SCALE)
// ─────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
// 스케일 팩터 (이 값만 변경하면 모든 거리/크기가 일괄 조정됨)
// MobRobGPT --world 33 옵션과 일치해야 함
// ═══════════════════════════════════════════════════════════════════════════
export const SCALE = 33 / 12600;  // ≈ 0.00262 (worldSize 33m 기준)

// ═══════════════════════════════════════════════════════════════════════════
// 원본 설정 (MobRobGPT 12.6km 맵 기준)
// ═══════════════════════════════════════════════════════════════════════════
const BASE_CONFIG = {
  // ── 맵 ──
  worldSize: 12600,       // m (12.6km × 12.6km)

  // ── 모선 ──
  mothership: {
    x: 6300,              // 맵 중앙
    z: 6300,
    radius: 260,          // breach 반경
  },

  // ── 속도 (원본) ──
  enemySpeed: 54,         // m/s
  allySpeed: 36,          // m/s

  // ── 거리/크기 ──
  allyRowGap: 550,        // 모선 후미 거리
  allySideSpacing: 330,   // 아군 간 횡간격
  allyCollisionRadius: 115,
  allyMotherRadius: 300,
  enemyEvadeLook: 500,    // 전방 탐지 거리
  netMaxLen: 450,         // 그물 최대 길이

  // ── 적 포메이션 ──
  formations: {
    spawnRadius: 5450,    // 기본 스폰 거리
    groupJitter: 150,     // 그룹 내 산포
    waveGap: 1000,        // 파상 단 간격
    waveNear: 4000,       // 첫 파 거리
  },

  // ── 클러스터 ──
  clusterDistance: 800,   // 클러스터링 거리

  // ── 3D 렌더링 (선박 크기 등) ──
  render: {
    shipLength: 80,       // 선박 길이
    shipWidth: 30,        // 선박 폭
    shipHeight: 6,        // 선박 높이
    markerHeight: 160,    // 마커 폴 높이
    markerSphere: 20,     // 마커 구체 크기
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 실제 사용 설정 (스케일 적용)
// ═══════════════════════════════════════════════════════════════════════════
export const DEFENSE_CONFIG = {
  // ── 스케일 팩터 (외부 참조용) ──
  scale: SCALE,

  // ── 맵 ──
  worldSize: BASE_CONFIG.worldSize * SCALE,
  gridSize: 200,          // 격자 수 (변경 없음)
  dt: 1 / 60,             // 60Hz 틱

  // ── 모선 ──
  mothership: {
    x: BASE_CONFIG.mothership.x * SCALE,
    z: BASE_CONFIG.mothership.z * SCALE,
    heading: 0,
    radius: BASE_CONFIG.mothership.radius * SCALE,
  },

  // ── 적 ──
  nEnemies: 10,
  enemySpeed: 0.3,  // m/s
  enemyMaxTurn: 5,        // deg/s (각도는 스케일 무관)
  enemyWeaveAmp: 14,      // 위빙 진폭 (deg)
  enemyWeaveFreq: 1 / 32, // 위빙 주파수 (Hz)
  enemyEvade: true,
  enemyEvadeLook: BASE_CONFIG.enemyEvadeLook * SCALE,
  enemyEvadeDeg: 32,      // 회피 조향각

  // ── 아군 ──
  nAllies: 3,
  allySpeed: 0.14,  // m/s
  allyMaxTurn: 8,         // deg/s
  allyRowGap: BASE_CONFIG.allyRowGap * SCALE,
  allySideSpacing: BASE_CONFIG.allySideSpacing * SCALE,

  // ── 그물 ──
  netsPerShip: 3,
  netWidth: 4,            // cell 단위 (변경 없음)
  netMaxLen: BASE_CONFIG.netMaxLen * SCALE,
  deploySpeedMult: 1.0,
  deployTurnMult: 1.0,

  // ── 충돌 ──
  allyCollisionRadius: BASE_CONFIG.allyCollisionRadius * SCALE,
  allyMotherRadius: BASE_CONFIG.allyMotherRadius * SCALE,

  // ── 클러스터 ──
  nClusters: 4,
  clusterGapDeg: 12,
  clusterDistance: BASE_CONFIG.clusterDistance * SCALE,

  // ── 적 포메이션 상세 ──
  formations: {
    spawnRadius: BASE_CONFIG.formations.spawnRadius * SCALE,
    groupJitter: BASE_CONFIG.formations.groupJitter * SCALE,
    waveRanks: 3,
    waveGap: BASE_CONFIG.formations.waveGap * SCALE,
    waveNear: BASE_CONFIG.formations.waveNear * SCALE,
    waveSpread: 18,       // 방위 분산 (deg, 스케일 무관)
  },

  // ── 3D 렌더링 ──
  render: {
    shipLength: BASE_CONFIG.render.shipLength * SCALE,
    shipWidth: BASE_CONFIG.render.shipWidth * SCALE,
    shipHeight: BASE_CONFIG.render.shipHeight * SCALE,
    markerHeight: BASE_CONFIG.render.markerHeight * SCALE,
    markerSphere: BASE_CONFIG.render.markerSphere * SCALE,
  },

  // ── 동적 스케일링 (레거시, 사용 안 함) ──
  scaling: {
    targetSimRadius: BASE_CONFIG.formations.spawnRadius * SCALE,
    scaleMin: 0.5,
    scaleMax: 2.0,
    dMinFloor: 1000 * SCALE,
  },
} as const;

/** 포메이션 이름 (한글) */
export const FORMATION_NAMES: Record<string, string> = {
  concentrated: "집중 공격",
  diversionary: "양동 공격",
  wave: "파상 공격",
  random: "무작위",
};

// ═══════════════════════════════════════════════════════════════════════════
// 디버그: 현재 스케일 출력
// ═══════════════════════════════════════════════════════════════════════════
if (import.meta.env.DEV) {
  console.log(`[Defense Config] SCALE = ${SCALE.toFixed(6)}`);
  console.log(`  worldSize: ${DEFENSE_CONFIG.worldSize.toFixed(2)}m`);
  console.log(`  spawnRadius: ${DEFENSE_CONFIG.formations.spawnRadius.toFixed(2)}m`);
  console.log(`  enemySpeed: ${DEFENSE_CONFIG.enemySpeed.toFixed(3)}m/s`);
  console.log(`  allySpeed: ${DEFENSE_CONFIG.allySpeed.toFixed(3)}m/s`);
  console.log(`  shipLength: ${DEFENSE_CONFIG.render.shipLength.toFixed(3)}m`);
}
