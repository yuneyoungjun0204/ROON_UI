// ─────────────────────────────────────────────────────────────────────────
// 적/아군 스폰 시스템
// MobRobGPT/boatattack_sim/env/formations.py 이식
// ─────────────────────────────────────────────────────────────────────────

import { DEFENSE_CONFIG as C } from "../config/defense";
import type { AllyState, EnemyState, EnemyFormation } from "../types/defense";

/**
 * 적 스폰 - 포메이션에 따라 다른 패턴 생성
 */
export function spawnEnemies(
  formation: EnemyFormation,
  rng: () => number = Math.random
): EnemyState[] {
  switch (formation) {
    case "concentrated":
      return spawnConcentrated(rng);
    case "diversionary":
      return spawnDiversionary(rng);
    case "wave":
      return spawnWave(rng);
    default:
      return spawnRandom(rng);
  }
}

/** 집중 공격: 한 방위에서 10대 밀집 */
function spawnConcentrated(rng: () => number): EnemyState[] {
  const center = C.worldSize / 2;
  const bearing = rng() * 360;  // 무작위 방위
  const bearingRad = (bearing * Math.PI) / 180;
  const enemies: EnemyState[] = [];

  for (let i = 0; i < C.nEnemies; i++) {
    // 그룹 내 산포
    const jitterX = (rng() - 0.5) * 2 * C.formations.groupJitter;
    const jitterZ = (rng() - 0.5) * 2 * C.formations.groupJitter;

    const x = center + Math.sin(bearingRad) * C.formations.spawnRadius + jitterX;
    const z = center - Math.cos(bearingRad) * C.formations.spawnRadius + jitterZ;

    // 모선 방향으로 헤딩 (heading 0 = 북쪽/-Z, 90 = 동쪽/+X)
    // sin(heading) = deltaX 방향, -cos(heading) = deltaZ 방향
    const headingToMother = Math.atan2(center - x, z - center) * (180 / Math.PI);

    enemies.push({
      id: i,
      x, z,
      heading: ((headingToMother % 360) + 360) % 360,
      speed: C.enemySpeed,
      yawRate: 0,
      alive: true,
      phase: rng() * Math.PI * 2,
      clusterId: 0,  // 모두 같은 클러스터
    });
  }

  return enemies;
}

/** 양동 공격: 3그룹으로 분산 (8:1:1 비율) */
function spawnDiversionary(rng: () => number): EnemyState[] {
  const center = C.worldSize / 2;
  const nGroups = 3;
  const baseBearing = rng() * 360;
  const bearings = [
    baseBearing,
    (baseBearing + 120) % 360,
    (baseBearing + 240) % 360,
  ];

  // 그룹별 적 배분 (3:4:3 비율)
  const distribution = [3, 4, 3];
  const enemies: EnemyState[] = [];
  let id = 0;

  for (let g = 0; g < nGroups; g++) {
    const bearingRad = (bearings[g] * Math.PI) / 180;

    for (let i = 0; i < distribution[g]; i++) {
      const jitterX = (rng() - 0.5) * 2 * C.formations.groupJitter;
      const jitterZ = (rng() - 0.5) * 2 * C.formations.groupJitter;

      const x = center + Math.sin(bearingRad) * C.formations.spawnRadius + jitterX;
      const z = center - Math.cos(bearingRad) * C.formations.spawnRadius + jitterZ;
      const headingToMother = Math.atan2(center - x, z - center) * (180 / Math.PI);

      enemies.push({
        id: id++,
        x, z,
        heading: ((headingToMother % 360) + 360) % 360,
        speed: C.enemySpeed,
        yawRate: 0,
        alive: true,
        phase: rng() * Math.PI * 2,
        clusterId: g,
      });
    }
  }

  return enemies;
}

/** 파상 공격: 3단계 시차 공격 (4km/5km/6km) */
function spawnWave(rng: () => number): EnemyState[] {
  const center = C.worldSize / 2;
  const baseBearing = rng() * 360;
  const enemies: EnemyState[] = [];
  let id = 0;

  // 단별 배분 (4/3/3)
  const distribution = [4, 3, 3];

  for (let rank = 0; rank < C.formations.waveRanks; rank++) {
    const distance = C.formations.waveNear + rank * C.formations.waveGap;
    const bearingOffset = (rank - 1) * C.formations.waveSpread;
    const bearing = baseBearing + bearingOffset;
    const bearingRad = (bearing * Math.PI) / 180;

    for (let i = 0; i < distribution[rank]; i++) {
      const jitterX = (rng() - 0.5) * 2 * C.formations.groupJitter;
      const jitterZ = (rng() - 0.5) * 2 * C.formations.groupJitter;

      const x = center + Math.sin(bearingRad) * distance + jitterX;
      const z = center - Math.cos(bearingRad) * distance + jitterZ;
      const headingToMother = Math.atan2(center - x, z - center) * (180 / Math.PI);

      enemies.push({
        id: id++,
        x, z,
        heading: ((headingToMother % 360) + 360) % 360,
        speed: C.enemySpeed,
        yawRate: 0,
        alive: true,
        phase: rng() * Math.PI * 2,
        clusterId: rank,
      });
    }
  }

  return enemies;
}

/** 무작위 스폰 */
function spawnRandom(rng: () => number): EnemyState[] {
  const center = C.worldSize / 2;
  const enemies: EnemyState[] = [];

  for (let i = 0; i < C.nEnemies; i++) {
    const bearing = rng() * 360;
    const bearingRad = (bearing * Math.PI) / 180;
    const distance = C.formations.spawnRadius * (0.8 + rng() * 0.4);

    const x = center + Math.sin(bearingRad) * distance;
    const z = center - Math.cos(bearingRad) * distance;
    const headingToMother = Math.atan2(center - x, z - center) * (180 / Math.PI);

    enemies.push({
      id: i,
      x, z,
      heading: ((headingToMother % 360) + 360) % 360,
      speed: C.enemySpeed,
      yawRate: 0,
      alive: true,
      phase: rng() * Math.PI * 2,
      clusterId: Math.floor(rng() * C.nClusters),
    });
  }

  return enemies;
}

/** 아군 스폰: 모선 후미에 횡렬 배치 */
export function spawnAllies(): AllyState[] {
  const center = C.worldSize / 2;
  const allies: AllyState[] = [];

  // 모선 아래(남쪽)에 횡렬 배치
  const rowZ = center + C.allyRowGap;  // z 좌표 (남쪽 = +z)
  const startX = center - ((C.nAllies - 1) * C.allySideSpacing) / 2;

  for (let i = 0; i < C.nAllies; i++) {
    allies.push({
      id: i,
      x: startX + i * C.allySideSpacing,
      z: rowZ,
      heading: 0,               // 북쪽을 향함 (모선 방향)
      speed: 0,
      yawRate: 0,
      thrustPort: 0,
      thrustStbd: 0,
      throttle: 0,
      steer: 0,
      alive: true,
      netsRemaining: C.netsPerShip,
      painting: false,
      paintDist: 0,
      assignedCluster: -1,
      route: [],
    });
  }

  return allies;
}
