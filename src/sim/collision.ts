// ─────────────────────────────────────────────────────────────────────────
// 실제 메쉬 충돌 감지 시스템
// - OBB (Oriented Bounding Box) 기반 충돌 감지
// - Separating Axis Theorem (SAT) 사용
// - 선박 실제 크기와 방향 고려
// ─────────────────────────────────────────────────────────────────────────

import { DEFENSE_CONFIG as C } from "../config/defense";

/** 2D 벡터 */
interface Vec2 {
  x: number;
  z: number;
}

/** OBB (Oriented Bounding Box) */
interface OBB {
  centerX: number;
  centerZ: number;
  halfWidth: number;   // 선박 폭의 절반 (x축)
  halfLength: number;  // 선박 길이의 절반 (z축)
  heading: number;     // 방위각 (degrees, 0=North, CW+)
}

// 충돌 여유 배율 (선박 크기의 몇 배로 충돌 박스를 설정할지)
// 1.0 = 정확한 선박 크기, 1.5 = 50% 여유
const COLLISION_MARGIN = 1.3;

/** 선박 상태에서 OBB 생성 */
export function shipToOBB(
  x: number,
  z: number,
  heading: number,
  length?: number,
  width?: number
): OBB {
  // 선박 크기에 여유를 추가하여 충돌 감지
  const shipLength = (length ?? C.render.shipLength) * COLLISION_MARGIN;
  const shipWidth = (width ?? C.render.shipWidth) * COLLISION_MARGIN;

  return {
    centerX: x,
    centerZ: z,
    halfLength: shipLength / 2,
    halfWidth: shipWidth / 2,
    heading,
  };
}

/** 모선 OBB (원형 → 정사각형 근사) */
export function mothershipToOBB(
  x: number,
  z: number,
  radius: number
): OBB {
  return {
    centerX: x,
    centerZ: z,
    halfLength: radius * 0.8,  // 원형을 약간 작은 정사각형으로 근사
    halfWidth: radius * 0.8,
    heading: 0,
  };
}

/** 각도를 라디안으로 변환 */
function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** OBB의 4개 꼭지점 계산 */
function getOBBCorners(obb: OBB): Vec2[] {
  const cos = Math.cos(degToRad(-obb.heading));  // 네비게이션 좌표계 → 수학 좌표계
  const sin = Math.sin(degToRad(-obb.heading));

  // 로컬 좌표에서의 코너 (선수 방향이 -Z)
  const localCorners: Vec2[] = [
    { x: -obb.halfWidth, z: -obb.halfLength },  // 좌현 선수
    { x:  obb.halfWidth, z: -obb.halfLength },  // 우현 선수
    { x:  obb.halfWidth, z:  obb.halfLength },  // 우현 선미
    { x: -obb.halfWidth, z:  obb.halfLength },  // 좌현 선미
  ];

  // 월드 좌표로 변환
  return localCorners.map((corner) => ({
    x: obb.centerX + corner.x * cos - corner.z * sin,
    z: obb.centerZ + corner.x * sin + corner.z * cos,
  }));
}

/** OBB의 분리축 (2개: 로컬 X축, 로컬 Z축) */
function getOBBAxes(obb: OBB): Vec2[] {
  const cos = Math.cos(degToRad(-obb.heading));
  const sin = Math.sin(degToRad(-obb.heading));

  return [
    { x: cos, z: sin },   // 로컬 X축 (선폭 방향)
    { x: -sin, z: cos },  // 로컬 Z축 (선장 방향)
  ];
}

/** 벡터 내적 */
function dot(v1: Vec2, v2: Vec2): number {
  return v1.x * v2.x + v1.z * v2.z;
}

/** 꼭지점들을 축에 투영하여 min/max 반환 */
function projectCorners(corners: Vec2[], axis: Vec2): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;

  for (const corner of corners) {
    const proj = dot(corner, axis);
    if (proj < min) min = proj;
    if (proj > max) max = proj;
  }

  return { min, max };
}

/** 두 구간이 겹치는지 확인 */
function intervalsOverlap(a: { min: number; max: number }, b: { min: number; max: number }): boolean {
  return a.min <= b.max && b.min <= a.max;
}

/**
 * OBB 충돌 감지 (Separating Axis Theorem)
 * 두 OBB가 충돌하면 true 반환
 */
export function checkOBBCollision(obb1: OBB, obb2: OBB): boolean {
  const corners1 = getOBBCorners(obb1);
  const corners2 = getOBBCorners(obb2);

  // 두 OBB의 분리축 (총 4개)
  const axes = [...getOBBAxes(obb1), ...getOBBAxes(obb2)];

  // SAT: 모든 축에서 투영이 겹쳐야 충돌
  for (const axis of axes) {
    const proj1 = projectCorners(corners1, axis);
    const proj2 = projectCorners(corners2, axis);

    if (!intervalsOverlap(proj1, proj2)) {
      return false;  // 분리축 발견 → 충돌 없음
    }
  }

  return true;  // 모든 축에서 겹침 → 충돌!
}

/**
 * OBB와 원(Circle) 충돌 감지
 * 모선(원형)과 선박(OBB) 충돌 체크용
 */
export function checkOBBCircleCollision(
  obb: OBB,
  circleX: number,
  circleZ: number,
  circleRadius: number
): boolean {
  // OBB의 로컬 좌표계로 원의 중심 변환
  const cos = Math.cos(degToRad(obb.heading));
  const sin = Math.sin(degToRad(obb.heading));

  const dx = circleX - obb.centerX;
  const dz = circleZ - obb.centerZ;

  // 로컬 좌표에서의 원 중심
  const localX = dx * cos + dz * sin;
  const localZ = -dx * sin + dz * cos;

  // OBB에서 가장 가까운 점 찾기 (클램핑)
  const closestX = Math.max(-obb.halfWidth, Math.min(obb.halfWidth, localX));
  const closestZ = Math.max(-obb.halfLength, Math.min(obb.halfLength, localZ));

  // 가장 가까운 점과 원 중심 사이 거리
  const distSq = (localX - closestX) ** 2 + (localZ - closestZ) ** 2;

  return distSq <= circleRadius ** 2;
}

