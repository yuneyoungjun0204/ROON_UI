// ─────────────────────────────────────────────────────────────────────────
// 방어 시뮬레이터 상태 관리 (Zustand)
// - 10대 적군, 3대 아군, 1대 모선
// - 그물 격자 시스템
// - 시뮬레이션 통계
// ─────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { DEFENSE_CONFIG as C } from "./config/defense";
import type {
  AllyState,
  EnemyState,
  MothershipState,
  NetSegment,
  ClusterInfo,
  SimStats,
  EnemyFormation,
  CommanderState,
} from "./types/defense";
import { spawnEnemies, spawnAllies } from "./sim/formations";
import {
  createEmptyNetGrid,
  updateNetPainting,
  checkCapture,
  checkBreach,
  updateEnemy,
} from "./sim/netSystem";

interface DefenseStore {
  // ── 상태 ──
  allies: AllyState[];
  enemies: EnemyState[];
  mothership: MothershipState;
  nets: NetSegment[];
  netGrid: boolean[][];
  clusters: ClusterInfo[];
  stats: SimStats;
  commanderState: CommanderState;

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
  setAllyRoute: (allyId: number, route: { x: number; z: number; paint: boolean; started: boolean; active: boolean }[]) => void;
  startNetDeploy: (allyId: number) => void;
  stopNetDeploy: (allyId: number) => void;
  toggleRunning: () => void;
  setFormation: (formation: EnemyFormation) => void;
  setCommanderState: (state: Partial<CommanderState>) => void;
}

/** 초기 통계 */
const initialStats: SimStats = {
  captures: 0,
  breaches: 0,
  allyCollisions: 0,
  netsUsed: 0,
  netTouches: 0,
  survived: 0,
};

/** 초기 모선 상태 */
const initialMothership: MothershipState = {
  x: C.mothership.x,
  z: C.mothership.z,
  heading: C.mothership.heading,
  radius: C.mothership.radius,
};

/** 초기 지휘관 상태 (MobRobGPT 스타일) */
const initialCommanderState: CommanderState = {
  model: "oneway_ros2 (RL)",
  status: "ready",
  command: "모든 적군 포획",
  clusters: [],
  assignments: [],
  rationale: "ROS2 브릿지 대기 중...",
  lastUpdate: 0,
};

