# USV Simulator → BoatAttack 방어 시뮬레이터 통합 가이드

> **목적**: 단일 USV 시뮬레이터를 다중 선박 방어 시나리오로 확장
> - 10대 적군 (집중/파상/양동 공격 시나리오)
> - 1대 모선 (중앙, 방어 대상)
> - 3대 아군 (모선 후미 배치, 그물 전개)
> - 그물 시스템 (신규 구현)

---

## 1. 현재 구조 분석

### 1.1 usv-simulator 핵심 파일

| 파일 | 역할 | 수정 필요 |
|------|------|----------|
| `src/store.ts` | 단일 USV 상태 관리 (Zustand) | **대규모 수정** |
| `src/sim/usvSim.ts` | USV 운동학 (차동 추진) | 재사용 가능 |
| `src/scene/Scene.tsx` | 3D 씬 구성 | **대규모 수정** |
| `src/scene/Usv.tsx` | USV 3D 모델 렌더링 | 다중 인스턴스화 |
| `src/scene/Ocean.tsx` | 바다/파도 렌더링 | 그대로 유지 |
| `src/ui/Hud.tsx` | HUD 표시 | **대규모 수정** |

### 1.2 MobRobGPT/boatattack_sim 핵심 로직

| 파일 | 역할 | 이식 대상 |
|------|------|----------|
| `env/config.py` | 시뮬레이션 설정 (SimConfig) | TypeScript로 변환 |
| `env/simulator.py` | 코어 시뮬레이션 로직 | TypeScript로 변환 |
| `env/formations.py` | 적 스폰 패턴 (집중/파상/양동) | TypeScript로 변환 |
| `env/kinematics.py` | 선박 운동학 | `usvSim.ts` 참조 |
| `env/grid.py` | 그물 격자 시스템 | **신규 구현** |
| `env/clustering.py` | 적 클러스터 분석 | TypeScript로 변환 |

---

## 2. 상태 구조 재설계

### 2.1 새로운 타입 정의 (`src/types/defense.ts`)

```typescript
// ── 선박 공통 상태 ──
export interface ShipState {
  id: number;
  x: number;           // ENU 좌표 (m)
  z: number;
  heading: number;     // deg, 0=북, 시계방향
  speed: number;       // m/s
  yawRate: number;     // deg/s
  alive: boolean;
}

// ── 아군 상태 (ShipState 확장) ──
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

// ── 적 상태 ──
export interface EnemyState extends ShipState {
  phase: number;        // 위빙 위상
  clusterId: number;    // 소속 클러스터
}

// ── 모선 상태 ──
export interface MothershipState {
  x: number;
  z: number;
  heading: number;
  radius: number;       // breach 반경 (260m)
}

// ── 그물 세그먼트 ──
export interface NetSegment {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  allyId: number;       // 설치한 아군
  installed: boolean;   // 완성 여부
}

// ── 클러스터 정보 ──
export interface ClusterInfo {
  id: number;
  centroidX: number;
  centroidZ: number;
  enemyIds: number[];
  threat: number;       // 위협도 (모선과의 거리 기반)
  spread: number;       // 분산도
}

// ── 웨이포인트 ──
export interface Waypoint {
  x: number;
  z: number;
  paint: boolean;       // 그물 구간 여부
  started: boolean;
  active: boolean;
}

// ── 시뮬레이션 통계 ──
export interface SimStats {
  captures: number;     // 포획된 적
  breaches: number;     // 돌파한 적
  allyCollisions: number;
  netsUsed: number;
  netTouches: number;   // 아군이 그물에 닿은 횟수
  survived: number;     // 잔존 적
}

// ── 적 공격 시나리오 ──
export type EnemyFormation =
  | "concentrated"    // 집중: 한 방위에서 10대 밀집
  | "diversionary"    // 양동: 3그룹으로 분산
  | "wave"            // 파상: 3단계 시차 공격
  | "random";         // 무작위
```

### 2.2 설정 상수 (`src/config/defense.ts`)

```typescript
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
  enemySpeed: 9,          // m/s (아군의 1.5배)
  enemyMaxTurn: 5,        // deg/s
  enemyWeaveAmp: 14,      // 위빙 진폭 (deg)
  enemyWeaveFreq: 1/32,   // 위빙 주파수 (Hz)
  enemyEvade: true,       // 그물 회피
  enemyEvadeLook: 500,    // 전방 탐지 거리
  enemyEvadeDeg: 32,      // 회피 조향각

  // ── 아군 ──
  nAllies: 3,
  allySpeed: 6,           // m/s
  allyMaxTurn: 8,         // deg/s
  allyRowGap: 550,        // 모선 후미 거리
  allySideSpacing: 330,   // 아군 간 횡간격

  // ── 그물 ──
  netsPerShip: 5,
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
} as const;
```

---

## 3. 핵심 시스템 구현

### 3.1 다중 선박 스토어 (`src/store.ts` 수정)

```typescript
import { create } from "zustand";
import type {
  AllyState, EnemyState, MothershipState,
  NetSegment, ClusterInfo, SimStats, EnemyFormation
} from "./types/defense";
import { DEFENSE_CONFIG as C } from "./config/defense";

interface DefenseStore {
  // ── 상태 ──
  allies: AllyState[];
  enemies: EnemyState[];
  mothership: MothershipState;
  nets: NetSegment[];
  netGrid: boolean[][];        // 격자 기반 그물 맵
  clusters: ClusterInfo[];
  stats: SimStats;

  // ── 제어 ──
  running: boolean;
  selectedAlly: number;
  formation: EnemyFormation;
  step: number;
  done: boolean;

  // ── 액션 ──
  reset: (formation?: EnemyFormation) => void;
  tick: (dt: number) => void;
  selectAlly: (id: number) => void;
  setAllyTarget: (allyId: number, x: number, z: number) => void;
  armNet: (allyId: number) => void;
  toggleRunning: () => void;
}

export const useDefenseStore = create<DefenseStore>((set, get) => ({
  // 초기값...
  allies: [],
  enemies: [],
  mothership: { ...C.mothership },
  nets: [],
  netGrid: Array(C.gridSize).fill(null).map(() =>
    Array(C.gridSize).fill(false)
  ),
  clusters: [],
  stats: { captures: 0, breaches: 0, allyCollisions: 0,
           netsUsed: 0, netTouches: 0, survived: 0 },
  running: true,
  selectedAlly: 0,
  formation: "diversionary",
  step: 0,
  done: false,

  reset: (formation = "diversionary") => {
    // 3.2절 참조
  },

  tick: (dt) => {
    // 3.3절 참조
  },

  // ... 기타 액션
}));
```

