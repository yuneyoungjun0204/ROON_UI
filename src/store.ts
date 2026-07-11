// 전역 상태 — 시뮬레이션 상태와 MQTT 연결 상태.
// 시뮬레이션 틱(20Hz)은 여기서 setInterval로 돌리고,
// 3D 씬은 리렌더 없이 getState()로 매 프레임 읽는다.

import { create } from "zustand";
import { config, STATION_ZONE_RADIUS_M } from "./config";
import {
  createUsvState,
  stepUsv,
  clampSteer,
  clampThrottle,
  type UsvState,
} from "./sim/usvSim";
import { applyKeyboardControls, controls } from "./sim/controls";
import { isPointInWater, type WaterPolygon } from "./geo/waterArea";
import { getCurrentWaterMask } from "./scene/waterMaskTexture";
import { localMetersToLonLat, type LocalPoint } from "./geo/webMercator";
import { sampleElevationFromCache } from "./geo/elevation";
import { planRoute, type PlannedRoute } from "./nav/pathPlanner";
import { createFollowState, followRoute } from "./nav/autopilot";

export type MqttStatus = "disconnected" | "connecting" | "connected";

interface SimStore {
  usv: UsvState;
  mqttStatus: MqttStatus;
  waterPolygons: WaterPolygon[];
  /** 마지막으로 수신한 원격 명령 설명 (HUD 표시용) */
  lastCommand: string | null;
  /** 사용자가 찍은 웨이포인트 (씬 ENU 미터) */
  waypoints: LocalPoint[];
  /** 계획된 항로 — 웨이포인트가 바뀔 때마다 현재 위치 기준으로 다시 계산 */
  route: PlannedRoute | null;
  /** 자동 항해 중인지 */
  autopilot: boolean;
  /** 자동 항해가 스테이션 복귀인지 (상태 표시용) */
  returningToStation: boolean;
  /** 통과한 웨이포인트 수 — waypoints[0..reachedCount)는 도달 완료 */
  reachedCount: number;
  setSteer: (pct: number) => void;
  setThrottle: (pct: number) => void;
  setMqttStatus: (s: MqttStatus) => void;
  setWaterPolygons: (polygons: WaterPolygon[]) => void;
  setLastCommand: (text: string) => void;
  addWaypoint: (p: LocalPoint) => void;
  undoWaypoint: () => void;
  clearWaypoints: () => void;
  setAutopilot: (on: boolean) => void;
  /** 스테이션 존(시작 위치)으로 자동 복귀 — 기존 웨이포인트는 버린다 */
  returnToStation: () => void;
}

/** 자동 항해 추종 상태 — 60Hz로 갱신되므로 스토어 밖에 둔다. 재계획 때 리셋. */
let followState = createFollowState();

/** 경로 대이탈 시 자동 재계획 — 관성 때문에 크게 벗어나면(급반전 지시 등)
 * 순수 추종이 경로 밖에서 맴돌 수 있어, 현재 위치 기준으로 항로를 다시 만든다. */
const OFF_PATH_REPLAN_M = 20;
const REPLAN_COOLDOWN_MS = 4000;
let lastOffPathReplanAt = 0;
let offPathReplanCount = 0; // 디버그 관측용

/** 도착 후 정지 단계 — 타력으로 밀려나지 않도록 역추진으로 확실히 멈춘 뒤에
 * 수동 조작으로 전환한다. 이 단계 동안에는 자동 항해 상태가 유지된다. */
let stoppingAfterArrival = false;
const STOP_SPEED_MS = 0.15; // 이 속도 이하면 정지 완료로 간주

// 개발 편의: 콘솔에서 내부 항법 상태를 들여다볼 수 있게 노출
if (import.meta.env.DEV && typeof window !== "undefined") {
  Object.defineProperty(window, "__nav", {
    configurable: true,
    get: () => ({
      state: useSimStore.getState(),
      followState,
      offPathReplanCount,
    }),
  });
}

/** 경로 계획용 항행 판정 — 충돌 샘플(선체 절반)만큼 여유를 두어
 * 계획한 경로를 따라가다 물가 충돌 판정에 걸리지 않게 한다. */