export const useDefenseStore = create<DefenseStore>((set, get) => ({
  // ── 초기 상태 ──
  allies: spawnAllies(),
  enemies: spawnEnemies("diversionary"),
  mothership: { ...initialMothership },
  nets: [],
  netGrid: createEmptyNetGrid(),
  clusters: [],
  stats: { ...initialStats },
  commanderState: { ...initialCommanderState },
  running: false,
  selectedAlly: 0,
  formation: "diversionary",
  step: 0,
  done: false,

  // ── 액션 ──

  reset: (formation) => {
    const f = formation ?? get().formation;
    set({
      allies: spawnAllies(),
      enemies: spawnEnemies(f),
      mothership: { ...initialMothership },
      nets: [],
      netGrid: createEmptyNetGrid(),
      clusters: [],
      stats: { ...initialStats },
      commanderState: { ...initialCommanderState },
      running: false,
      selectedAlly: 0,
      formation: f,
      step: 0,
      done: false,
    });
  },

  tick: (dt) => {
    const state = get();
    if (!state.running || state.done) return;

    const newStep = state.step + 1;
    const elapsedTime = newStep / 60;  // 경과 시간 (초)
    const { mothership } = state;

    // ── 1. 적 이동 + 포획/돌파 체크 ──
    let captures = state.stats.captures;
    let breaches = state.stats.breaches;
    let newNetGrid = state.netGrid;  // 포획 체크 전에 선언

    const movedEnemies = state.enemies.map((enemy) => {
      if (!enemy.alive) return enemy;
      return updateEnemy(enemy, state.netGrid, mothership, elapsedTime, dt);
    });

    const finalEnemies = movedEnemies.map((enemy) => {
      if (!enemy.alive) return enemy;

      // 포획 체크
      if (checkCapture(enemy, newNetGrid)) {
        captures++;
        console.log(`[tick] ★ 적 ${enemy.id} 포획! 위치=(${enemy.x.toFixed(2)}, ${enemy.z.toFixed(2)})`);
        return { ...enemy, alive: false };
      }

      // 돌파 체크
      if (checkBreach(enemy, mothership)) {
        breaches++;
        console.log(`[tick] ⚠ 적 ${enemy.id} 돌파! 위치=(${enemy.x.toFixed(2)}, ${enemy.z.toFixed(2)})`);
        return { ...enemy, alive: false };
      }

      return enemy;
    });

    // ── 2. 아군 이동 + 그물 전개 ──
    const newNets = [...state.nets];
    let netsUsed = state.stats.netsUsed;

    const newAllies = state.allies.map((ally) => {
      if (!ally.alive) return ally;

      const prevX = ally.x;
      const prevZ = ally.z;

      // 경로 추종 (단순화된 버전)
      const updated = stepAlly(ally, dt);

      // 그물 전개 업데이트
      if (updated.painting && updated.netsRemaining > 0) {
        const { netGrid: updatedGrid, netSegment, newPaintDist } = updateNetPainting(
          updated, prevX, prevZ, newNetGrid, dt
        );

        // 격자가 변경되었는지 확인
        const oldFilledCount = newNetGrid.flat().filter(Boolean).length;
        const newFilledCount = updatedGrid.flat().filter(Boolean).length;
        if (newFilledCount > oldFilledCount && Math.random() < 0.1) {
          console.log(`[tick] Ally ${updated.id}: 그물 칠하기 ${oldFilledCount} → ${newFilledCount} 셀`);
        }

        newNetGrid = updatedGrid;

        if (netSegment) {
          newNets.push(netSegment);
          netsUsed++;
          console.log(`[tick] Ally ${updated.id}: ★ 그물 세그먼트 완성! 총 ${newNets.length}개`);
          // 그물 완성 - 전개 종료
          return {
            ...updated,
            painting: false,
            paintDist: 0,
            netsRemaining: updated.netsRemaining - 1,
          };
        }

        return { ...updated, paintDist: newPaintDist };
      }

      return updated;
    });

    // ── 3. 클러스터 업데이트 ──
    const clusters = computeClusters(finalEnemies, mothership);

    // ── 4. 종료 조건 ──
    const aliveEnemies = finalEnemies.filter((e) => e.alive).length;
    const done = aliveEnemies === 0 || newStep >= 3600; // 60초 (60Hz × 60)

    set({
      enemies: finalEnemies,
      allies: newAllies,
      netGrid: newNetGrid,
      nets: newNets,
      clusters,
      step: newStep,
      done,
      stats: {
        ...state.stats,
        captures,
        breaches,
        netsUsed,
        survived: done ? aliveEnemies : state.stats.survived,
      },
    });
  },

  selectAlly: (id) => set({ selectedAlly: id }),

  setAllyTarget: (allyId, x, z) => {
    set((state) => ({
      allies: state.allies.map((ally) =>
        ally.id === allyId
          ? {
              ...ally,
              route: [
                ...ally.route,
                { x, z, paint: false, started: false, active: true },
              ],
            }
          : ally
      ),
    }));
  },

  setAllyRoute: (allyId, route) => {
    console.log(`[DefenseStore] setAllyRoute(${allyId}): ${route.length}개 WP 설정`);
    if (route.length > 0) {
      console.log(`  첫 WP: (${route[0].x.toFixed(2)}, ${route[0].z.toFixed(2)})`);
    }
    set((state) => ({
      allies: state.allies.map((ally) =>
        ally.id === allyId
          ? { ...ally, route }
          : ally
      ),
    }));
  },

  startNetDeploy: (allyId) => {
    set((state) => ({
      allies: state.allies.map((ally) =>
        ally.id === allyId && ally.netsRemaining > 0
          ? { ...ally, painting: true, paintDist: 0 }
          : ally
      ),
    }));
  },

  stopNetDeploy: (allyId) => {
    set((state) => ({
      allies: state.allies.map((ally) =>
        ally.id === allyId
          ? { ...ally, painting: false }
          : ally
      ),
    }));
  },

  toggleRunning: () => set((state) => ({ running: !state.running })),

  setFormation: (formation) => set({ formation }),

  setCommanderState: (state) =>
    set((prev) => ({
      commanderState: { ...prev.commanderState, ...state },
    })),
}));