### 3.2 적 스폰 시스템 (`src/sim/formations.ts`)

```typescript
import { DEFENSE_CONFIG as C } from "../config/defense";
import type { EnemyState, EnemyFormation } from "../types/defense";

/**
 * 적 스폰 - MobRobGPT/boatattack_sim/env/formations.py 이식
 */
export function spawnEnemies(
  formation: EnemyFormation,
  rng: () => number = Math.random
): EnemyState[] {
  const center = C.worldSize / 2;
  const enemies: EnemyState[] = [];

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

    // 모선 방향으로 헤딩
    const headingToMother = Math.atan2(center - x, center - z) * 180 / Math.PI;

    enemies.push({
      id: i,
      x, z,
      heading: (headingToMother + 360) % 360,
      speed: C.enemySpeed,
      yawRate: 0,
      alive: true,
      phase: rng() * Math.PI * 2,
      clusterId: 0,  // 모두 같은 클러스터
    });
  }

  return enemies;
}

/** 양동 공격: 3그룹으로 분산 (예: 8:1:1 또는 4:3:3) */
function spawnDiversionary(rng: () => number): EnemyState[] {
  const center = C.worldSize / 2;
  const nGroups = 3;
  const bearings = [
    rng() * 360,
    (rng() * 360 + 120) % 360,
    (rng() * 360 + 240) % 360,
  ];

  // 그룹별 적 배분 (8:1:1 비율)
  const distribution = [8, 1, 1];
  const enemies: EnemyState[] = [];
  let id = 0;

  for (let g = 0; g < nGroups; g++) {
    const bearingRad = (bearings[g] * Math.PI) / 180;

    for (let i = 0; i < distribution[g]; i++) {
      const jitterX = (rng() - 0.5) * 2 * C.formations.groupJitter;
      const jitterZ = (rng() - 0.5) * 2 * C.formations.groupJitter;

      const x = center + Math.sin(bearingRad) * C.formations.spawnRadius + jitterX;
      const z = center - Math.cos(bearingRad) * C.formations.spawnRadius + jitterZ;
      const headingToMother = Math.atan2(center - x, center - z) * 180 / Math.PI;

      enemies.push({
        id: id++,
        x, z,
        heading: (headingToMother + 360) % 360,
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
      const headingToMother = Math.atan2(center - x, center - z) * 180 / Math.PI;

      enemies.push({
        id: id++,
        x, z,
        heading: (headingToMother + 360) % 360,
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
```

### 3.3 그물 시스템 (`src/sim/netSystem.ts`) - **핵심 신규 구현**

```typescript
import { DEFENSE_CONFIG as C } from "../config/defense";
import type { AllyState, NetSegment, EnemyState } from "../types/defense";

/**
 * 그물 격자 시스템
 * - 아군이 그물 WP 구간을 이동하면 경로를 따라 격자에 "칠함"
 * - 적이 칠해진 격자에 진입하면 포획
 */

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

/**
 * 그물 전개 업데이트
 * - ally가 그물 WP 구간을 이동 중이면 경로를 따라 격자를 칠함
 * - netWidth 만큼의 폭으로 띠(band)를 생성
 */
export function updateNetPainting(
  ally: AllyState,
  prevX: number,
  prevZ: number,
  netGrid: boolean[][],
  dt: number
): { netGrid: boolean[][]; netSegment: NetSegment | null } {
  if (!ally.painting || !ally.alive) {
    return { netGrid, netSegment: null };
  }

  const cellSize = C.worldSize / C.gridSize;
  const halfWidth = (C.netWidth * cellSize) / 2;

  // 이동 벡터
  const dx = ally.x - prevX;
  const dz = ally.z - prevZ;
  const dist = Math.hypot(dx, dz);

  if (dist < 0.1) return { netGrid, netSegment: null };

  // 수직 방향 (그물 폭 방향)
  const perpX = -dz / dist;
  const perpZ = dx / dist;

  // 이동 경로를 따라 격자 칠하기
  const steps = Math.ceil(dist / (cellSize * 0.5));
  const newGrid = netGrid.map(row => [...row]);

  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const cx = prevX + dx * t;
    const cz = prevZ + dz * t;

    // 폭 방향으로 여러 셀 칠하기
    for (let w = -C.netWidth / 2; w <= C.netWidth / 2; w++) {
      const wx = cx + perpX * w * cellSize;
      const wz = cz + perpZ * w * cellSize;
      const [gx, gz] = worldToGrid(wx, wz);
      newGrid[gz][gx] = true;
    }
  }

  // 전개 거리 누적
  const newPaintDist = ally.paintDist + dist;

  // 그물 길이 한계 도달 시 세그먼트 완성
  let netSegment: NetSegment | null = null;
  if (newPaintDist >= C.netMaxLen) {
    netSegment = {
      startX: ally.route.find(w => w.paint && w.started)?.x ?? ally.x,
      startZ: ally.route.find(w => w.paint && w.started)?.z ?? ally.z,
      endX: ally.x,
      endZ: ally.z,
      allyId: ally.id,
      installed: true,
    };
  }

  return { netGrid: newGrid, netSegment };
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

  // 전방 탐지
  for (let d = 50; d < lookDist; d += 30) {
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
```

### 3.4 아군 스폰 (`src/sim/formations.ts`에 추가)

```typescript
/** 아군 스폰: 모선 후미에 횡렬 배치 */
export function spawnAllies(): AllyState[] {
  const center = C.worldSize / 2;
  const allies: AllyState[] = [];

  // 모선 아래(남쪽)에 횡렬 배치
  const rowY = center + C.allyRowGap;  // z 좌표 (남쪽 = +z)
  const startX = center - ((C.nAllies - 1) * C.allySideSpacing) / 2;

  for (let i = 0; i < C.nAllies; i++) {
    allies.push({
      id: i,
      x: startX + i * C.allySideSpacing,
      z: rowY,
      heading: 180,           // 남쪽을 향함 (적을 바라봄)
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
```

---

## 4. 3D 렌더링 수정

### 4.1 다중 선박 씬 (`src/scene/Scene.tsx`)