/**
 * 아군 간 충돌 체크
 * @returns 충돌한 아군 ID 쌍의 배열
 */
export function checkAllyCollisions(
  allies: Array<{ id: number; x: number; z: number; heading: number; alive: boolean }>
): Array<[number, number]> {
  const collisions: Array<[number, number]> = [];

  for (let i = 0; i < allies.length; i++) {
    const a1 = allies[i];
    if (!a1.alive) continue;

    const obb1 = shipToOBB(a1.x, a1.z, a1.heading);

    for (let j = i + 1; j < allies.length; j++) {
      const a2 = allies[j];
      if (!a2.alive) continue;

      const obb2 = shipToOBB(a2.x, a2.z, a2.heading);

      if (checkOBBCollision(obb1, obb2)) {
        collisions.push([a1.id, a2.id]);
      }
    }
  }

  return collisions;
}

// 그물 충돌 지연 (초) - 그물 설치 후 이 시간이 지나야 아군과 충돌
const NET_COLLISION_DELAY_SECONDS = 2.0;
const NET_COLLISION_DELAY_STEPS = NET_COLLISION_DELAY_SECONDS * 60;  // 60Hz

/**
 * 아군-그물 충돌 체크 (설치 후 2초 지연)
 * 그물이 설치된 셀에 아군이 진입하면 충돌
 * @param ally 아군 상태
 * @param netGrid 그물 격자 (true = 그물 있음)
 * @param netGridTime 그물 설치 시점 (step)
 * @param currentStep 현재 시뮬레이션 스텝
 * @param worldSize 월드 크기
 * @param gridSize 격자 크기
 * @param excludePainting 현재 그물 전개 중인 아군은 제외
 * @returns 충돌 여부
 */
export function checkAllyNetCollision(
  ally: { id: number; x: number; z: number; heading: number; alive: boolean; painting?: boolean },
  netGrid: boolean[][],
  netGridTime: number[][],
  currentStep: number,
  worldSize: number,
  gridSize: number,
  excludePainting: boolean = true
): boolean {
  if (!ally.alive) return false;
  // 그물 전개 중인 아군은 자신이 까는 그물에는 걸리지 않음
  if (excludePainting && ally.painting) return false;

  const cellSize = worldSize / gridSize;
  const obb = shipToOBB(ally.x, ally.z, ally.heading);
  const corners = getOBBCorners(obb);

  // 그물 셀이 활성화되었는지 확인 (2초 지연)
  const isNetActive = (gx: number, gz: number): boolean => {
    if (!netGrid[gz]?.[gx]) return false;
    const deployedAt = netGridTime[gz]?.[gx] || 0;
    if (deployedAt === 0) return false;
    return (currentStep - deployedAt) >= NET_COLLISION_DELAY_STEPS;
  };

  // OBB의 모든 코너가 활성 그물 셀에 있는지 확인
  for (const corner of corners) {
    const gx = Math.floor(corner.x / cellSize);
    const gz = Math.floor(corner.z / cellSize);

    if (gx >= 0 && gx < gridSize && gz >= 0 && gz < gridSize) {
      if (isNetActive(gx, gz)) {
        return true;  // 활성 그물에 닿음
      }
    }
  }

  // 중심점도 확인
  const cx = Math.floor(ally.x / cellSize);
  const cz = Math.floor(ally.z / cellSize);
  if (cx >= 0 && cx < gridSize && cz >= 0 && cz < gridSize) {
    if (isNetActive(cx, cz)) {
      return true;
    }
  }

  return false;
}

/**
 * 모든 아군의 그물 충돌 체크 (설치 후 2초 지연)
 * @returns 그물에 닿은 아군 ID 배열
 */
export function checkAllAllyNetCollisions(
  allies: Array<{ id: number; x: number; z: number; heading: number; alive: boolean; painting?: boolean }>,
  netGrid: boolean[][],
  netGridTime: number[][],
  currentStep: number,
  worldSize: number,
  gridSize: number
): number[] {
  const collided: number[] = [];

  for (const ally of allies) {
    if (checkAllyNetCollision(ally, netGrid, netGridTime, currentStep, worldSize, gridSize)) {
      collided.push(ally.id);
    }
  }

  return collided;
}

/**
 * 아군-모선 충돌 체크
 * @returns 모선과 충돌한 아군 ID 배열
 */
export function checkMothershipCollisions(
  allies: Array<{ id: number; x: number; z: number; heading: number; alive: boolean }>,
  mothership: { x: number; z: number; radius: number }
): number[] {
  const collided: number[] = [];

  for (const ally of allies) {
    if (!ally.alive) continue;

    const obb = shipToOBB(ally.x, ally.z, ally.heading);

    if (checkOBBCircleCollision(obb, mothership.x, mothership.z, mothership.radius)) {
      collided.push(ally.id);
    }
  }

  return collided;
}

// ─────────────────────────────────────────────────────────────────────────
// 디버그용 시각화 데이터 (Three.js에서 사용 가능)
// ─────────────────────────────────────────────────────────────────────────

export function getOBBDebugData(obb: OBB): { corners: Vec2[]; center: Vec2 } {
  return {
    corners: getOBBCorners(obb),
    center: { x: obb.centerX, z: obb.centerZ },
  };
}