/** 아군 이동 업데이트 (단순화) */
function stepAlly(ally: AllyState, dt: number): AllyState {
  // 디버그: 경로 있을 때만 100프레임마다 상태 출력
  if (ally.route.length > 0 && Math.random() < 0.02) {
    const wp = ally.route[0];
    const dist = Math.hypot(wp.x - ally.x, wp.z - ally.z);
    console.log(`[stepAlly] Ally ${ally.id}: pos=(${ally.x.toFixed(2)}, ${ally.z.toFixed(2)}) → WP(${wp.x.toFixed(2)}, ${wp.z.toFixed(2)}), dist=${dist.toFixed(2)}m, speed=${ally.speed.toFixed(3)}, heading=${ally.heading.toFixed(1)}°`);
  }

  if (ally.route.length === 0) {
    // 경로 없음 - 정지 (관성 감속)
    const decel = 2; // m/s²
    const newSpeed = Math.max(0, ally.speed - decel * dt);
    if (newSpeed === 0) return { ...ally, speed: 0 };

    const headingRad = (ally.heading * Math.PI) / 180;
    return {
      ...ally,
      speed: newSpeed,
      x: ally.x + Math.sin(headingRad) * newSpeed * dt,
      z: ally.z - Math.cos(headingRad) * newSpeed * dt,
    };
  }

  // 다음 웨이포인트로 이동
  const target = ally.route[0];
  const dx = target.x - ally.x;
  const dz = target.z - ally.z;
  const dist = Math.hypot(dx, dz);

  // 도착 판정 (스케일 적용: 선박 길이 기준)
  const arrivalDist = C.render.shipLength * 2;  // 선박 길이의 2배
  if (dist < arrivalDist) {
    const completedWp = ally.route[0];
    const newRoute = ally.route.slice(1);
    console.log(`[stepAlly] Ally ${ally.id}: WP 도달! (${completedWp.x.toFixed(2)}, ${completedWp.z.toFixed(2)}) → 남은 WP: ${newRoute.length}개`);
    const nextWp = newRoute[0];

    // 그물 전개 자동 관리
    let newPainting = ally.painting;
    let newPaintDist = ally.paintDist;
    let newNetsRemaining = ally.netsRemaining;

    // 현재 WP가 paint 구간이면 → 다음 WP로 이동하면서 그물 전개 시작
    // (completedWp.paint=true는 "이 WP에서 다음 WP까지 그물을 치라"는 의미)
    if (completedWp.paint && !ally.painting && ally.netsRemaining > 0) {
      newPainting = true;
      newPaintDist = 0;
      console.log(`[stepAlly] Ally ${ally.id}: ★ 그물 전개 시작! netsRemaining=${ally.netsRemaining}`);
    }

    // 다음 WP가 paint가 아니거나 경로 끝이면 → 그물 전개 종료
    if (ally.painting && (!nextWp || !nextWp.paint)) {
      // 그물 세그먼트 완성 (painting 중이었다면)
      newPainting = false;
      newPaintDist = 0;
      newNetsRemaining = ally.netsRemaining - 1;
      console.log(`[stepAlly] Ally ${ally.id}: ★ 그물 전개 완료! 남은 그물=${newNetsRemaining}`);
    }

    return {
      ...ally,
      route: newRoute,
      speed: newRoute.length === 0 ? 0 : ally.speed,
      painting: newPainting,
      paintDist: newPaintDist,
      netsRemaining: newNetsRemaining,
    };
  }

  // 목표 방향
  const targetHeading = Math.atan2(dx, -dz) * (180 / Math.PI);
  let headingDiff = ((targetHeading - ally.heading + 540) % 360) - 180;
  headingDiff = Math.max(-C.allyMaxTurn * dt * 60,
                         Math.min(C.allyMaxTurn * dt * 60, headingDiff));

  const newHeading = (ally.heading + headingDiff + 360) % 360;

  // 속도 제어
  const speedMult = ally.painting ? C.deploySpeedMult : 1;
  const targetSpeed = C.allySpeed * speedMult;
  const accel = 1.5; // m/s²
  const newSpeed = ally.speed < targetSpeed
    ? Math.min(targetSpeed, ally.speed + accel * dt)
    : Math.max(targetSpeed, ally.speed - accel * dt);

  const headingRad = (newHeading * Math.PI) / 180;

  return {
    ...ally,
    heading: newHeading,
    speed: newSpeed,
    x: ally.x + Math.sin(headingRad) * newSpeed * dt,
    z: ally.z - Math.cos(headingRad) * newSpeed * dt,
  };
}