```tsx
// 기존 단일 <Usv /> 대신:
import { AllyShip } from "./AllyShip";
import { EnemyShip } from "./EnemyShip";
import { Mothership } from "./Mothership";
import { NetMesh } from "./NetMesh";
import { useDefenseStore } from "../store";

export function Scene() {
  const allies = useDefenseStore((s) => s.allies);
  const enemies = useDefenseStore((s) => s.enemies);
  const mothership = useDefenseStore((s) => s.mothership);

  return (
    <Canvas ...>
      {/* 기존 요소들 */}
      <Ocean />

      {/* 모선 */}
      <Mothership state={mothership} />

      {/* 아군 (3대) */}
      {allies.map((ally) => (
        <AllyShip key={ally.id} state={ally} />
      ))}

      {/* 적 (10대) */}
      {enemies.map((enemy) => (
        <EnemyShip key={enemy.id} state={enemy} />
      ))}

      {/* 그물 메시 */}
      <NetMesh />

      {/* 클러스터 표시 (디버그) */}
      <ClusterOverlay />

      <FollowCamera />
    </Canvas>
  );
}
```

### 4.2 그물 렌더링 (`src/scene/NetMesh.tsx`) - **핵심 신규**

```tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { useDefenseStore } from "../store";
import { DEFENSE_CONFIG as C } from "../config/defense";

/**
 * 그물 시각화
 * 1. 설치 완료된 그물: 두꺼운 녹색 선 (Line2)
 * 2. 전개 중인 그물: 반투명 파란 선
 * 3. 격자 오버레이: 칠해진 셀 표시 (디버그 모드)
 */
export function NetMesh() {
  const nets = useDefenseStore((s) => s.nets);
  const netGrid = useDefenseStore((s) => s.netGrid);
  const allies = useDefenseStore((s) => s.allies);

  return (
    <group name="nets">
      {/* 설치 완료된 그물 세그먼트 */}
      {nets.filter(n => n.installed).map((net, i) => (
        <InstalledNet key={i} net={net} />
      ))}

      {/* 전개 중인 그물 (아군별) */}
      {allies.filter(a => a.painting && a.alive).map((ally) => (
        <DeployingNet key={`deploy-${ally.id}`} ally={ally} />
      ))}

      {/* 격자 오버레이 (선택적) */}
      <GridOverlay netGrid={netGrid} />
    </group>
  );
}

/** 설치 완료 그물 - 두꺼운 녹색 선 */
function InstalledNet({ net }: { net: NetSegment }) {
  const lineRef = useRef<Line2>(null);

  const { geometry, material } = useMemo(() => {
    const geom = new LineGeometry();
    geom.setPositions([
      net.startX - C.worldSize/2, 0.5, net.startZ - C.worldSize/2,
      net.endX - C.worldSize/2, 0.5, net.endZ - C.worldSize/2,
    ]);

    const mat = new LineMaterial({
      color: 0x00ff00,
      linewidth: 8,           // 월드 단위 두께
      worldUnits: true,
      transparent: true,
      opacity: 0.85,
    });

    return { geometry: geom, material: mat };
  }, [net]);

  return <primitive ref={lineRef} object={new Line2(geometry, material)} />;
}

/** 전개 중 그물 - 반투명 파란 선 */
function DeployingNet({ ally }: { ally: AllyState }) {
  const paintStart = ally.route.find(w => w.paint && w.started);
  if (!paintStart) return null;

  const positions = [
    paintStart.x - C.worldSize/2, 0.3, paintStart.z - C.worldSize/2,
    ally.x - C.worldSize/2, 0.3, ally.z - C.worldSize/2,
  ];

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={new Float32Array(positions)}
          count={2}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial color={0x00aaff} transparent opacity={0.6} />
    </line>
  );
}

/** 격자 오버레이 - 칠해진 셀을 반투명 평면으로 표시 */
function GridOverlay({ netGrid }: { netGrid: boolean[][] }) {
  const cellSize = C.worldSize / C.gridSize;
  const offset = C.worldSize / 2;

  // 칠해진 셀만 수집
  const filledCells: [number, number][] = [];
  for (let gz = 0; gz < C.gridSize; gz++) {
    for (let gx = 0; gx < C.gridSize; gx++) {
      if (netGrid[gz][gx]) {
        filledCells.push([gx, gz]);
      }
    }
  }

  if (filledCells.length === 0) return null;

  // InstancedMesh로 효율적 렌더링
  return (
    <instancedMesh args={[undefined, undefined, filledCells.length]}>
      <planeGeometry args={[cellSize * 0.9, cellSize * 0.9]} />
      <meshBasicMaterial
        color={0x00ff00}
        transparent
        opacity={0.3}
        side={THREE.DoubleSide}
      />
      {filledCells.map(([gx, gz], i) => {
        const x = (gx + 0.5) * cellSize - offset;
        const z = (gz + 0.5) * cellSize - offset;
        return (
          <group key={i} position={[x, 0.1, z]} rotation={[-Math.PI/2, 0, 0]}>
            {/* InstancedMesh 대신 개별 메시 (단순화) */}
          </group>
        );
      })}
    </instancedMesh>
  );
}
```

### 4.3 적 선박 렌더링 (`src/scene/EnemyShip.tsx`)

```tsx
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { EnemyState } from "../types/defense";
import { DEFENSE_CONFIG as C } from "../config/defense";

export function EnemyShip({ state }: { state: EnemyState }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const offset = C.worldSize / 2;

  useFrame(() => {
    if (!meshRef.current || !state.alive) return;

    meshRef.current.position.set(
      state.x - offset,
      0.5,
      state.z - offset
    );
    meshRef.current.rotation.y = -state.heading * Math.PI / 180;
    meshRef.current.visible = state.alive;
  });

  if (!state.alive) return null;

  return (
    <mesh ref={meshRef} castShadow>
      {/* 적 선박 모델 (임시 박스) */}
      <boxGeometry args={[8, 2, 20]} />
      <meshStandardMaterial color={0xff4444} metalness={0.3} roughness={0.7} />

      {/* 클러스터 ID 표시 (색상으로) */}
      <mesh position={[0, 2, 0]}>
        <sphereGeometry args={[1.5]} />
        <meshBasicMaterial color={getClusterColor(state.clusterId)} />
      </mesh>
    </mesh>
  );
}

function getClusterColor(clusterId: number): number {
  const colors = [0xff0000, 0x00ff00, 0x0000ff, 0xffff00];
  return colors[clusterId % colors.length];
}
```

### 4.4 모선 렌더링 (`src/scene/Mothership.tsx`)

