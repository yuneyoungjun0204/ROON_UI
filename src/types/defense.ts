// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 타입 정의
// - 10대 적군 (집중/파상/양동 공격 시나리오)
// - 1대 모선 (중앙, 방어 대상)
// - 3대 아군 (모선 후미 배치, 그물 전개)
// - 그물 시스템
// ─────────────────────────────────────────────────────────────────────────

/** 선박 공통 상태 */
export interface ShipState {
  id: number;
  x: number;           // ENU 좌표 (m)
  z: number;
  heading: number;     // deg, 0=북, 시계방향
  speed: number;       // m/s
  yawRate: number;     // deg/s
  alive: boolean;
}

/** 아군 상태 (ShipState 확장) */
export interface AllyState extends ShipState {
  thrustPort: number;   // 좌현 추력 %
  thrustStbd: number;   // 우현 추력 %
  throttle: number;
  steer: number;
  netsRemaining: number;  // 남은 그물 수
  painting: boolean;      // 그물 전개 중
  paintDist: number;      // 현재 그물 전개 거리
  assignedCluster: number; // 배정된 클러스터 (-1=예비)
  route: Waypoint[];      // 경로 WP
}

/** 적 상태 */
export interface EnemyState extends ShipState {
  phase: number;        // 위빙 위상
  clusterId: number;    // 소속 클러스터
}

/** 모선 상태 */
export interface MothershipState {
  x: number;
  z: number;
  heading: number;
  radius: number;       // breach 반경 (260m)
}

/** 그물 세그먼트 */
export interface NetSegment {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  allyId: number;       // 설치한 아군
  installed: boolean;   // 완성 여부
}

/** 클러스터 정보 */
export interface ClusterInfo {
  id: number;
  centroidX: number;
  centroidZ: number;
  enemyIds: number[];
  threat: number;       // 위협도 (모선과의 거리 기반)
  spread: number;       // 분산도
}

/** 웨이포인트 */
export interface Waypoint {
  x: number;
  z: number;
  paint: boolean;       // 그물 구간 여부
  started: boolean;
  active: boolean;
}

/** 시뮬레이션 통계 */
export interface SimStats {
  captures: number;     // 포획된 적
  breaches: number;     // 돌파한 적
  allyCollisions: number;
  netsUsed: number;
  netTouches: number;   // 아군이 그물에 닿은 횟수
  survived: number;     // 잔존 적
}

/** 적 공격 시나리오 */
export type EnemyFormation =
  | "concentrated"    // 집중: 한 방위에서 10대 밀집
  | "diversionary"    // 양동: 3그룹으로 분산
  | "wave"            // 파상: 3단계 시차 공격
  | "random";         // 무작위

/** 시뮬레이션 모드 */
export type SimMode = "usv" | "defense";

/** 아군 할당 정보 (MobRobGPT 스타일) */
export interface Assignment {
  allyId: number;
  clusterId: number;  // -1 = 미할당
  status: "active" | "reserve" | "stopped";
}

/** 지휘관 상태 (MobRobGPT run_commander_ui.py 스타일) */
export interface CommanderState {
  model: string;
  status: "ready" | "calling" | "error";
  command: string;
  clusters: (ClusterInfo & { bearing?: number; color?: string })[];
  assignments: Assignment[];
  rationale: string;
  lastUpdate: number;
}
