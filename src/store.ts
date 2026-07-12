// 전역 상태 — 시뮬레이션 상태와 MQTT 연결 상태.
// 시뮬레이션 틱(20Hz)은 여기서 setInterval로 돌리고,
// 3D 씬은 리렌더 없이 getState()로 매 프레임 읽는다.

import { create } from "zustand";
import { config } from "./config";
import {
  createUsvState,
  stepUsv,
  clampRudder,
  clampThrottle,
  type UsvState,
} from "./sim/usvSim";
import { applyKeyboardControls } from "./sim/controls";
import { isPointInWater, type WaterPolygon } from "./geo/waterArea";
import { getCurrentWaterMask } from "./scene/waterMaskTexture";
import { localMetersToLonLat } from "./geo/webMercator";
import { sampleElevationFromCache } from "./geo/elevation";

export type MqttStatus = "disconnected" | "connecting" | "connected";

interface SimStore {
  usv: UsvState;
  mqttStatus: MqttStatus;
  waterPolygons: WaterPolygon[];
  /** 마지막으로 수신한 원격 명령 설명 (HUD 표시용) */
  lastCommand: string | null;
  setRudderCmd: (deg: number) => void;
  setThrottle: (pct: number) => void;
  setMqttStatus: (s: MqttStatus) => void;
  setWaterPolygons: (polygons: WaterPolygon[]) => void;
  setLastCommand: (text: string) => void;
}

export const useSimStore = create<SimStore>((set) => ({
  usv: createUsvState(config.initialLat, config.initialLon),
  mqttStatus: "disconnected",
  waterPolygons: [],
  lastCommand: null,
  setRudderCmd: (deg) =>
    set((st) => ({ usv: { ...st.usv, rudderCmd: clampRudder(deg) } })),
  setThrottle: (pct) =>
    set((st) => ({ usv: { ...st.usv, throttle: clampThrottle(pct) } })),
  setMqttStatus: (mqttStatus) => set({ mqttStatus }),
  setWaterPolygons: (waterPolygons) => set({ waterPolygons }),
  setLastCommand: (lastCommand) => set({ lastCommand }),
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
    const { usv, waterPolygons } = useSimStore.getState();
    // 눌린 키를 dt 기반으로 반영 (연속 조타/스로틀 + 타 자동 중앙 복원)
    const { rudderCmd, throttle } = applyKeyboardControls(usv, dt);
    const next = { ...usv, rudderCmd, throttle };
    stepUsv(next, dt);
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
    useSimStore.setState({ usv: next });

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