```tsx
import { useRef } from "react";
import * as THREE from "three";
import type { MothershipState } from "../types/defense";
import { DEFENSE_CONFIG as C } from "../config/defense";

export function Mothership({ state }: { state: MothershipState }) {
  const offset = C.worldSize / 2;

  return (
    <group position={[state.x - offset, 0, state.z - offset]}>
      {/* 항공모함 모델 (임시) */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[80, 15, 300]} />
        <meshStandardMaterial color={0x444466} metalness={0.5} roughness={0.5} />
      </mesh>

      {/* 갑판 */}
      <mesh position={[0, 8, 0]}>
        <boxGeometry args={[75, 1, 290]} />
        <meshStandardMaterial color={0x333344} />
      </mesh>

      {/* breach 반경 표시 (반투명 원) */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, 0.2, 0]}>
        <ringGeometry args={[state.radius - 5, state.radius, 64]} />
        <meshBasicMaterial color={0xff0000} transparent opacity={0.2} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
```

---

## 5. 시뮬레이션 루프 수정

### 5.1 메인 틱 함수 (`src/store.ts`의 `tick`)

```typescript
tick: (dt) => {
  const state = get();
  if (!state.running || state.done) return;

  const newStep = state.step + 1;
  const center = C.worldSize / 2;

  // ── 1. 적 이동 ──
  const newEnemies = state.enemies.map(enemy => {
    if (!enemy.alive) return enemy;

    // 위빙 + 모선 방향
    const toMotherX = center - enemy.x;
    const toMotherZ = center - enemy.z;
    const targetHeading = Math.atan2(toMotherX, -toMotherZ) * 180 / Math.PI;
    const weave = C.enemyWeaveAmp * Math.sin(enemy.phase + newStep * C.enemyWeaveFreq * 2 * Math.PI);

    // 그물 회피
    const evadeDelta = evadeNet(enemy, state.netGrid, state.mothership);

    let desiredHeading = targetHeading + weave + evadeDelta;
    let headingDiff = ((desiredHeading - enemy.heading + 540) % 360) - 180;
    headingDiff = Math.max(-C.enemyMaxTurn * dt * 60,
                           Math.min(C.enemyMaxTurn * dt * 60, headingDiff));

    const newHeading = (enemy.heading + headingDiff + 360) % 360;
    const headingRad = newHeading * Math.PI / 180;

    return {
      ...enemy,
      heading: newHeading,
      x: enemy.x + Math.sin(headingRad) * enemy.speed * dt,
      z: enemy.z - Math.cos(headingRad) * enemy.speed * dt,
    };
  });

  // ── 2. 적 포획/돌파 체크 ──
  let captures = state.stats.captures;
  let breaches = state.stats.breaches;

  const finalEnemies = newEnemies.map(enemy => {
    if (!enemy.alive) return enemy;

    // 포획 체크
    if (checkCapture(enemy, state.netGrid)) {
      captures++;
      return { ...enemy, alive: false };
    }

    // 돌파 체크
    const distToMother = Math.hypot(enemy.x - center, enemy.z - center);
    if (distToMother < state.mothership.radius) {
      breaches++;
      return { ...enemy, alive: false };
    }

    return enemy;
  });

  // ── 3. 아군 이동 + 그물 전개 ──
  let newNetGrid = state.netGrid;
  let newNets = [...state.nets];

  const newAllies = state.allies.map(ally => {
    if (!ally.alive) return ally;

    const prevX = ally.x;
    const prevZ = ally.z;

    // 경로 추종 (PD 제어) - 간략화
    const updated = stepAlly(ally, dt);

    // 그물 전개 업데이트
    if (updated.painting) {
      const { netGrid: updatedGrid, netSegment } = updateNetPainting(
        updated, prevX, prevZ, newNetGrid, dt
      );
      newNetGrid = updatedGrid;
      if (netSegment) {
        newNets.push(netSegment);
      }
    }

    return updated;
  });

  // ── 4. 종료 조건 ──
  const aliveEnemies = finalEnemies.filter(e => e.alive).length;
  const done = aliveEnemies === 0 || newStep >= 2000;

  set({
    enemies: finalEnemies,
    allies: newAllies,
    netGrid: newNetGrid,
    nets: newNets,
    step: newStep,
    done,
    stats: {
      ...state.stats,
      captures,
      breaches,
      survived: done ? aliveEnemies : state.stats.survived,
    },
  });
},
```

---

## 6. UI 수정

### 6.1 HUD 확장 (`src/ui/Hud.tsx`)

```tsx
export function Hud() {
  const stats = useDefenseStore((s) => s.stats);
  const step = useDefenseStore((s) => s.step);
  const formation = useDefenseStore((s) => s.formation);
  const allies = useDefenseStore((s) => s.allies);
  const enemies = useDefenseStore((s) => s.enemies);

  const aliveEnemies = enemies.filter(e => e.alive).length;
  const aliveAllies = allies.filter(a => a.alive).length;

  return (
    <div className="hud">
      {/* 상단: 시나리오 + 시간 */}
      <div className="hud-top">
        <span>시나리오: {FORMATION_NAMES[formation]}</span>
        <span>Step: {step}</span>
      </div>

      {/* 중앙: 전황 */}
      <div className="hud-center">
        <div className="stat good">포획: {stats.captures}</div>
        <div className="stat bad">돌파: {stats.breaches}</div>
        <div className="stat">적 잔존: {aliveEnemies}/10</div>
        <div className="stat">아군: {aliveAllies}/3</div>
      </div>

      {/* 하단: 아군 상태 */}
      <div className="hud-bottom">
        {allies.map(ally => (
          <AllyStatus key={ally.id} ally={ally} />
        ))}
      </div>

      {/* 시나리오 선택 */}
      <FormationSelector />
    </div>
  );
}

const FORMATION_NAMES: Record<EnemyFormation, string> = {
  concentrated: "집중 공격",
  diversionary: "양동 공격",
  wave: "파상 공격",
  random: "무작위",
};
```

---

## 7. 구현 우선순위 (단계별)

### Phase 1: 기본 구조 (1-2일)
1. [ ] `types/defense.ts` 타입 정의
2. [ ] `config/defense.ts` 설정 상수
3. [ ] 스토어 구조 변경 (`store.ts`)
4. [ ] 기본 시뮬레이션 루프

### Phase 2: 선박 시스템 (2-3일)
1. [ ] 적 스폰 (`formations.ts`)
2. [ ] 아군 스폰 및 이동
3. [ ] 적 AI (위빙, 모선 추적)
4. [ ] 충돌/돌파 판정

### Phase 3: 그물 시스템 (3-4일) ⭐ 핵심
1. [ ] 격자 시스템 (`netSystem.ts`)
2. [ ] 그물 전개 로직
3. [ ] 포획 판정
4. [ ] 그물 회피 AI

