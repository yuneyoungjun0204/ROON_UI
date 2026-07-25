// ─────────────────────────────────────────────────────────────────────────
// 그물 격자 시스템
// - 아군이 그물 WP 구간을 이동하면 경로를 따라 격자에 "칠함"
// - 적이 칠해진 격자에 진입하면 포획
// ─────────────────────────────────────────────────────────────────────────

import { DEFENSE_CONFIG as C } from "../config/defense";
import type { AllyState, NetSegment, EnemyState } from "../types/defense";

/** 월드 좌표 → 격자 인덱스 */
export function worldToGrid(x: number, z: number): [number, number] {
  const cellSize = C.worldSize / C.gridSize;
  const gx = Math.floor(x / cellSize);
  const gz = Math.floor(z / cellSize);
  return [
    Math.max(0, Math.min(C.gridSize - 1, gx)),
    Math.max(0, Math.min(C.gridSize - 1, gz)),
  ];
}

/** 격자 인덱스 → 월드 좌표 (셀 중심) */
export function gridToWorld(gx: number, gz: number): [number, number] {
  const cellSize = C.worldSize / C.gridSize;
  return [
    (gx + 0.5) * cellSize,
    (gz + 0.5) * cellSize,
  ];
}

/** 빈 그물 격자 생성 */
export function createEmptyNetGrid(): boolean[][] {
  return Array(C.gridSize).fill(null).map(() =>
    Array(C.gridSize).fill(false)
  );
}

/** 빈 그물 시간 격자 생성 (설치 시점 추적) */
export function createEmptyNetTimeGrid(): number[][] {
  return Array(C.gridSize).fill(null).map(() =>
    Array(C.gridSize).fill(0)  // 0 = 그물 없음
  );
}

/** 빈 그물 소유자 격자 생성 (어떤 아군이 설치했는지) */
export function createEmptyNetOwnerGrid(): number[][] {
  return Array(C.gridSize).fill(null).map(() =>
    Array(C.gridSize).fill(-1)  // -1 = 소유자 없음
  );
}

/** 빈 아군별 그물 셀 순서 맵 생성 */
export function createEmptyNetSequenceMap(): Map<number, Array<{ gx: number; gz: number }>> {
  return new Map();
}

/**
 * 그물 전개 업데이트
 * - ally가 그물 WP 구간을 이동 중이면 경로를 따라 격자를 칠함
 * - netWidth 만큼의 폭으로 띠(band)를 생성
 * - 소유자와 설치 순서도 추적
 */
export function updateNetPainting(
  ally: AllyState,
  prevX: number,
  prevZ: number,
  netGrid: boolean[][],
  netOwnerGrid: number[][],
  netSequence: Map<number, Array<{ gx: number; gz: number }>>,
  _dt: number
): {
  netGrid: boolean[][];
  netOwnerGrid: number[][];
  netSequence: Map<number, Array<{ gx: number; gz: number }>>;
  netSegment: NetSegment | null;
  newPaintDist: number;
} {
  if (!ally.painting || !ally.alive) {
    return { netGrid, netOwnerGrid, netSequence, netSegment: null, newPaintDist: ally.paintDist };
  }

  const cellSize = C.worldSize / C.gridSize;

  // 이동 벡터
  const dx = ally.x - prevX;
  const dz = ally.z - prevZ;
  const dist = Math.hypot(dx, dz);

  // 최소 이동 거리 (셀 크기의 1%)
  const minDist = cellSize * 0.01;
  if (dist < minDist) return { netGrid, netOwnerGrid, netSequence, netSegment: null, newPaintDist: ally.paintDist };

  // 수직 방향 (그물 폭 방향)
  const perpX = -dz / dist;
  const perpZ = dx / dist;

  // 이동 경로를 따라 격자 칠하기
  const steps = Math.ceil(dist / (cellSize * 0.5));
  const newGrid = netGrid.map(row => [...row]);
  const newOwnerGrid = netOwnerGrid.map(row => [...row]);
  const newSequence = new Map(netSequence);

  // 이 아군의 그물 셀 순서 가져오기 (없으면 생성)
  if (!newSequence.has(ally.id)) {
    newSequence.set(ally.id, []);
  }
  const allySequence = [...newSequence.get(ally.id)!];

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = prevX + dx * t;
    const cz = prevZ + dz * t;

    // 폭 방향으로 여러 셀 칠하기
    for (let w = -C.netWidth / 2; w <= C.netWidth / 2; w++) {
      const wx = cx + perpX * w * cellSize;
      const wz = cz + perpZ * w * cellSize;
      const [gx, gz] = worldToGrid(wx, wz);
      if (gz >= 0 && gz < C.gridSize && gx >= 0 && gx < C.gridSize) {
        // 새로 칠하는 셀만 추적
        if (!newGrid[gz][gx]) {
          newGrid[gz][gx] = true;
          newOwnerGrid[gz][gx] = ally.id;
          allySequence.push({ gx, gz });
        }
      }
    }
  }

  newSequence.set(ally.id, allySequence);

  // 전개 거리 누적
  const newPaintDist = ally.paintDist + dist;

  // 그물 길이 한계 도달 시 세그먼트 완성
  let netSegment: NetSegment | null = null;
  if (newPaintDist >= C.netMaxLen) {
    const startWp = ally.route.find(w => w.paint && w.started);
    netSegment = {
      startX: startWp?.x ?? prevX,
      startZ: startWp?.z ?? prevZ,
      endX: ally.x,
      endZ: ally.z,
      allyId: ally.id,
      installed: true,
    };
  }

  return { netGrid: newGrid, netOwnerGrid: newOwnerGrid, netSequence: newSequence, netSegment, newPaintDist };
}