/** 적 클러스터 계산 */
function computeClusters(enemies: EnemyState[], mothership: MothershipState): ClusterInfo[] {
  const aliveEnemies = enemies.filter((e) => e.alive);
  if (aliveEnemies.length === 0) return [];

  // 간단한 클러스터링 - clusterId 기반
  const clusterMap = new Map<number, EnemyState[]>();
  for (const enemy of aliveEnemies) {
    const list = clusterMap.get(enemy.clusterId) ?? [];
    list.push(enemy);
    clusterMap.set(enemy.clusterId, list);
  }

  const clusters: ClusterInfo[] = [];
  for (const [id, group] of clusterMap) {
    if (group.length === 0) continue;

    const centroidX = group.reduce((sum, e) => sum + e.x, 0) / group.length;
    const centroidZ = group.reduce((sum, e) => sum + e.z, 0) / group.length;

    const distToMother = Math.hypot(
      centroidX - mothership.x,
      centroidZ - mothership.z
    );

    const spread = Math.max(
      ...group.map((e) => Math.hypot(e.x - centroidX, e.z - centroidZ))
    );

    clusters.push({
      id,
      centroidX,
      centroidZ,
      enemyIds: group.map((e) => e.id),
      threat: 1 / (distToMother + 1), // 가까울수록 높은 위협
      spread,
    });
  }

  return clusters.sort((a, b) => b.threat - a.threat);
}

// ── 시뮬레이션 루프 ──

let defenseLoopId: ReturnType<typeof setInterval> | null = null;

export function startDefenseLoop(): () => void {
  if (defenseLoopId) clearInterval(defenseLoopId);

  let last = performance.now();
  defenseLoopId = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;

    useDefenseStore.getState().tick(dt);
  }, 1000 / 60); // 60Hz

  return () => {
    if (defenseLoopId) {
      clearInterval(defenseLoopId);
      defenseLoopId = null;
    }
  };
}

// 개발용 전역 접근
if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.defineProperty(window, "__defense", {
    configurable: true,
    get: () => useDefenseStore.getState(),
  });

  // 초기화 시 설정값 출력
  console.log("[DefenseStore] 초기화됨");
  console.log(`  worldSize: ${C.worldSize.toFixed(2)}m`);
  console.log(`  allySpeed: ${C.allySpeed.toFixed(4)}m/s`);
  console.log(`  shipLength: ${C.render.shipLength.toFixed(4)}m`);
  console.log(`  arrivalDist: ${(C.render.shipLength * 2).toFixed(4)}m`);
  const allies = useDefenseStore.getState().allies;
  allies.forEach(a => {
    console.log(`  Ally ${a.id}: pos=(${a.x.toFixed(2)}, ${a.z.toFixed(2)})`);
  });
}