### Phase 4: 렌더링 (2-3일)
1. [ ] 다중 선박 렌더링
2. [ ] 모선 렌더링
3. [ ] 그물 시각화 (Line2 + 격자)
4. [ ] 클러스터 오버레이

### Phase 5: UI/UX (1-2일)
1. [ ] HUD 확장
2. [ ] 시나리오 선택
3. [ ] 아군 수동 조작
4. [ ] 디버그 오버레이

---

## 8. 테스트 체크리스트

- [ ] 10대 적이 정상 스폰되는가?
- [ ] 3대 아군이 정상 스폰되는가?
- [ ] 적이 모선을 향해 이동하는가?
- [ ] 위빙이 정상 작동하는가?
- [ ] 그물 전개 시 격자가 칠해지는가?
- [ ] 적이 그물에 닿으면 포획되는가?
- [ ] 적이 모선에 닿으면 돌파로 처리되는가?
- [ ] 집중/파상/양동 시나리오가 구분되는가?
- [ ] 그물 회피 AI가 작동하는가?
- [ ] 포획/돌파 통계가 정확한가?

---

## 9. 참고 자료

- **MobRobGPT 코드**: `/home/yune/민철_UI/MobRobGPT/`
  - `boatattack_sim/env/config.py` - 설정 원본
  - `boatattack_sim/env/simulator.py` - 시뮬레이션 로직
  - `boatattack_sim/env/formations.py` - 적 스폰 패턴
  - `boatattack_sim/env/grid.py` - 격자 시스템

- **One-Way_Towing 코드**: `/home/yune/One-Way_Towing/`
  - `boatattack_sim/env/` - 전체 환경 모듈

- **Three.js Line2**: 두꺼운 선 렌더링용
  - `LineGeometry`, `LineMaterial`, `Line2`

---

## 10. ROS2 통합 (oneway_ros2)

> **목적**: 실제 센서(GPS/IMU)와 명령(WP 발행)을 ROS2로 연동
> - 참조: `/home/yune/ros2_ws/src/oneway_ros2/`

### 10.1 아키텍처 개요

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USV Simulator (브라우저)                     │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐       │
│  │  3D Scene     │    │  Defense Store │    │  WebSocket    │       │
│  │  (Three.js)   │◄──►│  (Zustand)     │◄──►│  Client       │       │
│  └───────────────┘    └───────────────┘    └───────┬───────┘       │
└──────────────────────────────────────────────────────│──────────────┘
                                                       │ ws://9001
                                                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    WebSocket Bridge (Node.js)                        │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐       │
│  │  MQTT Client  │    │  ROS2 Bridge  │    │  GeoBridge    │       │
│  │  (mqtt.js)    │◄──►│  (rclnodejs)  │◄──►│  (좌표변환)   │       │
│  └───────────────┘    └───────────────┘    └───────────────┘       │
└───────────────────────────────────────────────────────│─────────────┘
                                                        │ ROS2 DDS
                                                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ROS2 Network                                 │
│  ┌───────────────┐    ┌───────────────┐    ┌───────────────┐       │
│  │  GPS Nodes    │    │  IMU Nodes    │    │  USV Control  │       │
│  │  (NavSatFix)  │    │  (Imu)        │    │  (Path)       │       │
│  └───────────────┘    └───────────────┘    └───────────────┘       │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 ROS2 토픽 구조

| 토픽 | 메시지 타입 | 방향 | 설명 |
|------|-------------|------|------|
| `/ally{i}/gps` | `sensor_msgs/NavSatFix` | 구독 | 아군 i GPS |
| `/ally{i}/imu` | `sensor_msgs/Imu` | 구독 | 아군 i IMU (heading) |
| `/enemy{i}/gps` | `sensor_msgs/NavSatFix` | 구독 | 적 i GPS |
| `/mothership/gps` | `sensor_msgs/NavSatFix` | 구독 | 모선 GPS |
| `/ally{i}/waypoints` | `nav_msgs/Path` | 발행 | 아군 i 경로 명령 |
| `/ally{i}/net_deploy` | `std_msgs/Bool` | 발행 | 그물 전개 명령 |
| `/defense/stats` | `custom_msgs/DefenseStats` | 발행 | 포획/돌파 통계 |

### 10.3 GeoBridge (좌표 변환) 이식

oneway_ros2의 `geo_bridge.py`를 TypeScript로 이식:

```typescript
// src/geo/GeoBridge.ts
export class GeoBridge {
  private worldSize: number;
  private targetSimRadius: number;
  private originLat: number = 0;
  private originLon: number = 0;
  private scale: number = 1;
  private simCenter: [number, number];
  private fitted: boolean = false;

  constructor(worldSize: number = 12600, targetSimRadius: number = 5450) {
    this.worldSize = worldSize;
    this.targetSimRadius = targetSimRadius;
    this.simCenter = [worldSize / 2, worldSize / 2];
  }

  /**
   * t=0에 affine 변환 파라미터 결정
   * - 모선을 기준점으로
   * - 가장 먼 적의 거리를 targetSimRadius에 매핑
   */
  fit(
    alliesGeo: [number, number][],  // [lat, lon][]
    enemiesGeo: [number, number][],
    mothershipGeo: [number, number]
  ): void {
    this.originLat = mothershipGeo[0];
    this.originLon = mothershipGeo[1];

    // 적들의 ENU 좌표 계산
    const enemiesEnu = enemiesGeo.map(([lat, lon]) =>
      this.gpsToEnu(lat, lon)
    );

    // 적의 최대 거리
    const dMax = Math.max(
      1000,  // 최소값 (과확대 방지)
      ...enemiesEnu.map(([e, n]) => Math.hypot(e, n))
    );

    // 스케일: 적을 targetSimRadius에 매핑
    this.scale = Math.max(0.5, Math.min(2.0,
      this.targetSimRadius / dMax
    ));

    this.fitted = true;
    console.log(`[GeoBridge] fit: scale=${this.scale.toFixed(4)}, dMax=${dMax.toFixed(1)}m`);
  }

  /** GPS → ENU (미터) */
  private gpsToEnu(lat: number, lon: number): [number, number] {
    const dNorth = (lat - this.originLat) * 111320;
    const dEast = (lon - this.originLon) * 111320 * Math.cos(this.originLat * Math.PI / 180);
    return [dEast, dNorth];
  }

  /** ENU → GPS */
  private enuToGps(east: number, north: number): [number, number] {
    const lat = this.originLat + north / 111320;
    const lon = this.originLon + east / (111320 * Math.cos(this.originLat * Math.PI / 180));
    return [lat, lon];
  }

  /** GPS → 시뮬 좌표 */
  toSim(lat: number, lon: number): [number, number] {
    if (!this.fitted) throw new Error("fit()을 먼저 호출하세요");
    const [e, n] = this.gpsToEnu(lat, lon);
    const x = this.simCenter[0] + e * this.scale;
    const z = this.simCenter[1] - n * this.scale;  // z는 남쪽이 +
    return [
      Math.max(0, Math.min(this.worldSize, x)),
      Math.max(0, Math.min(this.worldSize, z)),
    ];
  }

  /** 시뮬 좌표 → GPS */
  toGeo(x: number, z: number): [number, number] {
    if (!this.fitted) throw new Error("fit()을 먼저 호출하세요");
    const east = (x - this.simCenter[0]) / this.scale;
    const north = -(z - this.simCenter[1]) / this.scale;
    return this.enuToGps(east, north);
  }

  /** ENU yaw → 시뮬 heading (nav 규약: 0=North, CW+) */
  hdgToSim(yawEnuDeg: number): number {
    return (90 - yawEnuDeg + 360) % 360;
  }

  get isFitted(): boolean { return this.fitted; }
  get worldScale(): number { return this.scale; }
}
```