const PLAN_CLEARANCE_M = 8;
const PLAN_OFFSETS: [number, number][] = [
  [0, 0],
  [PLAN_CLEARANCE_M, 0],
  [-PLAN_CLEARANCE_M, 0],
  [0, PLAN_CLEARANCE_M],
  [0, -PLAN_CLEARANCE_M],
];

function isNavigableForRoute(x: number, z: number): boolean {
  const { waterPolygons } = useSimStore.getState();
  // 절차적 바다 모드(수역 데이터 없음) — 어디든 항행 가능
  if (!getCurrentWaterMask() && waterPolygons.length === 0) return true;
  return PLAN_OFFSETS.every(([dx, dz]) =>
    isPointInNavigableWater(x + dx, z + dz, waterPolygons),
  );
}

/** 현재 위치에서 남은 웨이포인트를 지나는 항로 재계획. 남은 게 없으면 null. */
function replanRoute(
  usv: UsvState,
  waypoints: LocalPoint[],
  reachedCount: number,
): PlannedRoute | null {
  const remaining = waypoints.slice(reachedCount);
  if (remaining.length === 0) return null;
  followState = createFollowState();
  stoppingAfterArrival = false;
  return planRoute({ x: usv.x, z: usv.z }, remaining, isNavigableForRoute);
}

export const useSimStore = create<SimStore>((set) => ({
  usv: createUsvState(config.initialLat, config.initialLon),
  mqttStatus: "disconnected",
  waterPolygons: [],
  lastCommand: null,
  waypoints: [],
  route: null,
  autopilot: false,
  returningToStation: false,
  reachedCount: 0,
  setSteer: (pct) =>
    set((st) => ({ usv: { ...st.usv, steer: clampSteer(pct) } })),
  setThrottle: (pct) =>
    set((st) => ({ usv: { ...st.usv, throttle: clampThrottle(pct) } })),
  setMqttStatus: (mqttStatus) => set({ mqttStatus }),
  setWaterPolygons: (waterPolygons) => set({ waterPolygons }),
  setLastCommand: (lastCommand) => set({ lastCommand }),
  addWaypoint: (p) =>
    set((st) => {
      if (!isNavigableForRoute(p.x, p.z)) return {}; // 물 밖 클릭은 무시
      const waypoints = [...st.waypoints, p];
      const route = replanRoute(st.usv, waypoints, st.reachedCount);
      // 웨이포인트를 찍으면 곧바로 자동 항해 시작 (일반 항해 모드)
      return { waypoints, route, autopilot: route != null, returningToStation: false };
    }),
  undoWaypoint: () =>
    set((st) => {
      if (st.waypoints.length <= st.reachedCount) return {};
      const waypoints = st.waypoints.slice(0, -1);
      const route = replanRoute(st.usv, waypoints, st.reachedCount);
      return {
        waypoints,
        route,
        autopilot: st.autopilot && route != null,
        returningToStation: st.returningToStation && route != null,
      };
    }),
  clearWaypoints: () => {
    followState = createFollowState();
    set({
      waypoints: [],
      route: null,
      autopilot: false,
      returningToStation: false,
      reachedCount: 0,
    });
  },
  setAutopilot: (on) =>
    set((st) => {
      if (!on) return { autopilot: false, returningToStation: false };
      const route = replanRoute(st.usv, st.waypoints, st.reachedCount);
      if (!route) return {};
      return { autopilot: true, route };
    }),
  returnToStation: () =>
    set((st) => {
      // 이미 스테이션 존 안에 있으면 아무것도 하지 않는다
      if (Math.hypot(st.usv.x, st.usv.z) <= STATION_ZONE_RADIUS_M) return {};
      const waypoints: LocalPoint[] = [{ x: 0, z: 0 }]; // 스테이션 존 중심 = 로컬 원점
      const route = replanRoute(st.usv, waypoints, 0);
      return {
        waypoints,
        route,
        reachedCount: 0,
        autopilot: route != null,
        returningToStation: route != null,
      };
    }),
}));

const TICK_MS = 16; // ~60Hz — 조작 반응과 움직임을 매끄럽게