/**
 * 적 포획 체크
 * - 적이 칠해진 격자에 진입하면 포획 (alive = false)
 */
export function checkCapture(
  enemy: EnemyState,
  netGrid: boolean[][]
): boolean {
  if (!enemy.alive) return false;

  const [gx, gz] = worldToGrid(enemy.x, enemy.z);
  return netGrid[gz]?.[gx] ?? false;
}

/**
 * 적 그물 회피 로직
 * - 전방에 설치된 그물이 있으면 측면으로 회피
 */
export function evadeNet(
  enemy: EnemyState,
  netGrid: boolean[][],
  mothership: { x: number; z: number }
): number {
  if (!C.enemyEvade) return 0;

  const headingRad = (enemy.heading * Math.PI) / 180;
  const lookDist = C.enemyEvadeLook;
  const cellSize = C.worldSize / C.gridSize;

  // 전방 탐지 (스케일 적용)
  const stepSize = cellSize * 2;  // 셀 크기의 2배씩 탐지
  for (let d = stepSize; d < lookDist; d += stepSize) {
    const checkX = enemy.x + Math.sin(headingRad) * d;
    const checkZ = enemy.z - Math.cos(headingRad) * d;
    const [gx, gz] = worldToGrid(checkX, checkZ);

    if (netGrid[gz]?.[gx]) {
      // 그물 감지 - 모선 기준 좌/우 중 가까운 쪽으로 회피
      const toMotherX = mothership.x - enemy.x;
      const toMotherZ = mothership.z - enemy.z;
      const cross = Math.sin(headingRad) * toMotherZ +
                    Math.cos(headingRad) * toMotherX;

      return cross > 0 ? -C.enemyEvadeDeg : C.enemyEvadeDeg;
    }
  }

  return 0;
}

/**
 * 적 돌파 체크
 * - 적이 모선 반경 내에 진입하면 돌파
 */
export function checkBreach(
  enemy: EnemyState,
  mothership: { x: number; z: number; radius: number }
): boolean {
  if (!enemy.alive) return false;

  const dist = Math.hypot(enemy.x - mothership.x, enemy.z - mothership.z);
  return dist < mothership.radius;
}

/**
 * 적 이동 업데이트
 * - 모선 방향으로 이동 + 위빙 + 그물 회피
 */
export function updateEnemy(
  enemy: EnemyState,
  netGrid: boolean[][],
  mothership: { x: number; z: number },
  elapsedTime: number,
  dt: number
): EnemyState {
  if (!enemy.alive) return enemy;

  // 모선 방향
  const toMotherX = mothership.x - enemy.x;
  const toMotherZ = mothership.z - enemy.z;
  const targetHeading = Math.atan2(toMotherX, -toMotherZ) * (180 / Math.PI);

  // 위빙 (완만한 좌우 흔들림 - 약 8초 주기)
  const weavePhase = enemy.phase + elapsedTime * 0.8;  // 0.8 rad/s ≈ 8초 주기
  const weave = C.enemyWeaveAmp * 0.3 * Math.sin(weavePhase);  // 진폭 축소

  // 그물 회피
  const evadeDelta = evadeNet(enemy, netGrid, mothership);

  // 목표 헤딩 (모선 방향 + 작은 위빙)
  const desiredHeading = targetHeading + weave + evadeDelta;

  // 현재 헤딩과의 차이 (-180 ~ 180)
  let headingDiff = ((desiredHeading - enemy.heading + 540) % 360) - 180;

  // 선회 속도 제한 (deg/s)
  const maxTurnThisFrame = C.enemyMaxTurn * dt;
  headingDiff = Math.max(-maxTurnThisFrame, Math.min(maxTurnThisFrame, headingDiff));

  const newHeading = (enemy.heading + headingDiff + 360) % 360;
  const headingRad = (newHeading * Math.PI) / 180;

  // 전진 이동
  const moveX = Math.sin(headingRad) * enemy.speed * dt;
  const moveZ = -Math.cos(headingRad) * enemy.speed * dt;

  return {
    ...enemy,
    heading: newHeading,
    x: enemy.x + moveX,
    z: enemy.z + moveZ,
  };
}