### 10.4 WorldState 동기화

```typescript
// src/ros2/WorldState.ts
import { GeoBridge } from "../geo/GeoBridge";

interface AgentGeoState {
  lat: number;
  lon: number;
  yawEnuDeg: number;
  lastUpdate: number;
}

export class WorldState {
  private allies: AgentGeoState[] = [];
  private enemies: AgentGeoState[] = [];
  private mothership: { lat: number; lon: number } = { lat: 0, lon: 0 };
  private geoBridge: GeoBridge;
  private fitted = false;

  constructor(nAllies: number, nEnemies: number, geoBridge: GeoBridge) {
    this.geoBridge = geoBridge;
    this.allies = Array(nAllies).fill(null).map(() => ({
      lat: 0, lon: 0, yawEnuDeg: 0, lastUpdate: 0
    }));
    this.enemies = Array(nEnemies).fill(null).map(() => ({
      lat: 0, lon: 0, yawEnuDeg: 0, lastUpdate: 0
    }));
  }

  /** ROS2 콜백에서 호출 */
  updateAlly(idx: number, lat: number, lon: number, yawEnuDeg: number) {
    if (idx >= 0 && idx < this.allies.length) {
      this.allies[idx] = { lat, lon, yawEnuDeg, lastUpdate: Date.now() };
    }
  }

  updateEnemy(idx: number, lat: number, lon: number, yawEnuDeg: number = 0) {
    if (idx >= 0 && idx < this.enemies.length) {
      this.enemies[idx] = { lat, lon, yawEnuDeg, lastUpdate: Date.now() };
    }
  }

  updateMothership(lat: number, lon: number) {
    this.mothership = { lat, lon };
  }

  /** 첫 데이터 수신 후 GeoBridge 초기화 */
  fitGeoBridge(): boolean {
    const alliesGeo = this.allies.map(a => [a.lat, a.lon] as [number, number]);
    const enemiesGeo = this.enemies.filter(e => e.lastUpdate > 0)
      .map(e => [e.lat, e.lon] as [number, number]);

    if (enemiesGeo.length === 0) return false;

    this.geoBridge.fit(alliesGeo, enemiesGeo,
      [this.mothership.lat, this.mothership.lon]);
    this.fitted = true;
    return true;
  }

  /** 시뮬레이션 좌표로 변환된 스냅샷 */
  getSimSnapshot() {
    if (!this.fitted) return null;

    return {
      allies: this.allies.map((a, i) => ({
        id: i,
        ...this.geoBridge.toSim(a.lat, a.lon).reduce((acc, v, j) =>
          ({ ...acc, [j === 0 ? 'x' : 'z']: v }), {}),
        heading: this.geoBridge.hdgToSim(a.yawEnuDeg),
      })),
      enemies: this.enemies.map((e, i) => ({
        id: i,
        ...this.geoBridge.toSim(e.lat, e.lon).reduce((acc, v, j) =>
          ({ ...acc, [j === 0 ? 'x' : 'z']: v }), {}),
        heading: this.geoBridge.hdgToSim(e.yawEnuDeg),
      })),
      mothership: {
        ...this.geoBridge.toSim(this.mothership.lat, this.mothership.lon)
          .reduce((acc, v, j) => ({ ...acc, [j === 0 ? 'x' : 'z']: v }), {}),
      },
    };
  }
}
```

### 10.5 WebSocket 브리지 확장

```typescript
// src/ros2/RosBridge.ts (Node.js 서버 측)

// rclnodejs 사용 (https://github.com/nicoscore/rclnodejs)
import * as rclnodejs from 'rclnodejs';
import { WebSocketServer } from 'ws';

class RosBridgeServer {
  private node: rclnodejs.Node;
  private wss: WebSocketServer;
  private worldState: WorldState;

  async init() {
    await rclnodejs.init();
    this.node = new rclnodejs.Node('usv_sim_bridge');

    // 아군 GPS 구독
    for (let i = 0; i < 3; i++) {
      this.node.createSubscription(
        'sensor_msgs/msg/NavSatFix',
        `/ally${i}/gps`,
        (msg) => this.onAllyGps(i, msg)
      );
    }

    // 적 GPS 구독
    for (let i = 0; i < 10; i++) {
      this.node.createSubscription(
        'sensor_msgs/msg/NavSatFix',
        `/enemy${i}/gps`,
        (msg) => this.onEnemyGps(i, msg)
      );
    }

    // WP 발행자
    this.wpPublishers = [];
    for (let i = 0; i < 3; i++) {
      this.wpPublishers.push(
        this.node.createPublisher('nav_msgs/msg/Path', `/ally${i}/waypoints`)
      );
    }

    rclnodejs.spin(this.node);
  }

  onAllyGps(idx: number, msg: any) {
    this.worldState.updateAlly(idx, msg.latitude, msg.longitude, 0);
    this.broadcastToClients();
  }

  onEnemyGps(idx: number, msg: any) {
    this.worldState.updateEnemy(idx, msg.latitude, msg.longitude);
    this.broadcastToClients();
  }

  /** 시뮬레이터에서 WP 명령 수신 → ROS2 발행 */
  publishWaypoints(allyId: number, waypoints: { lat: number; lon: number }[]) {
    const path = {
      header: { frame_id: 'map', stamp: this.node.now() },
      poses: waypoints.map(wp => ({
        header: { frame_id: 'map' },
        pose: {
          position: { x: wp.lon, y: wp.lat, z: 0 },
          orientation: { x: 0, y: 0, z: 0, w: 1 }
        }
      }))
    };
    this.wpPublishers[allyId].publish(path);
  }
}
```