/** 미니맵용 항적 — 씬 ENU 좌표 [x, z] 쌍의 평면 배열. 리렌더 없이 캔버스가 직접 읽는다. */
export const trail: number[] = [];
const TRAIL_MIN_DIST = 2.5; // m — 이 이상 움직였을 때만 점 추가
const TRAIL_MAX_POINTS = 3000;
const LAND_ELEVATION_BUFFER_M = 0.25;
const USV_COLLISION_LENGTH_M = 15;
const USV_COLLISION_BEAM_M = 6.45;

function collisionSamplePoints(x: number, z: number, heading: number) {
  const rad = (heading * Math.PI) / 180;
  const fwd = { x: Math.sin(rad), z: -Math.cos(rad) };
  const stb = { x: -fwd.z, z: fwd.x };
  const halfL = USV_COLLISION_LENGTH_M / 2;
  const halfB = USV_COLLISION_BEAM_M / 2;
  const samples = [
    [0, 0],
    [halfL, 0],
    [-halfL, 0],
    [0, halfB],
    [0, -halfB],
    [halfL * 0.85, halfB * 0.85],
    [halfL * 0.85, -halfB * 0.85],
    [-halfL * 0.85, halfB * 0.85],
    [-halfL * 0.85, -halfB * 0.85],
  ];

  return samples.map(([forward, starboard]) => ({
    x: x + fwd.x * forward + stb.x * starboard,
    z: z + fwd.z * forward + stb.z * starboard,
  }));
}

function isTerrainAboveWater(x: number, z: number): boolean {
  const waterElevation = sampleElevationFromCache(config.initialLon, config.initialLat);
  if (waterElevation == null) return false;

  const { lon, lat } = localMetersToLonLat(
    x,
    z,
    config.initialLon,
    config.initialLat,
  );
  const elevation = sampleElevationFromCache(lon, lat);
  if (elevation == null) return false;

  return elevation > waterElevation + LAND_ELEVATION_BUFFER_M;
}

function isBlockedByTerrainHeight(x: number, z: number, heading: number): boolean {
  return collisionSamplePoints(x, z, heading).some((point) =>
    isTerrainAboveWater(point.x, point.z),
  );
}

/** 물가 비탈 폭만큼 항행 불가 여유(m) — 지형 정점을 물속으로 끌어내리며 생기는
 * 수면 위 비탈(폴리곤 경계 안쪽 ~한 격자 칸)과 충돌 판정을 일치시킨다. */
const SHORE_MARGIN_M = 9;
const SHORE_OFFSETS: [number, number][] = [
  [SHORE_MARGIN_M, 0],
  [-SHORE_MARGIN_M, 0],
  [0, SHORE_MARGIN_M],
  [0, -SHORE_MARGIN_M],
];

/** 항행 가능한 물인가 — 마스크가 있으면 물가에서 SHORE_MARGIN 침식해 판정,
 * 없으면(로드 전) 폴리곤 그대로. */
function isPointInNavigableWater(x: number, z: number, waterPolygons: WaterPolygon[]): boolean {
  const mask = getCurrentWaterMask();
  if (mask) {
    if (mask.sampleWater(x, z) < 0.5) return false;
    for (const [dx, dz] of SHORE_OFFSETS) {
      if (mask.sampleWater(x + dx, z + dz) < 0.5) return false;
    }
    return true;
  }
  return isPointInWater(x, z, waterPolygons);
}

function isBlockedByWaterPolygon(
  x: number,
  z: number,
  heading: number,
  waterPolygons: WaterPolygon[],
): boolean {
  if (waterPolygons.length === 0) return false;
  return collisionSamplePoints(x, z, heading).some(
    (point) => !isPointInNavigableWater(point.x, point.z, waterPolygons),
  );
}

/** 시뮬레이션 루프 시작. App 마운트 시 한 번 호출. 정리 함수를 반환.
 * dt는 실제 경과 시간으로 계산한다 — 타이머가 밀려도 시뮬레이션 시간이 느려지지 않게. */