---

## 11. 동적 스케일링 (위경도 기반)

> **목적**: 5km 고정값이 아닌, 실제 GPS 데이터 기반 동적 맵 스케일링

### 11.1 핵심 원리

```
1. 초기화 시 (t=0):
   - 모선 GPS를 원점으로 설정
   - 가장 먼 적의 GPS 거리(d_max) 계산
   - scale = targetSimRadius / d_max

2. 런타임:
   - 모든 GPS 좌표를 scale로 변환
   - 시뮬 좌표 ↔ GPS 양방향 변환 가능
```

### 11.2 설정 구조 변경

```typescript
// src/config/defense.ts
export const DEFENSE_CONFIG = {
  // ── 동적 스케일링 ──
  scaling: {
    targetSimRadius: 5450,  // 시뮬에서 적의 목표 거리
    scaleMin: 0.5,          // 최소 스케일 (과축소 방지)
    scaleMax: 2.0,          // 최대 스케일 (과확대 방지)
    dMinFloor: 1000,        // 적 최소 거리 (m)
  },

  // ── 격자 ──
  grid: {
    // 월드 크기는 scale에 따라 동적 결정
    // gridSize는 고정 (상대적 해상도 유지)
    gridSize: 200,
    // cellSize = worldSize / gridSize (동적)
  },

  // ... 기타 설정 (n_allies, n_enemies 등)
} as const;
```

### 11.3 정규화된 좌표계

모든 내부 계산은 정규화된 좌표 [-1, 1] 범위에서 수행:

```typescript
// src/sim/normalizedCoords.ts

export class NormalizedCoordSystem {
  private worldSize: number;
  private center: number;

  constructor(worldSize: number) {
    this.worldSize = worldSize;
    this.center = worldSize / 2;
  }

  /** 시뮬 좌표 → 정규화 [-1, 1] */
  toNormalized(x: number, z: number): [number, number] {
    return [
      (x - this.center) / this.center,
      (z - this.center) / this.center,
    ];
  }

  /** 정규화 → 시뮬 좌표 */
  fromNormalized(nx: number, nz: number): [number, number] {
    return [
      nx * this.center + this.center,
      nz * this.center + this.center,
    ];
  }

  /** 정규화된 거리 → 실제 거리 (m) */
  denormalizeDistance(nd: number): number {
    return nd * this.center;
  }

  /** 실제 거리 → 정규화된 거리 */
  normalizeDistance(d: number): number {
    return d / this.center;
  }
}
```

### 11.4 적응형 격자

```typescript
// src/sim/adaptiveGrid.ts

export function createAdaptiveGrid(
  enemies: EnemyState[],
  mothership: MothershipState,
  geoBridge: GeoBridge
): {
  worldSize: number;
  gridSize: number;
  cellSize: number;
  netGrid: boolean[][];
} {
  // 가장 먼 적 기준으로 월드 크기 결정
  const maxDist = Math.max(
    ...enemies.map(e => Math.hypot(
      e.x - mothership.x,
      e.z - mothership.z
    ))
  );

  // 월드 크기 = 최대 거리 × 2.2 (여유)
  const worldSize = Math.ceil(maxDist * 2.2 / 100) * 100;

  // 격자는 200 고정 (상대 해상도 유지)
  const gridSize = 200;
  const cellSize = worldSize / gridSize;

  return {
    worldSize,
    gridSize,
    cellSize,
    netGrid: Array(gridSize).fill(null).map(() =>
      Array(gridSize).fill(false)
    ),
  };
}
```

---

## 12. 페이지 분리 (Multi-Page)

> **목적**: 전체 맵 뷰 / 3D 시뮬 뷰 / 통계 뷰 분리

### 12.1 라우팅 구조

```
/                   → 메인 대시보드 (시나리오 선택)
/sim                → 3D 시뮬레이션 뷰 (기존 Scene)
/map                → 2D 전체 맵 뷰 (새 페이지)
/stats              → 통계/분석 뷰 (새 페이지)
/settings           → 설정 (시뮬 파라미터)
```

### 12.2 React Router 설정

```typescript
// src/main.tsx
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { Dashboard } from "./pages/Dashboard";
import { SimPage } from "./pages/SimPage";
import { MapPage } from "./pages/MapPage";
import { StatsPage } from "./pages/StatsPage";

const router = createBrowserRouter([
  { path: "/", element: <Dashboard /> },
  { path: "/sim", element: <SimPage /> },
  { path: "/map", element: <MapPage /> },
  { path: "/stats", element: <StatsPage /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <RouterProvider router={router} />
);
```

### 12.3 2D 맵 페이지 (`src/pages/MapPage.tsx`)

```tsx
import { useEffect, useRef } from "react";
import { useDefenseStore } from "../store";
import { DEFENSE_CONFIG as C } from "../config/defense";

export function MapPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const allies = useDefenseStore((s) => s.allies);
  const enemies = useDefenseStore((s) => s.enemies);
  const mothership = useDefenseStore((s) => s.mothership);
  const netGrid = useDefenseStore((s) => s.netGrid);
  const clusters = useDefenseStore((s) => s.clusters);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    const animate = () => {
      // 배경
      ctx.fillStyle = "#001428";
      ctx.fillRect(0, 0, W, H);

      const scale = W / C.worldSize;
      const toCanvas = (x: number, z: number) => [x * scale, z * scale];

      // 격자선
      ctx.strokeStyle = "#0a2540";
      ctx.lineWidth = 0.5;
      for (let i = 0; i <= C.gridSize; i += 20) {
        const [px] = toCanvas(i * C.worldSize / C.gridSize, 0);
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, H);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, px);
        ctx.lineTo(W, px);
        ctx.stroke();
      }

      // 그물 (녹색 셀)
      ctx.fillStyle = "rgba(0, 255, 0, 0.3)";
      const cellSize = C.worldSize / C.gridSize;
      for (let gz = 0; gz < C.gridSize; gz++) {
        for (let gx = 0; gx < C.gridSize; gx++) {
          if (netGrid[gz]?.[gx]) {
            const [cx, cz] = toCanvas(gx * cellSize, gz * cellSize);
            ctx.fillRect(cx, cz, cellSize * scale, cellSize * scale);
          }
        }
      }

      // 모선 (파란 원)
      const [mx, mz] = toCanvas(mothership.x, mothership.z);
      ctx.fillStyle = "#0066cc";
      ctx.beginPath();
      ctx.arc(mx, mz, 15, 0, Math.PI * 2);
      ctx.fill();

      // breach 반경
      ctx.strokeStyle = "rgba(255, 0, 0, 0.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, mz, mothership.radius * scale, 0, Math.PI * 2);
      ctx.stroke();

      // 적 (빨간 삼각형)
      enemies.forEach(enemy => {
        if (!enemy.alive) return;
        const [ex, ez] = toCanvas(enemy.x, enemy.z);
        ctx.fillStyle = getClusterColor(enemy.clusterId);
        ctx.save();
        ctx.translate(ex, ez);
        ctx.rotate((enemy.heading * Math.PI) / 180);
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(-5, 8);
        ctx.lineTo(5, 8);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      // 아군 (초록 사각형)
      allies.forEach(ally => {
        if (!ally.alive) return;
        const [ax, az] = toCanvas(ally.x, ally.z);
        ctx.fillStyle = "#00ff00";
        ctx.save();
        ctx.translate(ax, az);
        ctx.rotate((ally.heading * Math.PI) / 180);
        ctx.fillRect(-6, -10, 12, 20);
        ctx.restore();

        // 경로 표시
        if (ally.route.length > 0) {
          ctx.strokeStyle = "rgba(0, 255, 0, 0.4)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax, az);
          ally.route.forEach(wp => {
            const [wx, wz] = toCanvas(wp.x, wp.z);
            ctx.lineTo(wx, wz);
          });
          ctx.stroke();
        }
      });

      // 클러스터 중심 표시
      clusters.forEach((cluster, i) => {
        const [cx, cz] = toCanvas(cluster.centroidX, cluster.centroidZ);
        ctx.strokeStyle = getClusterColor(i);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cz, 20, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = "#fff";
        ctx.font = "12px monospace";
        ctx.fillText(`C${i}`, cx - 6, cz + 4);
      });

      requestAnimationFrame(animate);
    };

    animate();
  }, [allies, enemies, mothership, netGrid, clusters]);

  return (
    <div className="map-page">
      <h1>전술 맵</h1>
      <canvas ref={canvasRef} width={800} height={800} />
      <div className="legend">
        <span className="ally">■ 아군 (3)</span>
        <span className="enemy">▲ 적 (10)</span>
        <span className="mother">● 모선</span>
        <span className="net">□ 그물</span>
      </div>
    </div>
  );
}

function getClusterColor(id: number): string {
  const colors = ["#ff4444", "#44ff44", "#4444ff", "#ffff44"];
  return colors[id % colors.length];
}
```

### 12.4 통계 페이지 (`src/pages/StatsPage.tsx`)

```tsx
import { useDefenseStore } from "../store";
import { useMemo } from "react";

export function StatsPage() {
  const stats = useDefenseStore((s) => s.stats);
  const step = useDefenseStore((s) => s.step);
  const enemies = useDefenseStore((s) => s.enemies);
  const allies = useDefenseStore((s) => s.allies);

  const analysis = useMemo(() => {
    const aliveEnemies = enemies.filter(e => e.alive).length;
    const captureRate = stats.captures / (stats.captures + stats.breaches || 1);

    return {
      aliveEnemies,
      captureRate: (captureRate * 100).toFixed(1),
      avgNetUsage: stats.netsUsed / (step / 100 || 1),
    };
  }, [stats, step, enemies]);

  return (
    <div className="stats-page">
      <h1>방어 통계</h1>

      <div className="stat-grid">
        <StatCard title="포획" value={stats.captures} good />
        <StatCard title="돌파" value={stats.breaches} bad />
        <StatCard title="포획률" value={`${analysis.captureRate}%`} />
        <StatCard title="잔존 적" value={analysis.aliveEnemies} />
        <StatCard title="아군 충돌" value={stats.allyCollisions} bad={stats.allyCollisions > 0} />
        <StatCard title="그물 사용" value={stats.netsUsed} />
        <StatCard title="그물 접촉" value={stats.netTouches} bad={stats.netTouches > 0} />
        <StatCard title="경과 시간" value={`${(step / 60).toFixed(1)}s`} />
      </div>

      <div className="timeline">
        <h2>시간별 추이</h2>
        {/* 포획/돌파 그래프 */}
      </div>
    </div>
  );
}

function StatCard({ title, value, good, bad }: {
  title: string;
  value: number | string;
  good?: boolean;
  bad?: boolean;
}) {
  const className = `stat-card ${good ? "good" : ""} ${bad ? "bad" : ""}`;
  return (
    <div className={className}>
      <div className="title">{title}</div>
      <div className="value">{value}</div>
    </div>
  );
}
```

---

## 13. 추가 의존성

```json
// package.json에 추가
{
  "dependencies": {
    "react-router-dom": "^7.x",
    "three": "^0.185.x",
    "@react-three/fiber": "^9.x",
    "@react-three/drei": "^10.x"
  },
  "devDependencies": {
    "@types/three": "^0.185.x"
  }
}
```

ROS2 브리지 (별도 Node.js 프로젝트):
```json
{
  "dependencies": {
    "rclnodejs": "^0.27.x",
    "ws": "^8.x"
  }
}
```

---

## 14. 구현 우선순위 (갱신)

### Phase 1: 기본 구조 (1-2일)
- [x] 타입 정의, 설정 상수 ✅

### Phase 2: 선박 시스템 (2-3일)
- [ ] 적/아군 스폰 + 이동

### Phase 3: 그물 시스템 (3-4일) ⭐
- [ ] 격자 + 포획 판정

### Phase 4: 렌더링 (2-3일)
- [ ] 다중 선박 + 그물 시각화

### Phase 5: 동적 스케일링 (1-2일) 🆕
- [ ] GeoBridge 이식
- [ ] 적응형 격자

### Phase 6: 페이지 분리 (1-2일) 🆕
- [ ] React Router 설정
- [ ] 2D 맵 페이지
- [ ] 통계 페이지

### Phase 7: ROS2 통합 (2-3일) 🆕
- [ ] WebSocket 브리지
- [ ] rclnodejs 연동
- [ ] 실시간 GPS 수신