export function startSimLoop(): () => void {
  let last = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.5); // 탭 복귀 등 큰 공백은 잘라냄
    last = now;
    const { usv, waterPolygons, autopilot, route, waypoints, reachedCount } =
      useSimStore.getState();
    // 눌린 키를 dt 기반으로 반영 (연속 조향/스로틀 + 조향 자동 중앙 복원)
    let { steer, throttle } = applyKeyboardControls(usv, dt);

    // 자동 항해 — 계획 경로를 추종. 수동 키 입력이 들어오면 즉시 해제.
    const navUpdates: Partial<
      Pick<SimStore, "autopilot" | "route" | "reachedCount" | "returningToStation">
    > = {};
    let brakingThisTick = false;
    if (autopilot && route) {
      const manual =
        controls.left || controls.right || controls.throttleUp || controls.throttleDown;
      if (manual) {
        navUpdates.autopilot = false;
        navUpdates.returningToStation = false;
        stoppingAfterArrival = false;
      } else if (stoppingAfterArrival) {
        // 도착 후 정지 단계 — 타력에 밀려 존 밖으로 나가지 않게 역추진으로 멈춘다.
        steer = 0;
        if (usv.speed > STOP_SPEED_MS) {
          throttle = -40;
          brakingThisTick = true;
        } else {
          // 완전 정지 — 이제 수동 조작으로 전환
          throttle = 0;
          stoppingAfterArrival = false;
          navUpdates.autopilot = false;
          navUpdates.returningToStation = false;
          navUpdates.route = null;
          navUpdates.reachedCount = waypoints.length;
        }
      } else {
        const out = followRoute(usv, route.points, followState);
        steer = out.steer;
        throttle = out.throttle;
        // 통과한 웨이포인트 수 갱신 (route는 미도달 웨이포인트만 담고 있다)
        const base = waypoints.length - route.wpIndex.length;
        let passed = 0;
        while (passed < route.wpIndex.length && followState.progress >= route.wpIndex[passed]) {
          passed += 1;
        }
        if (out.arrived) {
          // 즉시 해제하지 않고 정지 단계로 진입 — 속도 0까지 자동 제어 유지
          stoppingAfterArrival = true;
          steer = 0;
          if (usv.speed > STOP_SPEED_MS) {
            throttle = -40;
            brakingThisTick = true;
          }
        } else if (base + passed > reachedCount) {
          navUpdates.reachedCount = base + passed;
        }

        // 경로 대이탈 → 현재 위치에서 재계획 (쿨다운으로 과도한 재계획 방지)
        if (
          !out.arrived &&
          out.crossTrack > OFF_PATH_REPLAN_M &&
          now - lastOffPathReplanAt > REPLAN_COOLDOWN_MS
        ) {
          lastOffPathReplanAt = now;
          offPathReplanCount += 1;
          const newReached = navUpdates.reachedCount ?? reachedCount;
          const newRoute = replanRoute(usv, waypoints, newReached);
          if (newRoute) navUpdates.route = newRoute;
        }
      }
    }

    const next = { ...usv, steer, throttle };
    stepUsv(next, dt);
    // 정지 단계의 역추진이 후진으로 이어지지 않게 — 멈추는 게 목적이다
    if (brakingThisTick && next.speed < 0) next.speed = 0;
    // 실제 수역 경계(OSM)를 진실로 삼는다 — 그 안이면 DEM이 물을 육지로 잘못 잡아도 항행 가능.
    // 폴리곤이 아직 없으면(로드 전/실패) DEM 높이로 폴백.
    const blocked =
      waterPolygons.length > 0
        ? isBlockedByWaterPolygon(next.x, next.z, next.heading, waterPolygons)
        : isBlockedByTerrainHeight(next.x, next.z, next.heading);

    if (blocked) {
      next.lat = usv.lat;
      next.lon = usv.lon;
      next.x = usv.x;
      next.z = usv.z;
      next.speed = 0;
    }
    useSimStore.setState({ usv: next, ...navUpdates });

    const n = trail.length;
    const moved =
      n === 0 || Math.hypot(next.x - trail[n - 2], next.z - trail[n - 1]) >= TRAIL_MIN_DIST;
    if (moved) {
      trail.push(next.x, next.z);
      if (trail.length > TRAIL_MAX_POINTS * 2) trail.splice(0, 2);
    }
  }, TICK_MS);
  return () => clearInterval(id);
}
